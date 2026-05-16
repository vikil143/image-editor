// ─── Tool Manager ─────────────────────────────────────────────────────────────
// Owns all tool instances and routes pointer events to the active tool.
//
// The registry pattern means adding new tools requires zero changes here —
// just add the tool instance to `allTools`. Tools self-describe their type.
//
// ── Camera Interaction ────────────────────────────────────────────────────────
// ToolManager owns camera pan via middle-mouse drag and space+left-drag.
// Wheel zoom is handled in useEditorEngine (at the hook level) because it
// needs to call setCamera to trigger React re-render.
//
// Middle-mouse button:
//   pointerdown button=1 → enter pan mode, capture pointer
//   pointermove          → compute delta, dispatch onCameraPan callback
//   pointerup button=1   → exit pan mode
//
// Space+drag (Figma/Framer model):
//   keydown Space        → set spaceDown = true
//   pointerdown          → if spaceDown, enter pan mode instead of routing to tool
//   keyup Space          → set spaceDown = false; if panning, exit pan mode

import type { BaseTool, ToolContext } from "./BaseTool";
import { getCanvasPoint } from "./BaseTool";
import type { ToolType } from "../../types";
import { SelectTool } from "./SelectTool";
import { RectTool, CircleTool, LineTool, ArrowTool } from "./ShapeTools";
import { TextTool } from "./TextTool";
import { BrushTool } from "./BrushTool";
import { CropTool } from "./CropTool";

export class ToolManager {
  private tools  = new Map<ToolType, BaseTool>();
  private active: BaseTool;
  private canvas: HTMLCanvasElement;
  private ctx: ToolContext;

  // ── Camera pan state ──────────────────────────────────────────────────────
  private isPanning    = false;
  private panLastX     = 0;
  private panLastY     = 0;
  private spaceDown    = false;

  // Hook supplies this callback to update camera in the store
  onCameraPan: ((dx: number, dy: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, context: ToolContext) {
    this.canvas = canvas;
    this.ctx    = context;

    const allTools: BaseTool[] = [
      new SelectTool(),
      new RectTool(),
      new CircleTool(),
      new LineTool(),
      new ArrowTool(),
      new TextTool(),
      new BrushTool(),
      new CropTool(),
    ];
    for (const tool of allTools) this.tools.set(tool.type, tool);

    this.active = this.tools.get("select")!;
    this.active.activate(this.ctx);
    this.attachListeners();
  }

  setTool(type: ToolType): void {
    if (this.active.type === type) return;
    this.active.deactivate(this.ctx);
    const next = this.tools.get(type);
    if (!next) throw new Error(`Unknown tool: ${type}`);
    this.active = next;
    this.active.activate(this.ctx);
  }

  getActiveTool(): ToolType {
    return this.active.type;
  }

  updateContext(ctx: ToolContext): void {
    this.ctx = ctx;
  }

  // ── Event Routing ────────────────────────────────────────────────────────────

  private attachListeners(): void {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup",   this.onPointerUp);
    this.canvas.addEventListener("pointerleave", this.onPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup",   this.onKeyUp);
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown",  this.onPointerDown);
    this.canvas.removeEventListener("pointermove",  this.onPointerMove);
    this.canvas.removeEventListener("pointerup",    this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup",   this.onKeyUp);
    this.active.deactivate(this.ctx);
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);

    // Middle-mouse or space+left = pan
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      this.isPanning = true;
      this.panLastX  = e.clientX;
      this.panLastY  = e.clientY;
      this.canvas.style.cursor = "grabbing";
      return;
    }

    const point = getCanvasPoint(e, this.canvas);
    this.active.onPointerDown(e, point, this.ctx);
    this.updateCursor(point);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.isPanning) {
      const dx = e.clientX - this.panLastX;
      const dy = e.clientY - this.panLastY;
      this.panLastX = e.clientX;
      this.panLastY = e.clientY;
      this.onCameraPan?.(dx, dy);
      return;
    }

    const point = getCanvasPoint(e, this.canvas);
    this.active.onPointerMove(e, point, this.ctx);
    this.updateCursor(point);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.isPanning) {
      this.isPanning = false;
      this.canvas.style.cursor = this.spaceDown ? "grab" : "default";
      return;
    }

    const point = getCanvasPoint(e, this.canvas);
    this.active.onPointerUp(e, point, this.ctx);
    this.updateCursor(point);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "Space") {
      // Prevent the page from scrolling
      const focused = document.activeElement;
      if (
        !(focused instanceof HTMLInputElement) &&
        !(focused instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
      }
      if (!this.spaceDown) {
        this.spaceDown = true;
        if (!this.isPanning) this.canvas.style.cursor = "grab";
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "Space") {
      this.spaceDown = false;
      if (!this.isPanning) this.canvas.style.cursor = "default";
    }
  };

  private updateCursor(point: { x: number; y: number }): void {
    if (this.isPanning || this.spaceDown) return; // pan cursor takes precedence
    this.canvas.style.cursor = this.active.getCursor(point, this.ctx);
  }
}
