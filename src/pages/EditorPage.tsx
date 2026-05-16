// ─── Editor Page ──────────────────────────────────────────────────────────────
//
// Top-level layout: Toolbar → workspace (layers | canvas | properties) → StatusBar
//
// ── Infinite Canvas Architecture ──────────────────────────────────────────────
//
//   The canvas element fills the entire "canvas area" (flex: 1 between panels).
//   It has NO fixed size — it grows/shrinks with the window.
//   ResizeObserver in useEditorEngine resizes the renderer automatically.
//
//   The artboard (the actual document) is rendered as a white rectangle at
//   world-space (0, 0, canvasWidth, canvasHeight). Objects live in world space.
//   The camera maps world → screen (pan + zoom).
//
//   This is architecturally identical to Figma: the HTML canvas element is an
//   infinite viewport; the document is a finite rectangle within it.

import { useEffect } from "react";
import EditorCanvas from "../components/EditorCanvas";
import Toolbar from "../components/Toolbar";
import PropertiesPanel from "../components/PropertiesPanel";
import LayersPanel from "../components/LayersPanel";
import CropControls from "../components/CropControls";
import StatusBar from "../components/StatusBar";
import { useEditorStore, sceneGraph } from "../store/editorStore";
import { createRect, createCircle, createText } from "../engine/objects/factories";

const EditorPage = () => {
  const bumpScene  = useEditorStore((s) => s.bumpScene);
  const cropState  = useEditorStore((s) => s.cropState);

  // Seed example objects on first load (only when scene is empty)
  useEffect(() => {
    if (sceneGraph.count() > 0) return;

    const r = createRect(60, 60, 180, 120);
    r.fillColor   = "#CBA6F7";
    r.strokeWidth = 0;
    sceneGraph.add(r);

    const c = createCircle(310, 80, 110, 110);
    c.fillColor   = "#FAB387";
    c.strokeWidth = 0;
    sceneGraph.add(c);

    const t = createText(70, 230, "Upload an image or draw shapes to begin!");
    t.fontSize   = 20;
    t.textColor  = "#313244";
    sceneGraph.add(t);

    bumpScene();
  }, []);

  return (
    <div style={styles.app}>
      {/* Top toolbar */}
      <Toolbar />

      {/* Main workspace: panels + canvas */}
      <div style={styles.workspace}>
        <LayersPanel />

        {/* Infinite canvas area — fills all remaining space */}
        <div style={styles.canvasArea}>
          <EditorCanvas />

          {/* Crop confirm/cancel — floats above canvas when confirming */}
          {cropState.isActive && cropState.phase === "confirming" && (
            <div style={styles.cropOverlay}>
              <CropControls />
            </div>
          )}
        </div>

        <PropertiesPanel />
      </div>

      {/* Bottom status bar */}
      <StatusBar />
    </div>
  );
};

export default EditorPage;

const styles: Record<string, React.CSSProperties> = {
  app: {
    display:       "flex",
    flexDirection: "column",
    height:        "100vh",
    background:    "#111118",
    overflow:      "hidden",
    fontFamily:    "Inter, system-ui, sans-serif",
  },
  workspace: {
    display:   "flex",
    flex:      1,
    overflow:  "hidden", // prevent content bleed
    minHeight: 0,        // critical for flex children with overflow
  },
  canvasArea: {
    flex:     1,
    position: "relative", // for cropOverlay positioning
    overflow: "hidden",
    minWidth: 0,
  },
  cropOverlay: {
    position:  "absolute",
    bottom:    16,
    left:      "50%",
    transform: "translateX(-50%)",
    zIndex:    100,
  },
};
