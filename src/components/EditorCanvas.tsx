// ─── EditorCanvas ─────────────────────────────────────────────────────────────
//
// Thin React wrapper around the HTML5 canvas element.
//
// The canvas fills its container 100% × 100% — the container (in EditorPage)
// is the flex-1 area between the layer panel and properties panel.
// ResizeObserver in useEditorEngine automatically resizes the renderer's
// backing store whenever this element's CSS size changes.
//
// All rendering, interaction, and camera logic is in the engine — this
// component only provides the DOM element.

import { useRef } from "react";
import { useEditorEngine } from "../hooks/useEditorEngine";

const EditorCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEditorEngine(canvasRef);

  return (
    <canvas
      ref={canvasRef}
      style={{
        // Fill the entire container — ResizeObserver handles resize
        width:     "100%",
        height:    "100%",
        display:   "block",
        // Prevent text selection during pointer drag
        userSelect: "none",
        touchAction: "none",
      }}
    />
  );
};

export default EditorCanvas;
