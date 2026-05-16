// ─── useEditorEngine ──────────────────────────────────────────────────────────
//
// The bridge between React and the pure-class rendering engine.
//
// Responsibilities:
//   1. Mount Renderer + ToolManager on canvas mount; tear down on unmount
//   2. ResizeObserver: resize the renderer when the canvas container changes size
//   3. Fit the artboard to the viewport on first load
//   4. Wheel zoom (zoom toward cursor)
//   5. Wire ToolManager.onCameraPan → store.setCamera (pan via middle-mouse/space)
//   6. Sync camera snapshot to ToolContext (avoids per-frame React re-renders)
//   7. Sync cropState from store → renderer (the engine↔React bridge)
//   8. Sync cursor world position → store (for status bar)
//   9. Register all keyboard shortcuts via ShortcutManager
//  10. Update ToolManager context when camera or config changes

import { useEffect, useRef } from "react";
import { Renderer } from "../engine/renderer/Renderer";
import { ToolManager } from "../engine/tools/ToolManager";
import { ShortcutManager } from "../engine/shortcuts/ShortcutManager";
import { CameraController } from "../engine/camera/CameraController";
import {
  sceneGraph,
  historyManager,
  useEditorStore,
  rendererRef as globalRendererRef,
} from "../store/editorStore";
import { DuplicateObjectCommand } from "../engine/history/HistoryManager";
import type { ToolContext } from "../engine/tools/BaseTool";
import type { RenderConfig } from "../types";

export function useEditorEngine(
  canvasRef: React.RefObject<HTMLCanvasElement | null>
) {
  const localRenderer     = useRef<Renderer | null>(null);
  const localToolManager  = useRef<ToolManager | null>(null);
  const localShortcuts    = useRef<ShortcutManager | null>(null);

  // Read store actions once — stable references, never trigger re-renders
  const setCamera         = useEditorStore((s) => s.setCamera);
  const setSelectedIds    = useEditorStore((s) => s.setSelectedIds);
  const bumpScene         = useEditorStore((s) => s.bumpScene);
  const syncHistoryState  = useEditorStore((s) => s.syncHistoryState);
  const setCursorWorld    = useEditorStore((s) => s.setCursorWorld);
  const setClipboard      = useEditorStore((s) => s.setClipboard);

  const activeTool  = useEditorStore((s) => s.activeTool);
  const config      = useEditorStore((s) => s.config);
  const camera      = useEditorStore((s) => s.camera);

  // ── Engine initialization (mount once) ────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ── Renderer ──────────────────────────────────────────────────────────

    const renderer = new Renderer(canvas);
    localRenderer.current     = renderer;
    globalRendererRef.current = renderer;

    // Camera snapshot read by the render loop — updated without React re-renders
    const cameraSnap = { current: useEditorStore.getState().camera };

    const unsubCamera = useEditorStore.subscribe((state) => {
      cameraSnap.current = state.camera;
      renderer.markDirty();
    });

    // Sync cropState from Zustand → renderer (engine↔React bridge)
    const unsubCrop = useEditorStore.subscribe((state) => {
      renderer.cropState = state.cropState.isActive ? state.cropState : null;
      renderer.markDirty();
    });

    // Config getter for RenderConfig — called each frame (no allocation if unchanged)
    const getRenderConfig = (): RenderConfig => {
      const cfg = useEditorStore.getState().config;
      return {
        artboardWidth:      cfg.canvasWidth,
        artboardHeight:     cfg.canvasHeight,
        artboardBackground: cfg.backgroundColor,
        showGrid:           cfg.showGrid,
        gridSize:           cfg.gridSize,
      };
    };

    renderer.start(sceneGraph, () => cameraSnap.current, getRenderConfig);

    // ── ToolContext ────────────────────────────────────────────────────────

    const makeToolCtx = (): ToolContext => ({
      scene:   sceneGraph,
      history: historyManager,
      renderer,
      camera:  cameraSnap.current,
      getConfig: () => useEditorStore.getState().config,
      onSelectionChange: (ids) => {
        setSelectedIds(ids);
        syncHistoryState();
      },
      onObjectsChange: () => {
        bumpScene();
        syncHistoryState();
      },
    });

    // ── ToolManager ────────────────────────────────────────────────────────

    const toolManager = new ToolManager(canvas, makeToolCtx());
    localToolManager.current = toolManager;

    // Wire pan callback: ToolManager→store (pan via middle-mouse or space+drag)
    toolManager.onCameraPan = (dx, dy) => {
      const cam = useEditorStore.getState().camera;
      setCamera(CameraController.pan(cam, dx, dy));
    };

    // ── Fit artboard to viewport on first load ─────────────────────────────

    const fitToViewport = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      const cfg = useEditorStore.getState().config;
      const cam = CameraController.fitToArtboard(cfg.canvasWidth, cfg.canvasHeight, w, h);
      setCamera(cam);
    };

    // Defer one frame so the canvas has computed its CSS size
    requestAnimationFrame(fitToViewport);

    // ── ResizeObserver: keep canvas backing store in sync with layout ──────

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          renderer.resize(width, height);
        }
      }
    });
    resizeObserver.observe(canvas);

    // ── Wheel zoom ─────────────────────────────────────────────────────────

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx   = e.clientX - rect.left;
      const my   = e.clientY - rect.top;
      const cam  = useEditorStore.getState().camera;
      const next = CameraController.zoomToward(cam, mx, my, e.deltaY);
      setCamera(next);
    };

    // passive: false so we can call preventDefault() and stop page scroll
    canvas.addEventListener("wheel", onWheel, { passive: false });

    // ── Cursor position in world space (for status bar) ────────────────────

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const cam  = cameraSnap.current;
      const wx   = (e.clientX - rect.left - cam.x) / cam.zoom;
      const wy   = (e.clientY - rect.top  - cam.y) / cam.zoom;
      setCursorWorld({ x: Math.round(wx), y: Math.round(wy) });
    };
    canvas.addEventListener("mousemove", onMouseMove);

    // ── ShortcutManager ────────────────────────────────────────────────────

    const shortcuts = new ShortcutManager();
    localShortcuts.current = shortcuts;

    const afterChange = () => {
      renderer.markDirty();
      bumpScene();
      syncHistoryState();
    };

    shortcuts.registerAll([
      // ── Undo / Redo ───────────────────────────────────────────────────
      {
        key: "z", ctrl: true, shift: false,
        description: "Undo",
        action: () => { historyManager.undo(); afterChange(); },
      },
      {
        key: "z", ctrl: true, shift: true,
        description: "Redo",
        action: () => { historyManager.redo(); afterChange(); },
      },
      {
        key: "y", ctrl: true,
        description: "Redo",
        action: () => { historyManager.redo(); afterChange(); },
      },

      // ── Delete ────────────────────────────────────────────────────────
      {
        key: "Delete",
        description: "Delete selected",
        action: () => {
          const sel = sceneGraph.getSelected();
          for (const obj of sel) sceneGraph.remove(obj.id);
          setSelectedIds([]);
          afterChange();
        },
      },
      {
        key: "Backspace",
        description: "Delete selected",
        action: () => {
          const sel = sceneGraph.getSelected();
          for (const obj of sel) sceneGraph.remove(obj.id);
          setSelectedIds([]);
          afterChange();
        },
      },

      // ── Copy / Paste / Duplicate ──────────────────────────────────────
      {
        key: "c", ctrl: true,
        description: "Copy",
        action: () => {
          const sel = sceneGraph.getSelected();
          if (sel.length > 0) setClipboard(sel.map((o) => ({ ...o })));
        },
      },
      {
        key: "v", ctrl: true,
        description: "Paste",
        action: () => {
          const { clipboard } = useEditorStore.getState();
          if (clipboard.length === 0) return;
          sceneGraph.deselectAll();
          const newIds: string[] = [];
          for (const obj of clipboard) {
            const clone = {
              ...obj,
              id: crypto.randomUUID(),
              x: obj.x + 20,
              y: obj.y + 20,
              selected: true,
            };
            sceneGraph.add(clone as typeof obj);
            newIds.push(clone.id);
          }
          setSelectedIds(newIds);
          afterChange();
        },
      },
      {
        key: "d", ctrl: true,
        description: "Duplicate selected",
        action: () => {
          const sel = sceneGraph.getSelected();
          if (sel.length === 0) return;
          for (const obj of sel) {
            const cmd = new DuplicateObjectCommand(
              sceneGraph, obj,
              (id) => {
                if (id) setSelectedIds([id]);
                afterChange();
              }
            );
            historyManager.execute(cmd);
          }
        },
      },

      // ── Select All ────────────────────────────────────────────────────
      {
        key: "a", ctrl: true,
        description: "Select all",
        action: () => {
          const ids = sceneGraph.getAll().map((o) => {
            o.selected = true;
            return o.id;
          });
          setSelectedIds(ids);
          renderer.markDirty();
          bumpScene();
        },
      },

      // ── Escape ────────────────────────────────────────────────────────
      {
        key: "Escape",
        description: "Cancel / deselect",
        action: () => {
          const cs = useEditorStore.getState().cropState;
          if (cs.isActive) {
            useEditorStore.getState().setCropState({
              isActive: false, targetId: null,
              rect: { x: 0, y: 0, width: 0, height: 0 },
              phase: "idle",
            });
            renderer.cropState = null;
            useEditorStore.getState().setActiveTool("select");
          } else {
            sceneGraph.deselectAll();
            setSelectedIds([]);
          }
          renderer.markDirty();
        },
      },

      // ── Tool shortcuts ────────────────────────────────────────────────
      { key: "v", description: "Select tool",    action: () => useEditorStore.getState().setActiveTool("select")  },
      { key: "r", description: "Rectangle tool", action: () => useEditorStore.getState().setActiveTool("rect")    },
      { key: "o", description: "Circle tool",    action: () => useEditorStore.getState().setActiveTool("circle")  },
      { key: "l", description: "Line tool",      action: () => useEditorStore.getState().setActiveTool("line")    },
      { key: "t", description: "Text tool",      action: () => useEditorStore.getState().setActiveTool("text")    },
      { key: "b", description: "Brush tool",     action: () => useEditorStore.getState().setActiveTool("brush")   },
      { key: "c", description: "Crop tool",      action: () => useEditorStore.getState().setActiveTool("crop")    },

      // ── Zoom shortcuts ────────────────────────────────────────────────
      {
        key: "0", ctrl: true,
        description: "Reset zoom to fit",
        action: () => {
          const w = canvas.clientWidth;
          const h = canvas.clientHeight;
          const cfg = useEditorStore.getState().config;
          setCamera(CameraController.fitToArtboard(cfg.canvasWidth, cfg.canvasHeight, w, h));
        },
      },
      {
        key: "1", ctrl: true,
        description: "Zoom to 100%",
        action: () => {
          const cam = useEditorStore.getState().camera;
          setCamera(CameraController.zoomTo(cam, 1, canvas.clientWidth, canvas.clientHeight));
        },
      },
      {
        key: "=", ctrl: true,
        description: "Zoom in",
        action: () => {
          const cam = useEditorStore.getState().camera;
          setCamera(CameraController.zoomToward(cam, canvas.clientWidth / 2, canvas.clientHeight / 2, -120));
        },
      },
      {
        key: "-", ctrl: true,
        description: "Zoom out",
        action: () => {
          const cam = useEditorStore.getState().camera;
          setCamera(CameraController.zoomToward(cam, canvas.clientWidth / 2, canvas.clientHeight / 2, 120));
        },
      },

      // ── Layer ordering ────────────────────────────────────────────────
      {
        key: "]", ctrl: true,
        description: "Bring forward",
        action: () => {
          for (const obj of sceneGraph.getSelected()) sceneGraph.moveUp(obj.id);
          afterChange();
        },
      },
      {
        key: "[", ctrl: true,
        description: "Send backward",
        action: () => {
          for (const obj of sceneGraph.getSelected()) sceneGraph.moveDown(obj.id);
          afterChange();
        },
      },
    ]);

    shortcuts.mount();

    // ── Cleanup ────────────────────────────────────────────────────────────

    return () => {
      renderer.stop();
      toolManager.dispose();
      shortcuts.dispose();
      resizeObserver.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousemove", onMouseMove);
      unsubCamera();
      unsubCrop();
      globalRendererRef.current = null;
      localRenderer.current     = null;
      localToolManager.current  = null;
      localShortcuts.current    = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentional mount-once

  // ── Sync active tool → ToolManager ────────────────────────────────────────

  useEffect(() => {
    localToolManager.current?.setTool(activeTool);
  }, [activeTool]);

  // ── Sync camera + config → ToolContext ────────────────────────────────────
  // ToolContext.camera is a snapshot used by tools for coordinate conversion.
  // We rebuild and push on every camera/config change.

  useEffect(() => {
    const renderer = localRenderer.current;
    const tm       = localToolManager.current;
    if (!renderer || !tm) return;

    tm.updateContext({
      scene:   sceneGraph,
      history: historyManager,
      renderer,
      camera,
      getConfig: () => useEditorStore.getState().config,
      onSelectionChange: (ids) => {
        useEditorStore.getState().setSelectedIds(ids);
        useEditorStore.getState().syncHistoryState();
      },
      onObjectsChange: () => {
        useEditorStore.getState().bumpScene();
        useEditorStore.getState().syncHistoryState();
      },
    });
  }, [camera, config]);

  return { rendererRef: localRenderer, toolManagerRef: localToolManager };
}
