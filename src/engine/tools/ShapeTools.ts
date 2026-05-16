// ─── Shape Drawing Tools ──────────────────────────────────────────────────────
// RectTool, CircleTool, LineTool — all follow the same pattern:
//   pointerDown: record start point, create a preview object
//   pointerMove: update preview object dimensions live
//   pointerUp:   finalize via AddObjectCommand, switch back to select tool

import type { BaseTool, ToolContext } from "./BaseTool";
import { screenToWorld } from "./BaseTool";
import type { Point, ToolType } from "../../types";
import { createRect, createCircle, createLine } from "../objects/factories";
import { AddObjectCommand } from "../history/HistoryManager";

// ── Shared drawing logic ──────────────────────────────────────────────────────

abstract class ShapeDrawTool implements BaseTool {
  abstract readonly type: ToolType;
  protected startWorld: Point | null = null;
  protected previewId: string | null = null;

  activate(_ctx: ToolContext): void {}
  deactivate(ctx: ToolContext): void {
    if (this.previewId) {
      ctx.scene.remove(this.previewId);
      this.previewId = null;
    }
    this.startWorld = null;
  }

  onPointerDown(_e: PointerEvent, point: Point, ctx: ToolContext): void {
    this.startWorld = screenToWorld(point, ctx.camera);
    const obj = this.createPreview(this.startWorld.x, this.startWorld.y, 1, 1);
    ctx.scene.deselectAll();
    ctx.scene.add(obj);
    this.previewId = obj.id;
    ctx.renderer.markDirty();
  }

  onPointerMove(_e: PointerEvent, point: Point, ctx: ToolContext): void {
    if (!this.startWorld || !this.previewId) return;
    const world = screenToWorld(point, ctx.camera);
    const dims = this.computeDimensions(this.startWorld, world);
    ctx.scene.update(this.previewId, dims);
    ctx.renderer.markDirty();
  }

  onPointerUp(_e: PointerEvent, point: Point, ctx: ToolContext): void {
    if (!this.startWorld || !this.previewId) return;
    const world = screenToWorld(point, ctx.camera);
    const dims = this.computeDimensions(this.startWorld, world);

    // Discard tiny accidental clicks
    if (Math.abs(dims.width ?? 0) < 5 || Math.abs(dims.height ?? 0) < 5) {
      ctx.scene.remove(this.previewId);
      this.previewId = null;
      this.startWorld = null;
      ctx.renderer.markDirty();
      return;
    }

    // The object already exists in the scene (added in pointerDown).
    // We create a command that can undo/redo it without re-adding it live.
    const obj = ctx.scene.getById(this.previewId);
    if (obj) {
      ctx.scene.update(this.previewId, dims);
      ctx.scene.selectOnly(this.previewId);
      const finalObj = ctx.scene.getById(this.previewId)!;
      // Build a command that mirrors the already-applied add
      const cmd = new AddObjectCommand(ctx.scene, finalObj, () => {
        ctx.renderer.markDirty();
        ctx.onObjectsChange();
      });
      ctx.history.pushExecuted(cmd);
      ctx.onSelectionChange([this.previewId]);
    }

    this.previewId = null;
    this.startWorld = null;
    ctx.onObjectsChange();
    ctx.renderer.markDirty();
  }

  getCursor(): string {
    return "crosshair";
  }

  protected computeDimensions(
    start: Point,
    current: Point
  ): { x: number; y: number; width: number; height: number } {
    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    const width = Math.abs(current.x - start.x);
    const height = Math.abs(current.y - start.y);
    return { x, y, width, height };
  }

  protected abstract createPreview(
    x: number, y: number, w: number, h: number
  ): ReturnType<typeof createRect> | ReturnType<typeof createCircle>;
}

// ── Rect Tool ─────────────────────────────────────────────────────────────────

export class RectTool extends ShapeDrawTool {
  readonly type: ToolType = "rect";

  protected createPreview(x: number, y: number, w: number, h: number) {
    return createRect(x, y, w, h);
  }
}

// ── Circle Tool ───────────────────────────────────────────────────────────────

export class CircleTool extends ShapeDrawTool {
  readonly type: ToolType = "circle";

  protected createPreview(x: number, y: number, w: number, h: number) {
    return createCircle(x, y, w, h);
  }
}

// ── Line Tool ─────────────────────────────────────────────────────────────────

export class LineTool implements BaseTool {
  readonly type: ToolType = "line";
  protected startWorld: Point | null = null;
  protected previewId: string | null = null;

  activate(_ctx: ToolContext): void {}
  deactivate(ctx: ToolContext): void {
    if (this.previewId) ctx.scene.remove(this.previewId);
    this.previewId = null;
    this.startWorld = null;
  }

  onPointerDown(_e: PointerEvent, point: Point, ctx: ToolContext): void {
    const w = screenToWorld(point, ctx.camera);
    this.startWorld = w;
    const obj = createLine(w.x, w.y, w.x + 1, w.y + 1);
    ctx.scene.add(obj);
    this.previewId = obj.id;
    ctx.renderer.markDirty();
  }

  onPointerMove(_e: PointerEvent, point: Point, ctx: ToolContext): void {
    if (!this.startWorld || !this.previewId) return;
    const w = screenToWorld(point, ctx.camera);
    ctx.scene.update(this.previewId, { x2: w.x, y2: w.y });
    ctx.renderer.markDirty();
  }

  onPointerUp(_e: PointerEvent, point: Point, ctx: ToolContext): void {
    if (!this.startWorld || !this.previewId) return;
    const w = screenToWorld(point, ctx.camera);
    ctx.scene.update(this.previewId, { x2: w.x, y2: w.y });
    ctx.scene.selectOnly(this.previewId);
    const finalObj = ctx.scene.getById(this.previewId)!;
    const cmd = new AddObjectCommand(ctx.scene, finalObj, () => {
      ctx.renderer.markDirty();
      ctx.onObjectsChange();
    });
    ctx.history.pushExecuted(cmd);
    ctx.onSelectionChange([this.previewId]);
    this.previewId = null;
    this.startWorld = null;
    ctx.onObjectsChange();
    ctx.renderer.markDirty();
  }

  getCursor(): string {
    return "crosshair";
  }
}

// ── Arrow Tool (Line with arrowHead = true) ───────────────────────────────────

export class ArrowTool extends LineTool {
  readonly type: ToolType = "arrow";

  onPointerDown(_e: PointerEvent, point: Point, ctx: ToolContext): void {
    const w = screenToWorld(point, ctx.camera);
    this.startWorld = w;
    const obj = createLine(w.x, w.y, w.x + 1, w.y + 1);
    obj.arrowHead = true;
    ctx.scene.add(obj);
    this.previewId = obj.id;
    ctx.renderer.markDirty();
  }
}
