// ─── Crop Controls ────────────────────────────────────────────────────────────
// Floating Apply / Cancel bar rendered below the canvas while the crop tool
// is in "confirming" phase.
//
// Why outside the canvas?
//   The crop overlay (dimming + box + handles) is drawn entirely inside the
//   canvas by the Renderer. These buttons live in HTML so they're accessible,
//   keyboard-navigable, and don't require hit-testing against canvas pixels.
//
// applyCrop() is a static method on CropTool so the React layer never needs
// to import the full tool instance — it just calls the helper with the shared
// ToolContext assembled here from store singletons.

import {
  useEditorStore,
  sceneGraph,
  historyManager,
  rendererRef,
} from "../store/editorStore";
import { CropTool } from "../engine/tools/CropTool";
import type { ToolContext } from "../engine/tools/BaseTool";

export default function CropControls() {
  const setCropState = useEditorStore((s) => s.setCropState);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const camera = useEditorStore((s) => s.camera);

  const buildCtx = (): ToolContext | null => {
    const renderer = rendererRef.current;
    if (!renderer) return null;
    return {
      scene: sceneGraph,
      history: historyManager,
      renderer,
      camera,
      onSelectionChange: (ids) => {
        useEditorStore.getState().setSelectedIds(ids);
        useEditorStore.getState().syncHistoryState();
      },
      onObjectsChange: () => {
        useEditorStore.getState().bumpScene();
        useEditorStore.getState().syncHistoryState();
      },
    };
  };

  const handleApply = () => {
    const ctx = buildCtx();
    if (!ctx) return;
    CropTool.applyCrop(ctx);
  };

  const handleCancel = () => {
    setCropState({
      isActive: false,
      targetId: null,
      rect: { x: 0, y: 0, width: 0, height: 0 },
      phase: "idle",
    });
    if (rendererRef.current) {
      rendererRef.current.cropState = null;
      rendererRef.current.markDirty();
    }
    setActiveTool("select");
  };

  return (
    <div style={styles.bar}>
      <span style={styles.hint}>Draw or drag the crop box, then apply.</span>
      <div style={styles.actions}>
        <button style={styles.applyBtn} onClick={handleApply}>
          ✓ Apply Crop
        </button>
        <button style={styles.cancelBtn} onClick={handleCancel}>
          ✕ Cancel
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "8px 14px",
    background: "#1E1E2E",
    border: "1px solid #313244",
    borderRadius: 6,
    width: "100%",
    boxSizing: "border-box",
    flexShrink: 0,
  },
  hint: {
    color: "#A6ADC8",
    fontSize: 12,
  },
  actions: {
    display: "flex",
    gap: 8,
  },
  applyBtn: {
    padding: "6px 16px",
    background: "#A6E3A1",
    border: "none",
    borderRadius: 5,
    color: "#1E1E2E",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  },
  cancelBtn: {
    padding: "6px 14px",
    background: "transparent",
    border: "1px solid #F38BA8",
    borderRadius: 5,
    color: "#F38BA8",
    fontSize: 13,
    cursor: "pointer",
  },
};
