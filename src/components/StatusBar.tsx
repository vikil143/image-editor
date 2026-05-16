// ─── Status Bar ───────────────────────────────────────────────────────────────
//
// Bottom bar showing:
//   • Current zoom level (with presets)
//   • Cursor world-space coordinates
//   • Snap/grid indicator
//   • Object count / selection count
//   • Undo stack depth (for development awareness)
//
// Subscribes only to lightweight store state (camera, cursorWorld, config).
// The canvas renderer and scene graph are read directly — no store subscription.

import { useEditorStore, sceneGraph } from "../store/editorStore";
import { CameraController } from "../engine/camera/CameraController";

export default function StatusBar() {
  const camera      = useEditorStore((s) => s.camera);
  const cursorWorld = useEditorStore((s) => s.cursorWorld);
  const config      = useEditorStore((s) => s.config);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const setCamera   = useEditorStore((s) => s.setCamera);
  useEditorStore((s) => s.sceneVersion); // re-render on scene changes

  const zoomPct    = Math.round(camera.zoom * 100);
  const objectCount = sceneGraph.count();
  const selCount    = selectedIds.length;

  const setZoom = (z: number) => {
    // Zoom to exact level keeping viewport center fixed.
    // We need viewport size but it's not stored — read from the canvas element.
    const canvas = document.querySelector("canvas");
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    setCamera(CameraController.zoomTo(camera, z, w, h));
  };

  const fitArtboard = () => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return;
    const cam = CameraController.fitToArtboard(
      config.canvasWidth, config.canvasHeight,
      canvas.clientWidth, canvas.clientHeight
    );
    setCamera(cam);
  };

  return (
    <div style={styles.bar}>
      {/* Zoom controls */}
      <div style={styles.group}>
        <button style={styles.zoomBtn} onClick={() => setZoom(camera.zoom * 0.8)} title="Zoom out">−</button>
        <div style={styles.zoomDisplay} title="Click to fit artboard" onClick={fitArtboard}>
          {zoomPct}%
        </div>
        <button style={styles.zoomBtn} onClick={() => setZoom(camera.zoom * 1.25)} title="Zoom in">+</button>
      </div>

      <div style={styles.sep} />

      {/* Zoom presets */}
      <div style={styles.group}>
        {[25, 50, 100, 200].map((pct) => (
          <button
            key={pct}
            style={{
              ...styles.presetBtn,
              ...(zoomPct === pct ? styles.presetActive : {}),
            }}
            onClick={() => setZoom(pct / 100)}
          >
            {pct}%
          </button>
        ))}
        <button style={styles.presetBtn} onClick={fitArtboard} title="Ctrl+0">Fit</button>
      </div>

      <div style={styles.sep} />

      {/* Cursor position */}
      <div style={styles.coordDisplay}>
        <span style={styles.label}>X</span>
        <span style={styles.value}>{cursorWorld.x}</span>
        <span style={styles.label}>Y</span>
        <span style={styles.value}>{cursorWorld.y}</span>
      </div>

      <div style={styles.sep} />

      {/* Scene info */}
      <div style={styles.infoGroup}>
        <span style={styles.infoText}>
          {selCount > 0
            ? `${selCount} of ${objectCount} selected`
            : `${objectCount} objects`}
        </span>
      </div>

      <div style={styles.sep} />

      {/* Snap indicators */}
      <div style={styles.group}>
        <SnapIndicator
          active={config.snapToObjects}
          label="Snap"
          title="Object snapping (toggle in View)"
        />
        <SnapIndicator
          active={config.snapToGrid}
          label="Grid"
          title="Grid snapping"
        />
        <SnapIndicator
          active={config.showGrid}
          label="⊞"
          title="Show grid"
        />
      </div>

      {/* Artboard size */}
      <div style={styles.artboardInfo}>
        {config.canvasWidth} × {config.canvasHeight}
      </div>
    </div>
  );
}

function SnapIndicator({
  active,
  label,
  title,
}: {
  active: boolean;
  label: string;
  title: string;
}) {
  return (
    <span
      title={title}
      style={{
        ...styles.snapDot,
        color: active ? "#A6E3A1" : "#45475A",
      }}
    >
      {label}
    </span>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display:        "flex",
    alignItems:     "center",
    gap:            6,
    padding:        "0 12px",
    height:         30,
    background:     "#161622",
    borderTop:      "1px solid #313244",
    flexShrink:     0,
    fontSize:       11,
    color:          "#A6ADC8",
    userSelect:     "none",
  },
  group: {
    display:    "flex",
    alignItems: "center",
    gap:        2,
  },
  sep: {
    width:      1,
    height:     16,
    background: "#313244",
    margin:     "0 4px",
  },
  zoomBtn: {
    width:      20,
    height:     20,
    background: "#2A2A3E",
    border:     "1px solid #45475A",
    borderRadius: 4,
    color:      "#CDD6F4",
    cursor:     "pointer",
    fontSize:   14,
    display:    "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
    padding:    0,
  },
  zoomDisplay: {
    minWidth:   52,
    textAlign:  "center",
    padding:    "2px 6px",
    background: "#2A2A3E",
    border:     "1px solid #45475A",
    borderRadius: 4,
    color:      "#CDD6F4",
    cursor:     "pointer",
    fontSize:   11,
    fontVariantNumeric: "tabular-nums",
  },
  presetBtn: {
    padding:      "1px 5px",
    background:   "transparent",
    border:       "1px solid transparent",
    borderRadius: 3,
    color:        "#6C7086",
    cursor:       "pointer",
    fontSize:     10,
  },
  presetActive: {
    color:        "#89B4FA",
    border:       "1px solid #313244",
    background:   "#2A2A3E",
  },
  coordDisplay: {
    display:    "flex",
    alignItems: "center",
    gap:        4,
    fontVariantNumeric: "tabular-nums",
  },
  label: {
    color:    "#585B70",
    fontSize: 10,
  },
  value: {
    minWidth:     30,
    textAlign:    "right",
    color:        "#CDD6F4",
    fontSize:     11,
  },
  infoGroup: {
    display: "flex",
    gap:     6,
  },
  infoText: {
    color:   "#6C7086",
    fontSize: 10,
  },
  snapDot: {
    fontSize:  10,
    cursor:    "default",
  },
  artboardInfo: {
    marginLeft: "auto",
    color:      "#585B70",
    fontSize:   10,
    fontVariantNumeric: "tabular-nums",
  },
};
