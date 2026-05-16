// ─── Toolbar ──────────────────────────────────────────────────────────────────
//
// Top bar: tool selector, image upload, quick-add shapes, view controls, export,
// undo/redo.
//
// Image upload flow:
//   1. Hidden <input type="file"> triggered by a visible button
//   2. FileReader reads the file as a data-URL (base64)
//   3. A new HTMLImageElement loads from that URL asynchronously
//   4. On load: createImage() factory creates the ImageObject with the loaded
//      element attached, then AddObjectCommand commits it to the scene graph

import { useRef } from "react";
import {
  useEditorStore,
  sceneGraph,
  historyManager,
  rendererRef,
} from "../store/editorStore";
import { AddObjectCommand } from "../engine/history/HistoryManager";
import { createRect, createCircle, createText, createImage } from "../engine/objects/factories";
import { ExportManager } from "../engine/export/ExportManager";
import type { ToolType } from "../types";

interface ToolBtn {
  toolType: ToolType;
  label: string;
  icon: string;
  shortcut?: string;
}

const TOOLS: ToolBtn[] = [
  { toolType: "select",  label: "Select",    icon: "↖",  shortcut: "V" },
  { toolType: "rect",    label: "Rectangle", icon: "▭",  shortcut: "R" },
  { toolType: "circle",  label: "Circle",    icon: "○",  shortcut: "O" },
  { toolType: "line",    label: "Line",      icon: "╱",  shortcut: "L" },
  { toolType: "arrow",   label: "Arrow",     icon: "→" },
  { toolType: "text",    label: "Text",      icon: "T",  shortcut: "T" },
  { toolType: "brush",   label: "Brush",     icon: "✏",  shortcut: "B" },
  { toolType: "crop",    label: "Crop",      icon: "⊡",  shortcut: "C" },
];

export default function Toolbar() {
  const activeTool       = useEditorStore((s) => s.activeTool);
  const setActiveTool    = useEditorStore((s) => s.setActiveTool);
  const canUndo          = useEditorStore((s) => s.canUndo);
  const canRedo          = useEditorStore((s) => s.canRedo);
  const bumpScene        = useEditorStore((s) => s.bumpScene);
  const syncHistoryState = useEditorStore((s) => s.syncHistoryState);
  const config           = useEditorStore((s) => s.config);
  const updateConfig     = useEditorStore((s) => s.updateConfig);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const afterHistoryChange = () => {
    rendererRef.current?.markDirty();
    bumpScene();
    syncHistoryState();
  };

  const handleUndo = () => { historyManager.undo(); afterHistoryChange(); };
  const handleRedo = () => { historyManager.redo(); afterHistoryChange(); };

  const addShape = (type: "rect" | "circle" | "text") => {
    const obj =
      type === "rect"   ? createRect(100, 100) :
      type === "circle" ? createCircle(100, 100) :
      createText(100, 100);

    const cmd = new AddObjectCommand(sceneGraph, obj, () => {
      bumpScene();
      syncHistoryState();
    });
    historyManager.execute(cmd);
    sceneGraph.selectOnly(obj.id);
    useEditorStore.getState().setSelectedIds([obj.id]);
    rendererRef.current?.markDirty();
  };

  // ── Image upload ─────────────────────────────────────────────────────────────

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Please select a PNG, JPEG, or WebP image.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      if (!src) return;

      const img = new Image();
      img.onload = () => {
        // Fit within artboard at 70% max, preserving aspect ratio
        const maxW  = config.canvasWidth  * 0.7;
        const maxH  = config.canvasHeight * 0.7;
        const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
        const w     = Math.round(img.naturalWidth  * scale);
        const h     = Math.round(img.naturalHeight * scale);
        const cx    = Math.round((config.canvasWidth  - w) / 2);
        const cy    = Math.round((config.canvasHeight - h) / 2);

        const imageObj = createImage(cx, cy, src, w, h);
        imageObj.imageElement = img;

        const cmd = new AddObjectCommand(sceneGraph, imageObj, () => {
          bumpScene();
          syncHistoryState();
        });
        historyManager.execute(cmd);
        sceneGraph.selectOnly(imageObj.id);
        useEditorStore.getState().setSelectedIds([imageObj.id]);
        rendererRef.current?.markDirty();
      };
      img.onerror = () => alert("Failed to load image.");
      img.src = src;
    };
    reader.readAsDataURL(file);
    e.target.value = ""; // allow re-uploading the same file
  };

  // ── Export ───────────────────────────────────────────────────────────────────

  const handleExportPNG     = () => { const c = rendererRef.current?.canvas; if (c) ExportManager.exportCanvas(c, { format: "png" }); };
  const handleExportJPEG    = () => { const c = rendererRef.current?.canvas; if (c) ExportManager.exportCanvas(c, { format: "jpeg", quality: 0.92 }); };
  const handleExportHighRes = () => ExportManager.exportHighRes(sceneGraph, config, { format: "png", scale: 2 });
  const handleExportSel     = () => ExportManager.exportSelection(sceneGraph, config, { format: "png" });

  return (
    <div style={styles.toolbar}>
      {/* Tool buttons */}
      <div style={styles.group}>
        {TOOLS.map((t) => (
          <button
            key={t.toolType}
            title={`${t.label}${t.shortcut ? ` (${t.shortcut})` : ""}`}
            onClick={() => setActiveTool(t.toolType)}
            style={{
              ...styles.toolBtn,
              ...(activeTool === t.toolType ? styles.toolBtnActive : {}),
            }}
          >
            <span style={styles.toolIcon}>{t.icon}</span>
            <span style={styles.toolLabel}>{t.label}</span>
          </button>
        ))}
      </div>

      <Divider />

      {/* Image upload + quick-add */}
      <div style={styles.group}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        <button style={styles.uploadBtn} onClick={handleUploadClick} title="Upload image">
          <span style={styles.toolIcon}>🖼</span>
          <span style={styles.toolLabel}>Image</span>
        </button>
        <button style={styles.addBtn} onClick={() => addShape("rect")}   title="Add rectangle (R)">+ Rect</button>
        <button style={styles.addBtn} onClick={() => addShape("circle")} title="Add circle (O)">+ Circle</button>
        <button style={styles.addBtn} onClick={() => addShape("text")}   title="Add text (T)">+ Text</button>
      </div>

      <Divider />

      {/* View controls: grid + snapping */}
      <div style={styles.group}>
        <ToggleBtn
          active={config.showGrid}
          onClick={() => {
            updateConfig({ showGrid: !config.showGrid });
            rendererRef.current?.markDirty();
          }}
          title="Toggle grid (View)"
          label="⊞ Grid"
        />
        <ToggleBtn
          active={config.snapToGrid}
          onClick={() => updateConfig({ snapToGrid: !config.snapToGrid })}
          title="Snap to grid"
          label="⊹ Grid Snap"
        />
        <ToggleBtn
          active={config.snapToObjects}
          onClick={() => updateConfig({ snapToObjects: !config.snapToObjects })}
          title="Snap to objects"
          label="◫ Obj Snap"
        />
      </div>

      <Divider />

      {/* Export */}
      <div style={styles.group}>
        <button style={styles.exportBtn} onClick={handleExportPNG}     title="Export visible canvas as PNG">PNG</button>
        <button style={styles.exportBtn} onClick={handleExportJPEG}    title="Export visible canvas as JPEG">JPG</button>
        <button style={styles.exportBtn} onClick={handleExportHighRes}  title="Export artboard at 2× resolution">2× PNG</button>
        <button style={styles.exportBtn} onClick={handleExportSel}      title="Export selected objects">Sel</button>
      </div>

      <Divider />

      {/* Undo / Redo */}
      <div style={styles.group}>
        <button
          style={{ ...styles.actionBtn, opacity: canUndo ? 1 : 0.35 }}
          onClick={handleUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          ↩ Undo
        </button>
        <button
          style={{ ...styles.actionBtn, opacity: canRedo ? 1 : 0.35 }}
          onClick={handleRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
        >
          ↪ Redo
        </button>
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 28, background: "#313244", margin: "0 2px" }} />;
}

function ToggleBtn({
  active, onClick, title, label,
}: {
  active: boolean; onClick: () => void; title: string; label: string;
}) {
  return (
    <button
      style={{
        ...styles.viewBtn,
        ...(active ? styles.viewBtnActive : {}),
      }}
      onClick={onClick}
      title={title}
    >
      {label}
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toolbar: {
    display:     "flex",
    alignItems:  "center",
    gap:         4,
    padding:     "4px 8px",
    background:  "#1E1E2E",
    borderBottom: "1px solid #313244",
    flexWrap:    "wrap",
    flexShrink:  0,
  },
  group: {
    display:    "flex",
    alignItems: "center",
    gap:        2,
  },
  toolBtn: {
    display:       "flex",
    flexDirection: "column",
    alignItems:    "center",
    gap:           1,
    padding:       "3px 6px",
    background:    "transparent",
    border:        "1px solid transparent",
    borderRadius:  6,
    color:         "#CDD6F4",
    cursor:        "pointer",
    fontSize:      10,
    minWidth:      40,
    transition:    "background 0.1s",
  },
  toolBtnActive: {
    background: "#313244",
    border:     "1px solid #89B4FA",
    color:      "#89B4FA",
  },
  toolIcon: {
    fontSize: 15,
  },
  toolLabel: {
    fontSize: 9,
    color:    "inherit",
  },
  uploadBtn: {
    display:       "flex",
    flexDirection: "column",
    alignItems:    "center",
    gap:           1,
    padding:       "3px 8px",
    background:    "#313244",
    border:        "1px solid #A6E3A1",
    borderRadius:  6,
    color:         "#A6E3A1",
    cursor:        "pointer",
    fontSize:      10,
    minWidth:      44,
  },
  addBtn: {
    padding:      "3px 8px",
    background:   "#313244",
    border:       "1px solid #45475A",
    borderRadius: 6,
    color:        "#CDD6F4",
    cursor:       "pointer",
    fontSize:     11,
  },
  viewBtn: {
    padding:      "3px 7px",
    background:   "transparent",
    border:       "1px solid #45475A",
    borderRadius: 5,
    color:        "#6C7086",
    cursor:       "pointer",
    fontSize:     10,
    transition:   "all 0.1s",
  },
  viewBtnActive: {
    background: "#2A2A3E",
    border:     "1px solid #89DCEB",
    color:      "#89DCEB",
  },
  exportBtn: {
    padding:      "3px 8px",
    background:   "#313244",
    border:       "1px solid #89DCEB",
    borderRadius: 5,
    color:        "#89DCEB",
    cursor:       "pointer",
    fontSize:     10,
    fontWeight:   600,
  },
  actionBtn: {
    padding:      "3px 8px",
    background:   "transparent",
    border:       "1px solid #45475A",
    borderRadius: 5,
    color:        "#CDD6F4",
    cursor:       "pointer",
    fontSize:     11,
  },
};
