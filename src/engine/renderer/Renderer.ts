// ─── Canvas 2D Renderer ───────────────────────────────────────────────────────
//
// Implements IRenderer using the HTML5 Canvas 2D API.
//
// ── Rendering Pipeline (one frame) ───────────────────────────────────────────
//
//   1.  Clear full viewport
//   2.  Fill outer void (the infinite canvas area outside the artboard)
//   3.  Push camera transform  [ctx.translate(cam.x, cam.y); ctx.scale(cam.zoom)]
//   4.  Draw artboard drop shadow
//   5.  Draw artboard background
//   6.  Draw infinite grid (viewport-clipped, zoom-adaptive)
//   7.  For each visible object (bottom → top):
//         a. Viewport cull  (skip if outside visible area)
//         b. Push object transform (center-pivot rotation + scale)
//         c. Apply image filter if ImageObject.filters present
//         d. Draw object
//         e. Pop
//   8.  Draw selection overlays (handles, rotation handle, dashed border)
//   9.  Draw snap guide lines
//  10.  Draw marquee (drag-selection rubber band)
//  11.  Draw crop overlay (if crop tool active)
//  12.  Pop camera transform
//
// ── Dirty Flag ───────────────────────────────────────────────────────────────
//
//   markDirty() sets a boolean; the RAF loop skips the draw if not dirty.
//   Cost of a skipped frame: one boolean check per 16ms → negligible.
//   Tools and commands call markDirty() after every state change.
//
// ── DPR Scaling ──────────────────────────────────────────────────────────────
//
//   The backing bitmap is sized at DPR × CSS size so 2× retina displays
//   render sharp. All coordinates in this file are in CSS pixels (the DPR
//   scale is applied once in setupCanvas and forgotten).
//
// ── WebGL Migration ───────────────────────────────────────────────────────────
//
//   Replacing Canvas2D with WebGL means:
//     • Each drawRect → instanced quad with fill/stroke shader
//     • drawImage   → textured quad + UV crop rect + filter uniforms
//     • drawPath    → tesselated stroke geometry (or GL_LINE_STRIP)
//     • Selection   → overlay pass with additive blending
//     • Grid        → instanced line geometry (GL_LINES)
//   The scene graph, camera math, and all tools remain unchanged.

import type {
  AnySceneObject,
  Camera,
  CropState,
  GuideLine,
  ImageObject,
  MarqueeState,
  PathObject,
  RenderConfig,
} from "../../types";
import type { IRenderer } from "./IRenderer";
import type { SceneGraph } from "../scene/SceneGraph";
import { HitDetector } from "../hitDetection/HitDetector";
import { Matrix2D } from "../matrix/Matrix2D";
import { CameraController } from "../camera/CameraController";
import { FilterEngine } from "../filters/FilterEngine";

// ── Style Constants ──────────────────────────────────────────────────────────

const HANDLE_RADIUS   = 5;
const HANDLE_FILL     = "#ffffff";
const HANDLE_STROKE   = "#1A73E8";
const SEL_STROKE      = "#1A73E8";
const SEL_DASH        = [5, 3];
const ROTATE_OFFSET   = 28;   // CSS pixels from top-center to rotate handle

// Outer void (area outside artboard)
const VOID_COLOR      = "#111118";

// Artboard decorations
const ARTBOARD_SHADOW = "rgba(0,0,0,0.35)";
const ARTBOARD_BORDER = "rgba(255,255,255,0.12)";

// Grid
const GRID_COLOR      = "rgba(255,255,255,0.06)";
const GRID_MAJOR_MULT = 5;          // every Nth grid line is "major"
const GRID_MAJOR_COL  = "rgba(255,255,255,0.12)";
const MIN_CELL_PX     = 8;          // skip grid lines denser than this on screen

// Snap guides
const GUIDE_WIDTH     = 1;          // screen pixels

// Marquee
const MARQUEE_FILL    = "rgba(26, 115, 232, 0.07)";
const MARQUEE_STROKE  = "#1A73E8";

// ── Zoom-adaptive grid density lookup ────────────────────────────────────────
// Candidate multipliers for grid size. We pick the smallest multiplier such that
// gridSize * multiplier * zoom >= MIN_CELL_PX (cells are at least MIN_CELL_PX
// screen pixels apart). Powers of 2 feel natural for engineering grids; the
// final ×5 jumps align with "ruler major ticks" convention.
const GRID_MULTIPLIERS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

export class Renderer implements IRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr: number;
  private rafId: number | null = null;
  private dirty = true;
  private hitDetector = new HitDetector();

  // ── Per-frame overlay state (tools write, renderer reads) ─────────────────
  cropState: CropState | null = null;
  marqueeState: MarqueeState | null = null;
  snapGuides: GuideLine[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D context from canvas");
    this.ctx = ctx;
    this.dpr = window.devicePixelRatio || 1;
    this.applyDPR();
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  private applyDPR(): void {
    const w = this.canvas.clientWidth  || this.canvas.width;
    const h = this.canvas.clientHeight || this.canvas.height;
    this.canvas.width  = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.ctx.scale(this.dpr, this.dpr);
  }

  resize(width: number, height: number): void {
    this.canvas.width  = width  * this.dpr;
    this.canvas.height = height * this.dpr;
    this.ctx.scale(this.dpr, this.dpr);
    this.markDirty();
  }

  // ── Render Loop ───────────────────────────────────────────────────────────

  start(
    sceneGraph: SceneGraph,
    getCamera: () => Camera,
    getConfig: () => RenderConfig
  ): void {
    const loop = () => {
      if (this.dirty) {
        this.render(sceneGraph, getCamera(), getConfig());
        this.dirty = false;
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  markDirty(): void {
    this.dirty = true;
  }

  // ── Main Render Pipeline ──────────────────────────────────────────────────

  render(sceneGraph: SceneGraph, camera: Camera, config: RenderConfig): void {
    const ctx  = this.ctx;
    const cssW = this.canvas.width  / this.dpr;
    const cssH = this.canvas.height / this.dpr;

    // 1. Clear
    ctx.clearRect(0, 0, cssW, cssH);

    // 2. Outer void background (covers full viewport before camera transform)
    ctx.fillStyle = VOID_COLOR;
    ctx.fillRect(0, 0, cssW, cssH);

    // 3. Enter camera space — everything from here is in world coordinates.
    //    ctx.scale(zoom, zoom) means 1 world unit = zoom CSS pixels.
    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.zoom, camera.zoom);

    const { artboardWidth: aw, artboardHeight: ah } = config;

    // 4. Artboard drop shadow (constant screen-pixel offset via world-space trick)
    const shadowOff = 8 / camera.zoom;  // 8 CSS pixels regardless of zoom
    ctx.fillStyle = ARTBOARD_SHADOW;
    ctx.fillRect(shadowOff, shadowOff, aw, ah);

    // 5. Artboard background
    ctx.fillStyle = config.artboardBackground;
    ctx.fillRect(0, 0, aw, ah);

    // Subtle artboard border (1 CSS pixel)
    ctx.strokeStyle = ARTBOARD_BORDER;
    ctx.lineWidth = 1 / camera.zoom;
    ctx.strokeRect(0, 0, aw, ah);

    // 6. Grid (only if enabled, only within artboard)
    if (config.showGrid && config.gridSize > 0) {
      this.drawGrid(ctx, camera, cssW, cssH, config, aw, ah);
    }

    // 7. Objects — bottom to top, with viewport culling + filter support
    const vb = CameraController.getViewportBounds(cssW, cssH, camera);

    for (const obj of sceneGraph.getAll()) {
      if (!obj.visible) continue;
      if (!this.isObjectVisible(obj, vb)) continue;

      ctx.save();
      ctx.globalAlpha = obj.opacity;

      if (obj.type !== "path") {
        this.applyObjectTransform(obj);
      }

      this.drawObject(obj);
      ctx.restore();
    }

    // 8. Selection overlays (above all objects, below guides/marquee)
    for (const obj of sceneGraph.getAll()) {
      if (!obj.selected || !obj.visible) continue;
      if (this.cropState?.isActive && this.cropState.targetId === obj.id) continue;
      ctx.save();
      this.drawSelectionOverlay(obj, camera.zoom);
      ctx.restore();
    }

    // 9. Snap guide lines
    if (this.snapGuides.length > 0) {
      this.drawSnapGuides(ctx, camera.zoom);
    }

    // 10. Marquee rubber-band
    if (this.marqueeState?.active) {
      this.drawMarquee(ctx, camera.zoom);
    }

    // 11. Crop overlay
    if (this.cropState?.isActive && this.cropState.phase !== "idle") {
      ctx.save();
      this.drawCropOverlay(this.cropState, cssW, cssH, camera);
      ctx.restore();
    }

    ctx.restore(); // exit camera space
  }

  // ── Viewport Culling ──────────────────────────────────────────────────────
  // Uses the circumradius of the bounding box as a conservative test.
  // This correctly handles rotated objects — the circle always contains the
  // rotated corners, so we never cull a visible object.
  private isObjectVisible(
    obj: AnySceneObject,
    vb: { left: number; top: number; right: number; bottom: number }
  ): boolean {
    const r  = Math.hypot(obj.width, obj.height) / 2;
    const cx = obj.x + obj.width  / 2;
    const cy = obj.y + obj.height / 2;
    return (
      cx + r >= vb.left  &&
      cx - r <= vb.right &&
      cy + r >= vb.top   &&
      cy - r <= vb.bottom
    );
  }

  // ── Adaptive Grid ─────────────────────────────────────────────────────────
  //
  // Grid lines are rendered in world space inside the camera transform.
  // We batch ALL lines into a single path → one GPU draw call per color.
  //
  // Density adapts so cells are never smaller than MIN_CELL_PX on screen.
  // At zoom=0.1 with gridSize=20: screenCellPx = 2 → multiply until ≥ 8.
  //
  // We also clip grid to the artboard bounds to avoid visual noise in the void.
  private drawGrid(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    cssW: number,
    cssH: number,
    config: RenderConfig,
    aw: number,
    ah: number
  ): void {
    const vb = CameraController.getViewportBounds(cssW, cssH, camera);

    // Clamp visible area to artboard
    const left   = Math.max(vb.left,   0);
    const top    = Math.max(vb.top,    0);
    const right  = Math.min(vb.right,  aw);
    const bottom = Math.min(vb.bottom, ah);

    if (right <= left || bottom <= top) return;

    // Find adaptive grid size: smallest multiplier that keeps cells ≥ MIN_CELL_PX
    let gs = config.gridSize;
    for (const mult of GRID_MULTIPLIERS) {
      gs = config.gridSize * mult;
      if (gs * camera.zoom >= MIN_CELL_PX) break;
    }

    const majorGS = gs * GRID_MAJOR_MULT;

    // Draw minor grid lines
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth   = 1 / camera.zoom;
    ctx.beginPath();

    const startX = Math.ceil(left / gs) * gs;
    for (let x = startX; x <= right; x += gs) {
      if (x % majorGS === 0) continue; // skip major lines (drawn separately)
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    }
    const startY = Math.ceil(top / gs) * gs;
    for (let y = startY; y <= bottom; y += gs) {
      if (y % majorGS === 0) continue;
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
    }
    ctx.stroke();

    // Draw major grid lines (every GRID_MAJOR_MULT minor lines)
    if (majorGS * camera.zoom < cssW) { // only if they'd appear on screen
      ctx.strokeStyle = GRID_MAJOR_COL;
      ctx.beginPath();
      const startMX = Math.ceil(left / majorGS) * majorGS;
      for (let x = startMX; x <= right; x += majorGS) {
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
      }
      const startMY = Math.ceil(top / majorGS) * majorGS;
      for (let y = startMY; y <= bottom; y += majorGS) {
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
      }
      ctx.stroke();
    }
  }

  // ── Transform Application ─────────────────────────────────────────────────

  private applyObjectTransform(obj: AnySceneObject): void {
    Matrix2D.forObject(
      obj.x, obj.y, obj.width, obj.height,
      obj.rotation, obj.scaleX, obj.scaleY
    ).applyToContext(this.ctx);
  }

  // ── Object Drawing Dispatch ───────────────────────────────────────────────

  private drawObject(obj: AnySceneObject): void {
    switch (obj.type) {
      case "rect":   this.drawRect(obj);              break;
      case "circle": this.drawCircle(obj);            break;
      case "line":   this.drawLine(obj);              break;
      case "text":   this.drawText(obj);              break;
      case "image":  this.drawImage(obj as ImageObject); break;
      case "path":   this.drawPath(obj as PathObject); break;
    }
  }

  private drawRect(obj: Extract<AnySceneObject, { type: "rect" }>): void {
    const ctx = this.ctx;
    const { x, y, width, height, fillColor, strokeColor, strokeWidth, cornerRadius } = obj;

    ctx.beginPath();
    if (cornerRadius > 0) {
      ctx.roundRect(x, y, width, height, cornerRadius);
    } else {
      ctx.rect(x, y, width, height);
    }

    if (fillColor) { ctx.fillStyle = fillColor; ctx.fill(); }
    if (strokeWidth > 0) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }
  }

  private drawCircle(obj: Extract<AnySceneObject, { type: "circle" }>): void {
    const ctx = this.ctx;
    const { x, y, width, height, fillColor, strokeColor, strokeWidth } = obj;

    ctx.beginPath();
    ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);

    if (fillColor) { ctx.fillStyle = fillColor; ctx.fill(); }
    if (strokeWidth > 0) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }
  }

  private drawLine(obj: Extract<AnySceneObject, { type: "line" }>): void {
    const ctx = this.ctx;
    const { x, y, x2, y2, strokeColor, strokeWidth, arrowHead } = obj;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();

    if (arrowHead) {
      this.drawArrowHead(x2, y2, Math.atan2(y2 - y, x2 - x), strokeColor, strokeWidth);
    }
  }

  private drawArrowHead(
    tipX: number, tipY: number, angle: number,
    color: string, lineWidth: number
  ): void {
    const ctx = this.ctx;
    const len = Math.max(12, lineWidth * 4);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - len * Math.cos(angle - Math.PI / 7), tipY - len * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(tipX - len * Math.cos(angle + Math.PI / 7), tipY - len * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  private drawText(obj: Extract<AnySceneObject, { type: "text" }>): void {
    const ctx = this.ctx;
    const { x, y, width, fontSize, fontFamily, fontWeight, fontStyle,
            textColor, textAlign, content, lineHeight } = obj;

    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.fillStyle = textColor;
    ctx.textAlign = textAlign;
    ctx.textBaseline = "top";

    const lineH  = fontSize * lineHeight;
    const startX = textAlign === "center" ? x + width / 2
                 : textAlign === "right"  ? x + width
                 : x;

    let line = "";
    let lineY = y;
    for (const word of content.split(" ")) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > width && line) {
        ctx.fillText(line, startX, lineY);
        line = word;
        lineY += lineH;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, startX, lineY);
  }

  // ── Image rendering ───────────────────────────────────────────────────────
  //
  // Supports non-destructive crop (9-arg drawImage), flip, and CSS filters.
  //
  // Filter application:
  //   ctx.filter = "brightness(120%) blur(2px)"  ← set before draw
  //   ctx.drawImage(...)
  //   ctx.filter = "none"                         ← MUST reset, affects all draws
  //
  // WebGL note:
  //   • The 9-arg drawImage maps to a textured quad with UV rect for crop.
  //   • flipX/flipY → UV-space negation (u = 1 - u or v = 1 - v).
  //   • Filters → shader uniforms or post-processing framebuffer passes.
  private drawImage(obj: ImageObject): void {
    const ctx   = this.ctx;
    const imgEl = obj.imageElement;

    if (!imgEl?.complete || imgEl.naturalWidth === 0) {
      ctx.fillStyle = "#2A2A3A";
      ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
      ctx.fillStyle = "#6C7086";
      ctx.font = "13px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Loading image…", obj.x + obj.width / 2, obj.y + obj.height / 2);
      return;
    }

    const sx = obj.cropSx;
    const sy = obj.cropSy;
    const sw = obj.cropSWidth  || imgEl.naturalWidth;
    const sh = obj.cropSHeight || imgEl.naturalHeight;

    // Apply non-destructive filters via ctx.filter (GPU-accelerated)
    if (obj.filters && !FilterEngine.isNeutral(obj.filters)) {
      ctx.filter = FilterEngine.buildFilterString(obj.filters);
    }

    if (obj.flipX || obj.flipY) {
      const cx = obj.x + obj.width  / 2;
      const cy = obj.y + obj.height / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(obj.flipX ? -1 : 1, obj.flipY ? -1 : 1);
      ctx.translate(-cx, -cy);
      ctx.drawImage(imgEl, sx, sy, sw, sh, obj.x, obj.y, obj.width, obj.height);
      ctx.restore();
    } else {
      ctx.drawImage(imgEl, sx, sy, sw, sh, obj.x, obj.y, obj.width, obj.height);
    }

    // Always reset filter — it affects all subsequent draw calls if left set
    if (ctx.filter !== "none") ctx.filter = "none";
  }

  // ── Path / brush-stroke rendering ─────────────────────────────────────────
  // Midpoint Catmull-Rom trick: quadratic Béziers between successive midpoints
  // produce C1-continuous curves with zero extra computation.
  private drawPath(obj: PathObject): void {
    const ctx = this.ctx;
    const { points, strokeColor, strokeWidth, smoothing } = obj;
    if (points.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    if (smoothing && points.length > 2) {
      for (let i = 1; i < points.length - 1; i++) {
        const mx = (points[i].x + points[i + 1].x) / 2;
        const my = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
    } else {
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
    }

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth   = strokeWidth;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";
    ctx.stroke();
  }

  // ── Selection Overlay ─────────────────────────────────────────────────────
  //
  // Renders:
  //   • Dashed bounding-box rect (respects object rotation)
  //   • 8 resize handles (square)
  //   • 1 rotate handle (circle) connected by a line from top-center
  //
  // All sizes are in screen pixels, divided by zoom so they appear constant
  // at any zoom level: a 5px handle looks 5px at 100% and 200% zoom alike.
  private drawSelectionOverlay(obj: AnySceneObject, zoom: number): void {
    const ctx     = this.ctx;
    const handles = this.hitDetector.getHandlePositions(obj);
    const cx      = obj.x + obj.width  / 2;
    const cy      = obj.y + obj.height / 2;

    // Rotated dashed bounding rect
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(obj.rotation);
    ctx.translate(-cx, -cy);
    ctx.strokeStyle = SEL_STROKE;
    ctx.lineWidth   = 1.5 / zoom;
    ctx.setLineDash(SEL_DASH);
    ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
    ctx.setLineDash([]);
    ctx.restore();

    // Connector: top-center → rotate handle
    ctx.strokeStyle = SEL_STROKE;
    ctx.lineWidth   = 1 / zoom;
    ctx.beginPath();
    ctx.moveTo(handles.n.x, handles.n.y);
    ctx.lineTo(handles.rotate.x, handles.rotate.y);
    ctx.stroke();

    // Draw all handles
    const hs = HANDLE_RADIUS / zoom;
    for (const [name, pos] of Object.entries(handles)) {
      ctx.beginPath();
      if (name === "rotate") {
        ctx.arc(pos.x, pos.y, hs, 0, Math.PI * 2);
      } else {
        ctx.rect(pos.x - hs, pos.y - hs, hs * 2, hs * 2);
      }
      ctx.fillStyle   = HANDLE_FILL;
      ctx.fill();
      ctx.strokeStyle = HANDLE_STROKE;
      ctx.lineWidth   = 1.5 / zoom;
      ctx.stroke();
    }
  }

  // ── Snap Guide Lines ──────────────────────────────────────────────────────
  // Rendered as thin colored lines spanning the world-space extents of the
  // aligned edges. The 1px screen-space width is achieved by dividing by zoom.
  private drawSnapGuides(ctx: CanvasRenderingContext2D, zoom: number): void {
    for (const guide of this.snapGuides) {
      ctx.beginPath();
      ctx.moveTo(guide.x1, guide.y1);
      ctx.lineTo(guide.x2, guide.y2);
      ctx.strokeStyle = guide.color;
      ctx.lineWidth   = GUIDE_WIDTH / zoom;
      ctx.stroke();
    }
  }

  // ── Marquee (rubber-band) Selection ──────────────────────────────────────
  // Drawn as a semi-transparent filled rect with a dashed border.
  // Handles negative width/height from dragging right-to-left.
  private drawMarquee(ctx: CanvasRenderingContext2D, zoom: number): void {
    const m = this.marqueeState!;
    const x = m.width  < 0 ? m.x + m.width  : m.x;
    const y = m.height < 0 ? m.y + m.height : m.y;
    const w = Math.abs(m.width);
    const h = Math.abs(m.height);

    ctx.fillStyle   = MARQUEE_FILL;
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = MARQUEE_STROKE;
    ctx.lineWidth   = 1 / zoom;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }

  // ── Crop Overlay ──────────────────────────────────────────────────────────
  // Four dark bands surrounding the crop box + bright border + rule-of-thirds
  // grid + corner/edge handles. All in world space (camera already applied).
  private drawCropOverlay(
    crop: CropState,
    cssW: number,
    cssH: number,
    camera: Camera
  ): void {
    const ctx = this.ctx;
    const { rect } = crop;
    const { x, y, width: w, height: h } = rect;

    // World-space bounds of the full visible viewport
    const wl = -camera.x / camera.zoom;
    const wt = -camera.y / camera.zoom;
    const wr = wl + cssW / camera.zoom;
    const wb = wt + cssH / camera.zoom;

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(wl, wt, wr - wl, y - wt);         // top band
    ctx.fillRect(wl, y, x - wl, h);                // left band
    ctx.fillRect(x + w, y, wr - (x + w), h);       // right band
    ctx.fillRect(wl, y + h, wr - wl, wb - (y + h)); // bottom band

    const zoom = camera.zoom;

    // Crop box border
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth   = 2 / zoom;
    ctx.strokeRect(x, y, w, h);

    // Rule-of-thirds grid
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth   = 1 / zoom;
    ctx.beginPath();
    ctx.moveTo(x + w / 3, y);     ctx.lineTo(x + w / 3, y + h);
    ctx.moveTo(x + w * 2 / 3, y); ctx.lineTo(x + w * 2 / 3, y + h);
    ctx.moveTo(x, y + h / 3);     ctx.lineTo(x + w, y + h / 3);
    ctx.moveTo(x, y + h * 2 / 3); ctx.lineTo(x + w, y + h * 2 / 3);
    ctx.stroke();

    // Corner + edge handles
    const hs = 8 / zoom;
    const pts: [number, number][] = [
      [x,         y],     [x + w,     y],
      [x + w,     y + h], [x,         y + h],
      [x + w / 2, y],     [x + w,     y + h / 2],
      [x + w / 2, y + h], [x,         y + h / 2],
    ];
    ctx.fillStyle   = "#ffffff";
    ctx.strokeStyle = "#1A73E8";
    ctx.lineWidth   = 2 / zoom;
    for (const [px, py] of pts) {
      ctx.fillRect  (px - hs / 2, py - hs / 2, hs, hs);
      ctx.strokeRect(px - hs / 2, py - hs / 2, hs, hs);
    }
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  getCSSSize(): { width: number; height: number } {
    return {
      width:  this.canvas.width  / this.dpr,
      height: this.canvas.height / this.dpr,
    };
  }

  getDPR(): number {
    return this.dpr;
  }
}

// Re-export ROTATE_OFFSET so HitDetector can use the same constant
export { ROTATE_OFFSET };
