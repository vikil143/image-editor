// ─── Crop Tool ────────────────────────────────────────────────────────────────
// Implements non-destructive image cropping.
//
// Interaction flow:
//   1. Tool activates. If an image is selected, pre-populate crop box with
//      the image's current bounding rect.
//   2. pointerDown → start drawing crop box (or resize existing if near handle)
//   3. pointerMove → update crop box live (Renderer reads cropState each frame)
//   4. pointerUp   → phase transitions to "confirming"
//   5. Apply  → applyCrop() is called → image's cropSx/cropSy/cropSWidth/cropSHeight
//               are updated, object repositioned, tool switches to "select"
//   6. Cancel → cropState reset, tool switches to "select"
//
// The Renderer draws the crop overlay from cropState each frame. React reads
// the same store slice to show Apply/Cancel buttons outside the canvas.
//
// Non-destructive crop math:
//   The ImageObject stores the current SOURCE region (in natural-image pixels)
//   it is displaying. When a new crop is applied, we:
//     1. Compute the overlap of the new crop box with the image's canvas rect.
//     2. Convert that overlap to source-pixel coords using the current
//        canvas→source scale factor.
//     3. Store the resulting source region and update the object's canvas rect.
//   This means multiple crops compose correctly: cropping an already-cropped
//   image always works in terms of the current visible region.

import type { BaseTool, ToolContext } from "./BaseTool";
import { screenToWorld } from "./BaseTool";
import type { ImageObject, Point, Rect, ToolType } from "../../types";
import { useEditorStore } from "../../store/editorStore";
import { TransformObjectCommand } from "../history/HistoryManager";

const HANDLE_HIT_RADIUS = 10; // px in world space

type DragMode = "idle" | "drawing" | "moving" | "resizing";
type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "body";

export class CropTool implements BaseTool {
  readonly type: ToolType = "crop";

  private dragMode: DragMode = "idle";
  private dragStart: Point = { x: 0, y: 0 };
  private activeHandle: CropHandle = "se";
  private snapAtDragStart: Rect = { x: 0, y: 0, width: 0, height: 0 };

  activate(ctx: ToolContext): void {
    // Pre-populate crop box from the currently selected image (if any)
    const selected = ctx.scene.getSelected();
    const img = selected.find((o) => o.type === "image") as ImageObject | undefined;

    const rect: Rect = img
      ? { x: img.x, y: img.y, width: img.width, height: img.height }
      : { x: 50, y: 50, width: 200, height: 150 };

    useEditorStore.getState().setCropState({
      isActive: true,
      targetId: img?.id ?? null,
      rect,
      phase: img ? "confirming" : "drawing",
    });

    ctx.renderer.cropState = useEditorStore.getState().cropState;
    ctx.renderer.markDirty();
  }

  deactivate(ctx: ToolContext): void {
    useEditorStore.getState().setCropState({
      isActive: false,
      targetId: null,
      rect: { x: 0, y: 0, width: 0, height: 0 },
      phase: "idle",
    });
    ctx.renderer.cropState = null;
    ctx.renderer.markDirty();
    this.dragMode = "idle";
  }

  onPointerDown(_e: PointerEvent, point: Point, ctx: ToolContext): void {
    const world = screenToWorld(point, ctx.camera);
    const cs = useEditorStore.getState().cropState;

    this.dragStart = world;
    this.snapAtDragStart = { ...cs.rect };

    if (cs.phase === "confirming") {
      const handle = this.hitHandle(world, cs.rect, ctx.camera.zoom);
      if (handle === "body") {
        this.dragMode = "moving";
        this.activeHandle = "body";
      } else if (handle) {
        this.dragMode = "resizing";
        this.activeHandle = handle;
      } else {
        // Click outside → start drawing a new crop box
        this.dragMode = "drawing";
        const newRect: Rect = { x: world.x, y: world.y, width: 1, height: 1 };
        useEditorStore.getState().setCropState({ ...cs, rect: newRect, phase: "drawing" });
        ctx.renderer.cropState = useEditorStore.getState().cropState;
      }
    } else {
      // phase === "drawing" or "idle" — start fresh
      this.dragMode = "drawing";
      const newRect: Rect = { x: world.x, y: world.y, width: 1, height: 1 };
      useEditorStore.getState().setCropState({
        ...cs,
        rect: newRect,
        phase: "drawing",
        isActive: true,
      });
      ctx.renderer.cropState = useEditorStore.getState().cropState;
    }

    ctx.renderer.markDirty();
  }

  onPointerMove(_e: PointerEvent, point: Point, ctx: ToolContext): void {
    if (this.dragMode === "idle") return;

    const world = screenToWorld(point, ctx.camera);
    const dx = world.x - this.dragStart.x;
    const dy = world.y - this.dragStart.y;
    const snap = this.snapAtDragStart;
    const cs = useEditorStore.getState().cropState;
    let newRect = { ...cs.rect };

    if (this.dragMode === "drawing") {
      newRect = normalizeRect(snap.x, snap.y, world.x, world.y);
    } else if (this.dragMode === "moving") {
      newRect = {
        x: snap.x + dx,
        y: snap.y + dy,
        width: snap.width,
        height: snap.height,
      };
    } else if (this.dragMode === "resizing") {
      newRect = applyHandleDelta(snap, this.activeHandle, dx, dy);
    }

    useEditorStore.getState().setCropState({ ...cs, rect: newRect });
    ctx.renderer.cropState = useEditorStore.getState().cropState;
    ctx.renderer.markDirty();
  }

  onPointerUp(_e: PointerEvent, _point: Point, ctx: ToolContext): void {
    if (this.dragMode === "idle") return;

    const cs = useEditorStore.getState().cropState;

    // If the drawn rect is too small (accidental click), keep existing box
    if (cs.rect.width < 5 || cs.rect.height < 5) {
      const restored = { ...cs, phase: "confirming" as const, rect: this.snapAtDragStart };
      useEditorStore.getState().setCropState(restored);
      ctx.renderer.cropState = restored;
    } else {
      useEditorStore.getState().setCropState({ ...cs, phase: "confirming" });
      ctx.renderer.cropState = useEditorStore.getState().cropState;
    }

    this.dragMode = "idle";
    ctx.renderer.markDirty();
  }

  getCursor(point: Point, ctx: ToolContext): string {
    if (this.dragMode === "drawing") return "crosshair";
    if (this.dragMode === "moving") return "move";
    if (this.dragMode === "resizing") return handleToCursor(this.activeHandle);

    const cs = useEditorStore.getState().cropState;
    if (cs.phase !== "confirming") return "crosshair";

    const world = screenToWorld(point, ctx.camera);
    const handle = this.hitHandle(world, cs.rect, ctx.camera.zoom);
    if (handle === "body") return "move";
    if (handle) return handleToCursor(handle);
    return "crosshair";
  }

  // ── Crop application (called from React UI via store action) ─────────────────
  // This is a static helper so EditorPage can call it without a tool instance.
  static applyCrop(ctx: ToolContext): void {
    const cs = useEditorStore.getState().cropState;
    if (!cs.isActive || !cs.targetId) return;

    const target = ctx.scene.getById(cs.targetId) as ImageObject | undefined;
    if (!target || target.type !== "image") return;

    const imgEl = target.imageElement;
    if (!imgEl) return;

    // Compute the intersection of the crop box with the image's canvas bounds
    const imgRect: Rect = { x: target.x, y: target.y, width: target.width, height: target.height };
    const intersection = intersectRects(imgRect, cs.rect);
    if (!intersection) return;

    // Current source region
    const srcX = target.cropSx;
    const srcY = target.cropSy;
    const srcW = target.cropSWidth || imgEl.naturalWidth;
    const srcH = target.cropSHeight || imgEl.naturalHeight;

    // Scale: source pixels per canvas pixel
    const scaleX = srcW / target.width;
    const scaleY = srcH / target.height;

    const before = { ...target };
    const after: Partial<ImageObject> = {
      x: intersection.x,
      y: intersection.y,
      width: intersection.width,
      height: intersection.height,
      cropSx: srcX + (intersection.x - target.x) * scaleX,
      cropSy: srcY + (intersection.y - target.y) * scaleY,
      cropSWidth: intersection.width * scaleX,
      cropSHeight: intersection.height * scaleY,
    };

    const cmd = new TransformObjectCommand(
      ctx.scene,
      cs.targetId,
      before,
      after,
      () => {
        ctx.renderer.markDirty();
        useEditorStore.getState().bumpScene();
        useEditorStore.getState().syncHistoryState();
      }
    );
    ctx.history.execute(cmd);

    // Clean up crop state
    useEditorStore.getState().setCropState({
      isActive: false,
      targetId: null,
      rect: { x: 0, y: 0, width: 0, height: 0 },
      phase: "idle",
    });
    ctx.renderer.cropState = null;
    ctx.renderer.markDirty();
    useEditorStore.getState().setActiveTool("select");
  }

  // ── Hit detection for crop handles ─────────────────────────────────────────

  private hitHandle(
    world: Point,
    rect: Rect,
    zoom: number
  ): CropHandle | null {
    const r = HANDLE_HIT_RADIUS / zoom;
    const handles = getCropHandlePositions(rect);

    for (const [name, pos] of Object.entries(handles)) {
      if (Math.abs(world.x - pos.x) <= r && Math.abs(world.y - pos.y) <= r) {
        return name as CropHandle;
      }
    }

    // Check if inside the crop body
    if (
      world.x >= rect.x &&
      world.x <= rect.x + rect.width &&
      world.y >= rect.y &&
      world.y <= rect.y + rect.height
    ) {
      return "body";
    }

    return null;
  }
}

// ── Pure math helpers ─────────────────────────────────────────────────────────

function normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

function applyHandleDelta(
  snap: Rect,
  handle: CropHandle,
  dx: number,
  dy: number
): Rect {
  const MIN = 10;
  let { x, y, width, height } = snap;

  switch (handle) {
    case "se": width = Math.max(MIN, width + dx); height = Math.max(MIN, height + dy); break;
    case "sw": x += dx; width = Math.max(MIN, width - dx); height = Math.max(MIN, height + dy); break;
    case "ne": width = Math.max(MIN, width + dx); y += dy; height = Math.max(MIN, height - dy); break;
    case "nw": x += dx; y += dy; width = Math.max(MIN, width - dx); height = Math.max(MIN, height - dy); break;
    case "e":  width = Math.max(MIN, width + dx); break;
    case "w":  x += dx; width = Math.max(MIN, width - dx); break;
    case "s":  height = Math.max(MIN, height + dy); break;
    case "n":  y += dy; height = Math.max(MIN, height - dy); break;
  }

  return { x, y, width, height };
}

function intersectRects(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function getCropHandlePositions(rect: Rect): Record<string, Point> {
  const { x, y, width: w, height: h } = rect;
  const mx = x + w / 2;
  const my = y + h / 2;
  return {
    nw: { x, y },
    n: { x: mx, y },
    ne: { x: x + w, y },
    e: { x: x + w, y: my },
    se: { x: x + w, y: y + h },
    s: { x: mx, y: y + h },
    sw: { x, y: y + h },
    w: { x, y: my },
  };
}

function handleToCursor(handle: CropHandle): string {
  const map: Record<string, string> = {
    nw: "nw-resize", n: "n-resize", ne: "ne-resize",
    e: "e-resize",
    se: "se-resize", s: "s-resize", sw: "sw-resize",
    w: "w-resize",
    body: "move",
  };
  return map[handle] ?? "crosshair";
}
