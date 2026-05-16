// ─── IRenderer — Renderer Abstraction Interface ────────────────────────────────
//
// Every rendering backend (Canvas2D today, WebGL tomorrow) implements this.
// The rest of the engine — tools, hooks, store — reference IRenderer only.
// Swapping to WebGL therefore requires zero changes outside this file + the
// concrete implementation.
//
// Rendering architecture tiers:
//
//   IRenderer (interface)
//   ├── Renderer        → Canvas 2D, current implementation
//   └── WebGLRenderer   → future: GPU-accelerated, texture-based
//
// What belongs here:
//   • Lifecycle (start, stop, resize, markDirty)
//   • Mutable overlays that tools write each frame (cropState, marqueeState, snapGuides)
//
// What does NOT belong here:
//   • Draw call details (those are hidden inside the concrete class)
//   • React / Zustand (engine is framework-agnostic)

import type {
  Camera,
  CropState,
  GuideLine,
  MarqueeState,
  RenderConfig,
} from "../../types";
import type { SceneGraph } from "../scene/SceneGraph";

export interface IRenderer {
  // The underlying DOM canvas element (needed by ToolManager for event attachment
  // and ExportManager for toBlob)
  readonly canvas: HTMLCanvasElement;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  // Start the RAF render loop. Getters are used instead of values so the loop
  // always reads the latest state without React causing re-renders per frame.
  start(
    scene: SceneGraph,
    getCamera: () => Camera,
    getConfig: () => RenderConfig
  ): void;

  stop(): void;

  // Signal that scene state has changed → re-render on next animation frame.
  // Tools call this after every pointer move that modifies the scene.
  // Cost: O(1) — just flips a boolean flag.
  markDirty(): void;

  // Resize the backing store to match the new CSS dimensions.
  // Must be called whenever the canvas element changes size (ResizeObserver).
  resize(width: number, height: number): void;

  // ── Per-frame Overlays ────────────────────────────────────────────────────
  // Tools write these before calling markDirty(). The render loop reads them
  // each frame. Using mutable properties (not callbacks) avoids allocation.

  // Active crop overlay — null when crop tool is inactive
  cropState: CropState | null;

  // Active drag-selection (rubber-band) rectangle — null when not dragging
  marqueeState: MarqueeState | null;

  // Snap alignment guide lines — empty array when nothing is snapping
  snapGuides: GuideLine[];

  // ── Utilities ─────────────────────────────────────────────────────────────

  getCSSSize(): { width: number; height: number };
  getDPR(): number;
}
