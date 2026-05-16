// ─── Select Tool ──────────────────────────────────────────────────────────────
//
// The primary interaction tool. Handles:
//   • Click to select / deselect
//   • Shift-click multi-select
//   • Drag to move selected objects (with optional snap)
//   • Drag resize handles
//   • Drag rotate handle
//   • Drag on empty space → marquee (rubber-band) selection
//
// ── State Machine ─────────────────────────────────────────────────────────────
//
//   pointerDown → determine mode:
//     hit handle  → "resizing" | "rotating"
//     hit object  → "moving"
//     hit nothing → "marquee"
//
//   pointerMove → update based on mode
//   pointerUp   → commit to history; clear mode → "idle"
//
// ── Snap Integration ──────────────────────────────────────────────────────────
//
//   During "moving" mode, after computing the new position from the drag delta,
//   we call SnapEngine.snap() if the config requests snapping. The snapped
//   position replaces the raw one; guide lines are written to renderer.snapGuides
//   for the next frame. On pointerUp, guides are cleared.
//
// ── Marquee Geometry ──────────────────────────────────────────────────────────
//
//   MarqueeState has world-space x/y/width/height (may be negative).
//   On pointerUp we normalize to positive extents and test each object's
//   bounding box for intersection. Objects fully or partially inside are selected.

import type { BaseTool, ToolContext } from "./BaseTool";
import { screenToWorld, handleCursor } from "./BaseTool";
import type { AnySceneObject, MarqueeState, Point, ResizeHandle, ToolType } from "../../types";
import { HitDetector } from "../hitDetection/HitDetector";
import { SnapEngine } from "../snapping/SnapEngine";
import {
  TransformObjectCommand,
  BatchCommand,
} from "../history/HistoryManager";

type DragMode = "idle" | "moving" | "resizing" | "rotating" | "marquee";

const MIN_SIZE = 10; // minimum object dimension in world units

export class SelectTool implements BaseTool {
  readonly type: ToolType = "select";

  private mode: DragMode = "idle";
  private hitDetector = new HitDetector();

  // Captured at drag start
  private dragStartWorld: Point = { x: 0, y: 0 };
  private snapshotBefore = new Map<string, AnySceneObject>();
  private activeHandle: ResizeHandle | null = null;

  // Marquee tracking
  private marqueeStart: Point = { x: 0, y: 0 };

  activate(_ctx: ToolContext): void {}

  deactivate(ctx: ToolContext): void {
    this.mode = "idle";
    this.clearGuides(ctx);
    ctx.renderer.marqueeState = null;
  }

  onPointerDown(e: PointerEvent, point: Point, ctx: ToolContext): void {
    const world   = screenToWorld(point, ctx.camera);
    const objects = ctx.scene.getAll();
    const hit     = this.hitDetector.hit(world, objects, ctx.camera.zoom);

    if (!hit) {
      // Click on empty canvas → start marquee selection
      if (!e.shiftKey) {
        ctx.scene.deselectAll();
        ctx.onSelectionChange([]);
      }
      this.mode         = "marquee";
      this.marqueeStart = world;
      ctx.renderer.marqueeState = {
        active: true,
        x: world.x, y: world.y,
        width: 0, height: 0,
      };
      ctx.renderer.markDirty();
      return;
    }

    const { object, handle } = hit;

    // Select the hit object
    if (e.shiftKey) {
      ctx.scene.selectAdd(object.id);
    } else if (!object.selected) {
      ctx.scene.selectOnly(object.id);
    }
    ctx.onSelectionChange(ctx.scene.getSelected().map((o) => o.id));

    // Snapshot selected objects before drag
    this.dragStartWorld = world;
    this.snapshotBefore.clear();
    for (const sel of ctx.scene.getSelected()) {
      this.snapshotBefore.set(sel.id, { ...sel } as AnySceneObject);
    }

    if (handle) {
      this.activeHandle = handle;
      this.mode = handle === "rotate" ? "rotating" : "resizing";
    } else {
      this.activeHandle = null;
      this.mode = "moving";
    }

    ctx.renderer.markDirty();
  }

  onPointerMove(_e: PointerEvent, point: Point, ctx: ToolContext): void {
    if (this.mode === "idle") return;

    const world = screenToWorld(point, ctx.camera);

    if (this.mode === "marquee") {
      const ms: MarqueeState = {
        active: true,
        x: this.marqueeStart.x,
        y: this.marqueeStart.y,
        width:  world.x - this.marqueeStart.x,
        height: world.y - this.marqueeStart.y,
      };
      ctx.renderer.marqueeState = ms;
      ctx.renderer.markDirty();
      return;
    }

    const dx = world.x - this.dragStartWorld.x;
    const dy = world.y - this.dragStartWorld.y;

    if (this.mode === "moving") {
      const config = ctx.getConfig?.();
      const snapToGrid    = config?.snapToGrid    ?? false;
      const snapToObjects = config?.snapToObjects ?? false;
      const gridSize      = snapToGrid ? (config?.gridSize ?? 20) : undefined;

      for (const [id, snap] of this.snapshotBefore) {
        let nx = snap.x + dx;
        let ny = snap.y + dy;

        // Object snapping (only if a single object is selected)
        if (snapToObjects && this.snapshotBefore.size === 1) {
          const nonSelected = ctx.scene.getAll().filter((o) => !o.selected);
          const result = SnapEngine.snap(
            { x: nx, y: ny, width: snap.width, height: snap.height },
            nonSelected,
            ctx.camera.zoom,
            gridSize
          );
          nx = result.x;
          ny = result.y;
          ctx.renderer.snapGuides = result.guides;
        } else if (snapToGrid && gridSize) {
          nx = SnapEngine.snapToGrid(nx, gridSize);
          ny = SnapEngine.snapToGrid(ny, gridSize);
          ctx.renderer.snapGuides = [];
        } else {
          ctx.renderer.snapGuides = [];
        }

        ctx.scene.update(id, { x: nx, y: ny });
      }
    } else if (this.mode === "resizing" && this.activeHandle) {
      const sel = ctx.scene.getSelected();
      if (sel.length === 1) {
        const snap = this.snapshotBefore.get(sel[0].id)!;
        ctx.scene.update(sel[0].id, this.computeResize(snap, this.activeHandle, dx, dy));
      }
    } else if (this.mode === "rotating") {
      const sel = ctx.scene.getSelected();
      if (sel.length === 1) {
        const snap = this.snapshotBefore.get(sel[0].id)!;
        const cx   = snap.x + snap.width  / 2;
        const cy   = snap.y + snap.height / 2;
        const startAngle   = Math.atan2(this.dragStartWorld.y - cy, this.dragStartWorld.x - cx);
        const currentAngle = Math.atan2(world.y - cy, world.x - cx);
        ctx.scene.update(sel[0].id, { rotation: snap.rotation + (currentAngle - startAngle) });
      }
    }

    ctx.renderer.markDirty();
  }

  onPointerUp(_e: PointerEvent, _point: Point, ctx: ToolContext): void {
    if (this.mode === "idle") return;

    if (this.mode === "marquee") {
      this.commitMarqueeSelection(ctx);
      ctx.renderer.marqueeState = null;
      ctx.renderer.markDirty();
      this.mode = "idle";
      return;
    }

    // Commit transform to history
    const selected  = ctx.scene.getSelected();
    const commands  = selected
      .filter((o) => this.snapshotBefore.has(o.id))
      .map((o) => {
        const before = this.snapshotBefore.get(o.id)!;
        const after  = { ...o } as AnySceneObject;
        return new TransformObjectCommand(
          ctx.scene, o.id, before, after, () => ctx.renderer.markDirty()
        );
      });

    if (commands.length > 0) {
      ctx.history.pushExecuted(new BatchCommand(commands, "Transform"));
    }

    this.clearGuides(ctx);
    this.mode = "idle";
    this.snapshotBefore.clear();
    ctx.onObjectsChange();
  }

  getCursor(point: Point, ctx: ToolContext): string {
    if (this.mode === "moving")   return "grabbing";
    if (this.mode === "resizing") return handleCursor(this.activeHandle ?? "", 0);
    if (this.mode === "rotating") return "crosshair";
    if (this.mode === "marquee")  return "crosshair";

    const world = screenToWorld(point, ctx.camera);
    const hit   = this.hitDetector.hit(world, ctx.scene.getAll(), ctx.camera.zoom);
    if (!hit) return "default";
    if (hit.handle) return handleCursor(hit.handle, hit.object.rotation);
    return hit.object.selected ? "grab" : "pointer";
  }

  // ── Marquee commit ─────────────────────────────────────────────────────────
  // Normalize negative-dimension rect, then intersect with each object's AABB.
  private commitMarqueeSelection(ctx: ToolContext): void {
    const m = ctx.renderer.marqueeState;
    if (!m) return;

    const rx = m.width  < 0 ? m.x + m.width  : m.x;
    const ry = m.height < 0 ? m.y + m.height : m.y;
    const rw = Math.abs(m.width);
    const rh = Math.abs(m.height);

    // Skip degenerate marquee (just a click)
    if (rw < 2 && rh < 2) return;

    const selectedIds: string[] = [];
    for (const obj of ctx.scene.getAll()) {
      if (!obj.visible || obj.locked) continue;
      // AABB intersection test
      if (
        obj.x < rx + rw && obj.x + obj.width  > rx &&
        obj.y < ry + rh && obj.y + obj.height > ry
      ) {
        obj.selected = true;
        selectedIds.push(obj.id);
      }
    }

    ctx.onSelectionChange(selectedIds);
  }

  // ── Resize computation ─────────────────────────────────────────────────────
  // Always works from the drag-start snapshot to avoid floating-point drift.
  private computeResize(
    snap: AnySceneObject,
    handle: ResizeHandle,
    dx: number,
    dy: number
  ): Partial<AnySceneObject> {
    let { x, y, width, height } = snap;

    switch (handle) {
      case "se": width  = Math.max(MIN_SIZE, width + dx);  height = Math.max(MIN_SIZE, height + dy); break;
      case "sw": x += dx; width  = Math.max(MIN_SIZE, width - dx);  height = Math.max(MIN_SIZE, height + dy); break;
      case "ne": width  = Math.max(MIN_SIZE, width + dx);  y += dy; height = Math.max(MIN_SIZE, height - dy); break;
      case "nw": x += dx; y += dy; width = Math.max(MIN_SIZE, width - dx); height = Math.max(MIN_SIZE, height - dy); break;
      case "e":  width  = Math.max(MIN_SIZE, width + dx);  break;
      case "w":  x += dx; width  = Math.max(MIN_SIZE, width - dx);  break;
      case "s":  height = Math.max(MIN_SIZE, height + dy); break;
      case "n":  y += dy; height = Math.max(MIN_SIZE, height - dy); break;
    }

    return { x, y, width, height };
  }

  private clearGuides(ctx: ToolContext): void {
    ctx.renderer.snapGuides = [];
  }
}
