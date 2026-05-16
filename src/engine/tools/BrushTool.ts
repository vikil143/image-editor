// ─── Freehand Brush Tool ──────────────────────────────────────────────────────
// Draws smooth freehand strokes stored as PathObjects in the scene graph.
//
// Architecture decisions:
//   • Points are accumulated in world space during the drag.
//   • On pointerUp the path is committed to the scene graph via AddObjectCommand
//     so it participates fully in undo/redo.
//   • During the drag (before commit) the live stroke is drawn directly onto
//     the canvas via the Renderer's overlay mechanism (markDirty + render).
//     We avoid creating a PathObject mid-drag to keep the scene graph clean.
//   • Throttling: we skip adding a new point if it's within MIN_DIST of the last
//     one. This reduces point count on slow/precise strokes and keeps the bezier
//     smooth. Fast strokes naturally space points far apart.
//
// WebGL migration note: PathObjects map to GPU-side vertex buffers.
// The quadratic bezier smoothing is equivalent to a tessellated path mesh.

import type { BaseTool, ToolContext } from "./BaseTool";
import { screenToWorld } from "./BaseTool";
import type { Point, ToolType } from "../../types";
import { createPath } from "../objects/factories";
import { AddObjectCommand } from "../history/HistoryManager";

const MIN_DIST = 3; // px in world space — minimum distance between sampled points

export class BrushTool implements BaseTool {
  readonly type: ToolType = "brush";

  private points: Point[] = [];
  private isDrawing = false;
  private strokeColor = "#1A1A2E";
  private strokeWidth = 3;

  // Called by PropertiesPanel / toolbar if they expose brush settings
  setStrokeColor(color: string): void {
    this.strokeColor = color;
  }

  setStrokeWidth(width: number): void {
    this.strokeWidth = width;
  }

  activate(_ctx: ToolContext): void {}

  deactivate(_ctx: ToolContext): void {
    this.points = [];
    this.isDrawing = false;
  }

  onPointerDown(_e: PointerEvent, point: Point, ctx: ToolContext): void {
    const world = screenToWorld(point, ctx.camera);
    this.points = [world];
    this.isDrawing = true;
    ctx.scene.deselectAll();
    ctx.renderer.markDirty();
  }

  onPointerMove(_e: PointerEvent, point: Point, ctx: ToolContext): void {
    if (!this.isDrawing) return;

    const world = screenToWorld(point, ctx.camera);
    const last = this.points[this.points.length - 1];
    const dist = Math.hypot(world.x - last.x, world.y - last.y);
    if (dist < MIN_DIST) return;

    this.points.push(world);

    // Draw live preview directly onto the canvas each frame
    this.renderLiveStroke(ctx);
    ctx.renderer.markDirty();
  }

  onPointerUp(_e: PointerEvent, _point: Point, ctx: ToolContext): void {
    if (!this.isDrawing || this.points.length < 2) {
      this.points = [];
      this.isDrawing = false;
      ctx.renderer.markDirty();
      return;
    }

    // Commit the path to the scene graph
    const pathObj = createPath(this.points, this.strokeColor, this.strokeWidth);

    const cmd = new AddObjectCommand(ctx.scene, pathObj, () => {
      ctx.renderer.markDirty();
      ctx.onObjectsChange();
    });
    ctx.history.execute(cmd);
    ctx.scene.selectOnly(pathObj.id);
    ctx.onSelectionChange([pathObj.id]);

    this.points = [];
    this.isDrawing = false;
    ctx.onObjectsChange();
    ctx.renderer.markDirty();
  }

  getCursor(): string {
    return "crosshair";
  }

  // ── Live stroke preview ───────────────────────────────────────────────────
  // Draws the in-progress stroke directly onto the canvas before the path is
  // committed. This preview is overwritten on the next full render (markDirty),
  // so it won't linger after the stroke is committed.
  private renderLiveStroke(ctx: ToolContext): void {
    const rawCtx = this.ctx2d(ctx);
    if (!rawCtx || this.points.length < 2) return;

    const cam = ctx.camera;
    rawCtx.save();
    rawCtx.translate(cam.x, cam.y);
    rawCtx.scale(cam.zoom, cam.zoom);

    rawCtx.beginPath();
    rawCtx.moveTo(this.points[0].x, this.points[0].y);

    if (this.points.length > 2) {
      for (let i = 1; i < this.points.length - 1; i++) {
        const midX = (this.points[i].x + this.points[i + 1].x) / 2;
        const midY = (this.points[i].y + this.points[i + 1].y) / 2;
        rawCtx.quadraticCurveTo(this.points[i].x, this.points[i].y, midX, midY);
      }
    }
    const last = this.points[this.points.length - 1];
    rawCtx.lineTo(last.x, last.y);

    rawCtx.strokeStyle = this.strokeColor;
    rawCtx.lineWidth = this.strokeWidth / cam.zoom;
    rawCtx.lineCap = "round";
    rawCtx.lineJoin = "round";
    rawCtx.stroke();
    rawCtx.restore();
  }

  private ctx2d(ctx: ToolContext): CanvasRenderingContext2D | null {
    // Access the canvas through the Renderer's public property
    const canvas = (ctx.renderer as { canvas?: HTMLCanvasElement }).canvas;
    return canvas ? canvas.getContext("2d") : null;
  }
}
