// ─── Scene Graph ──────────────────────────────────────────────────────────────
// The authoritative ordered list of all renderable objects.
// Index 0 = bottom layer, last index = top layer.
//
// This class is intentionally framework-agnostic (no React, no Zustand).
// A flat array is sufficient for now; a tree would be needed for groups.

import type { AnySceneObject } from "../../types";

export class SceneGraph {
  private objects: AnySceneObject[] = [];

  // ── Read ────────────────────────────────────────────────────────────────────

  getAll(): AnySceneObject[] {
    return this.objects;
  }

  getById(id: string): AnySceneObject | undefined {
    return this.objects.find((o) => o.id === id);
  }

  getSelected(): AnySceneObject[] {
    return this.objects.filter((o) => o.selected);
  }

  count(): number {
    return this.objects.length;
  }

  // ── Write ───────────────────────────────────────────────────────────────────

  add(object: AnySceneObject): void {
    const withZ = { ...object, zIndex: this.objects.length };
    this.objects.push(withZ);
  }

  remove(id: string): AnySceneObject | undefined {
    const idx = this.objects.findIndex((o) => o.id === id);
    if (idx === -1) return undefined;
    const [removed] = this.objects.splice(idx, 1);
    this.recomputeZIndex();
    return removed;
  }

  // PathObjects store points in world space. When x/y changes (move operation)
  // all points must shift by the same delta — otherwise the path would detach
  // from its bounding box and appear to jump.
  update(id: string, partial: Partial<AnySceneObject>): void {
    const idx = this.objects.findIndex((o) => o.id === id);
    if (idx === -1) return;

    const existing = this.objects[idx];

    if (
      existing.type === "path" &&
      (partial.x !== undefined || partial.y !== undefined)
    ) {
      const pathObj = existing as typeof existing & {
        points: { x: number; y: number }[];
      };
      const dx = (partial.x ?? existing.x) - existing.x;
      const dy = (partial.y ?? existing.y) - existing.y;
      const shiftedPoints = pathObj.points.map((p) => ({
        x: p.x + dx,
        y: p.y + dy,
      }));
      this.objects[idx] = {
        ...existing,
        ...partial,
        points: shiftedPoints,
      } as AnySceneObject;
      return;
    }

    this.objects[idx] = { ...existing, ...partial } as AnySceneObject;
  }

  // Replace entire object (used by undo/redo to restore snapshots)
  replace(object: AnySceneObject): void {
    const idx = this.objects.findIndex((o) => o.id === object.id);
    if (idx === -1) {
      this.objects.push(object);
    } else {
      this.objects[idx] = object;
    }
  }

  // ── Selection ───────────────────────────────────────────────────────────────

  selectOnly(id: string): void {
    this.objects = this.objects.map((o) => ({
      ...o,
      selected: o.id === id,
    })) as AnySceneObject[];
  }

  selectAdd(id: string): void {
    this.update(id, { selected: true } as Partial<AnySceneObject>);
  }

  deselectAll(): void {
    this.objects = this.objects.map((o) => ({
      ...o,
      selected: false,
    })) as AnySceneObject[];
  }

  // ── Z-order ─────────────────────────────────────────────────────────────────

  bringToFront(id: string): void {
    const idx = this.objects.findIndex((o) => o.id === id);
    if (idx === -1 || idx === this.objects.length - 1) return;
    const [obj] = this.objects.splice(idx, 1);
    this.objects.push(obj);
    this.recomputeZIndex();
  }

  sendToBack(id: string): void {
    const idx = this.objects.findIndex((o) => o.id === id);
    if (idx === -1 || idx === 0) return;
    const [obj] = this.objects.splice(idx, 1);
    this.objects.unshift(obj);
    this.recomputeZIndex();
  }

  // Move one step up in z-order (toward top/front)
  moveUp(id: string): void {
    const idx = this.objects.findIndex((o) => o.id === id);
    if (idx === -1 || idx === this.objects.length - 1) return;
    [this.objects[idx], this.objects[idx + 1]] = [
      this.objects[idx + 1],
      this.objects[idx],
    ];
    this.recomputeZIndex();
  }

  // Move one step down in z-order (toward bottom/back)
  moveDown(id: string): void {
    const idx = this.objects.findIndex((o) => o.id === id);
    if (idx <= 0) return;
    [this.objects[idx], this.objects[idx - 1]] = [
      this.objects[idx - 1],
      this.objects[idx],
    ];
    this.recomputeZIndex();
  }

  // ── Serialization ────────────────────────────────────────────────────────────

  snapshot(): AnySceneObject[] {
    return this.objects.map((o) => {
      if (o.type === "image") {
        // Strip the HTMLImageElement — not serializable
        const { imageElement: _ie, ...rest } = o as typeof o & {
          imageElement?: HTMLImageElement;
        };
        return { ...rest };
      }
      return { ...o };
    }) as AnySceneObject[];
  }

  restore(snapshot: AnySceneObject[]): void {
    this.objects = snapshot.map((o) => ({ ...o })) as AnySceneObject[];
  }

  private recomputeZIndex(): void {
    this.objects.forEach((o, i) => {
      o.zIndex = i;
    });
  }
}
