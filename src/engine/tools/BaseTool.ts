// ─── Base Tool ────────────────────────────────────────────────────────────────
// All drawing/interaction tools implement this interface.
//
// The tool system is a State Machine: the active tool owns all pointer events.
// Switching tools via ToolManager is the only way to change behavior — no
// switch/case blocks scattered across event handlers.
//
// Tools receive a ToolContext (access to scene, history, renderer, config) but
// they do NOT import React or touch the DOM directly. This keeps tools
// independently testable as pure logic classes.
//
// ── IRenderer vs Renderer ─────────────────────────────────────────────────────
// ToolContext.renderer is typed as Renderer (the concrete class) because tools
// write to mutable overlay properties (marqueeState, snapGuides) that are
// not part of the IRenderer interface — they are implementation details of the
// Canvas2D renderer. When a WebGL renderer is introduced, it will also expose
// those overlay properties, or tools will be updated to use IRenderer fully.

import type { Camera, EditorConfig, Point, ToolType } from "../../types";
import type { SceneGraph } from "../scene/SceneGraph";
import type { HistoryManager } from "../history/HistoryManager";
import type { Renderer } from "../renderer/Renderer";

export interface ToolContext {
  scene: SceneGraph;
  history: HistoryManager;
  renderer: Renderer;
  camera: Camera;
  // Optional config getter — provides snap/grid settings to tools without
  // triggering React re-renders. Returns undefined if the hook hasn't wired it.
  getConfig?: () => EditorConfig;
  // Callbacks to sync React UI state after tool operations
  onSelectionChange: (ids: string[]) => void;
  onObjectsChange: () => void;
}

export interface BaseTool {
  readonly type: ToolType;

  // Called once when this tool becomes active
  activate(ctx: ToolContext): void;

  // Called once when another tool takes over
  deactivate(ctx: ToolContext): void;

  onPointerDown(e: PointerEvent, point: Point, ctx: ToolContext): void;
  onPointerMove(e: PointerEvent, point: Point, ctx: ToolContext): void;
  onPointerUp(e: PointerEvent, point: Point, ctx: ToolContext): void;

  // Return a CSS cursor string for the current tool + pointer state
  getCursor(point: Point, ctx: ToolContext): string;
}

// ── Utility: screen → world coordinate conversion ────────────────────────────
// Camera pan (camera.x / camera.y) and zoom (camera.zoom) must be inverted.
// Formula: worldX = (screenX - camera.x) / camera.zoom
export function screenToWorld(point: Point, camera: Camera): Point {
  return {
    x: (point.x - camera.x) / camera.zoom,
    y: (point.y - camera.y) / camera.zoom,
  };
}

// Get CSS-pixel point from a PointerEvent relative to the canvas element
export function getCanvasPoint(e: PointerEvent, canvas: HTMLCanvasElement): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// CSS cursor for each resize handle. The rotation parameter is available for
// future "rotate-adjusted" cursor direction (currently unused — requires
// a non-trivial mapping from angle → 8-direction cursor).
export function handleCursor(handle: string, _rotation: number): string {
  const cursors: Record<string, string> = {
    nw: "nw-resize", n: "n-resize",  ne: "ne-resize",
    e:  "e-resize",
    se: "se-resize", s: "s-resize",  sw: "sw-resize",
    w:  "w-resize",
    rotate: "crosshair",
  };
  return cursors[handle] ?? "default";
}
