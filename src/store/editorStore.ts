// ─── Editor Store (Zustand) ────────────────────────────────────────────────────
//
// Single source of truth for all React-visible UI state.
//
// ── Separation of Concerns ────────────────────────────────────────────────────
//
//   Engine singletons (SceneGraph, HistoryManager) live OUTSIDE the store as
//   plain class instances. They are imperative objects with mutable internal
//   state — not serializable React state. Exposing them through the store would
//   cause React to re-render on every scene mutation.
//
//   The store holds lightweight React-visible state:
//     • active tool, selected ids (mirrors, not source of truth)
//     • camera (pan + zoom) — triggers viewport re-renders
//     • config (artboard size, grid settings)
//     • crop state (bridge between CropTool engine and React CropControls)
//     • cursor position (for status bar display)
//     • clipboard (for copy/paste)
//
//   Engine instances are exported as module-level singletons and read directly
//   by components that need them, without triggering store subscriptions.
//
// ── Camera Updates ────────────────────────────────────────────────────────────
//
//   Camera changes come from:
//     1. useEditorEngine wheel handler → setCamera (triggers React re-render)
//     2. ToolManager pan callback → setCamera (called each pointermove while panning)
//
//   React re-render on every pan frame is acceptable because:
//     • Only StatusBar re-renders (it subscribes to camera for zoom display)
//     • The canvas itself is not a React component (it's an imperative Renderer)
//     • The render loop reads camera via a getter closure, not a subscription

import { create } from "zustand";
import type {
  AnySceneObject,
  Camera,
  CropState,
  EditorConfig,
  ToolType,
} from "../types";
import { SceneGraph } from "../engine/scene/SceneGraph";
import { HistoryManager } from "../engine/history/HistoryManager";

// ── Engine Singletons ─────────────────────────────────────────────────────────
// Exported for direct access by components. Not in the store.

export const sceneGraph     = new SceneGraph();
export const historyManager = new HistoryManager();

export const rendererRef: {
  current: import("../engine/renderer/Renderer").Renderer | null;
} = { current: null };

// ── Store Shape ───────────────────────────────────────────────────────────────

interface EditorStore {
  // Active tool
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;

  // Selection mirror (ids only — full objects live in sceneGraph)
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;

  // Camera (pan + zoom) — drives infinite canvas viewport
  camera: Camera;
  setCamera: (partial: Partial<Camera>) => void;

  // Artboard + editor settings
  config: EditorConfig;
  updateConfig: (partial: Partial<EditorConfig>) => void;

  // Scene version counter — bumped after any mutation to trigger React re-renders
  // in components that read from sceneGraph (LayersPanel, PropertiesPanel).
  sceneVersion: number;
  bumpScene: () => void;

  // Undo/redo availability flags (synced from HistoryManager)
  canUndo: boolean;
  canRedo: boolean;
  syncHistoryState: () => void;

  // Crop state — CropTool (engine) writes; CropControls (React) reads
  cropState: CropState;
  setCropState: (state: CropState) => void;

  // Current cursor position in world space (for status bar)
  cursorWorld: { x: number; y: number };
  setCursorWorld: (p: { x: number; y: number }) => void;

  // Clipboard: shallow copy of objects for Ctrl+C / Ctrl+V
  clipboard: AnySceneObject[];
  setClipboard: (objects: AnySceneObject[]) => void;

  // Derived: get selected scene objects
  getSelectedObjects: () => AnySceneObject[];
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const defaultCropState: CropState = {
  isActive: false,
  targetId: null,
  rect: { x: 0, y: 0, width: 0, height: 0 },
  phase: "idle",
};

// ── Store Implementation ──────────────────────────────────────────────────────

export const useEditorStore = create<EditorStore>((set, get) => ({
  activeTool: "select",
  setActiveTool: (tool) => set({ activeTool: tool }),

  selectedIds: [],
  setSelectedIds: (ids) => set({ selectedIds: ids }),

  camera: { x: 0, y: 0, zoom: 1 },
  setCamera: (partial) =>
    set((state) => ({ camera: { ...state.camera, ...partial } })),

  config: {
    canvasWidth:     1200,
    canvasHeight:    700,
    backgroundColor: "#FFFFFF",
    showGrid:        false,
    snapToGrid:      false,
    snapToObjects:   true,
    gridSize:        20,
  },
  updateConfig: (partial) =>
    set((state) => ({ config: { ...state.config, ...partial } })),

  sceneVersion: 0,
  bumpScene: () => set((state) => ({ sceneVersion: state.sceneVersion + 1 })),

  canUndo: false,
  canRedo: false,
  syncHistoryState: () =>
    set({
      canUndo: historyManager.canUndo(),
      canRedo: historyManager.canRedo(),
    }),

  cropState: defaultCropState,
  setCropState: (state) => set({ cropState: state }),

  cursorWorld: { x: 0, y: 0 },
  setCursorWorld: (p) => set({ cursorWorld: p }),

  clipboard: [],
  setClipboard: (objects) => set({ clipboard: objects }),

  getSelectedObjects: () => {
    const { selectedIds } = get();
    return selectedIds
      .map((id) => sceneGraph.getById(id))
      .filter(Boolean) as AnySceneObject[];
  },
}));
