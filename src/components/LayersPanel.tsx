// ─── Layers Panel ─────────────────────────────────────────────────────────────
// Shows all scene objects in reverse render order (top of list = topmost layer).
// Supports: select, visibility toggle, delete, bring forward, send backward.

import {
  useEditorStore,
  sceneGraph,
  historyManager,
  rendererRef,
} from "../store/editorStore";
import { RemoveObjectCommand } from "../engine/history/HistoryManager";

export default function LayersPanel() {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const setSelectedIds = useEditorStore((s) => s.setSelectedIds);
  const bumpScene = useEditorStore((s) => s.bumpScene);
  const syncHistoryState = useEditorStore((s) => s.syncHistoryState);
  useEditorStore((s) => s.sceneVersion); // re-render on scene changes

  // Display top-to-bottom (index 0 in this list = highest z-order)
  const objects = [...sceneGraph.getAll()].reverse();

  const select = (id: string, shift: boolean) => {
    if (shift) {
      sceneGraph.selectAdd(id);
      setSelectedIds([...selectedIds, id]);
    } else {
      sceneGraph.selectOnly(id);
      setSelectedIds([id]);
    }
    rendererRef.current?.markDirty();
    bumpScene();
  };

  const deleteObject = (id: string) => {
    const cmd = new RemoveObjectCommand(sceneGraph, id, () => {
      bumpScene();
      syncHistoryState();
    });
    historyManager.execute(cmd);
    setSelectedIds(selectedIds.filter((i) => i !== id));
    syncHistoryState();
  };

  const toggleVisibility = (id: string, visible: boolean) => {
    sceneGraph.update(id, { visible });
    rendererRef.current?.markDirty();
    bumpScene();
  };

  const moveUp = (id: string) => {
    sceneGraph.moveUp(id);
    rendererRef.current?.markDirty();
    bumpScene();
  };

  const moveDown = (id: string) => {
    sceneGraph.moveDown(id);
    rendererRef.current?.markDirty();
    bumpScene();
  };

  return (
    <div style={styles.panel}>
      <div style={styles.header}>LAYERS</div>
      {objects.length === 0 ? (
        <p style={styles.empty}>No objects yet</p>
      ) : (
        objects.map((obj, displayIdx) => {
          // displayIdx 0 = topmost; actual array count = objects.length
          const isTop = displayIdx === 0;
          const isBottom = displayIdx === objects.length - 1;

          return (
            <div
              key={obj.id}
              style={{
                ...styles.layer,
                ...(obj.selected ? styles.layerSelected : {}),
                ...(obj.locked ? styles.layerLocked : {}),
              }}
              onClick={(e) => select(obj.id, e.shiftKey)}
            >
              {/* Type icon + name */}
              <span style={styles.typeIcon}>{typeIcon(obj.type)}</span>
              <span style={styles.name}>
                {obj.type} {obj.id.slice(0, 4)}
              </span>

              {/* Controls (right side) */}
              <div style={styles.controls} onClick={(e) => e.stopPropagation()}>
                {/* Z-order: ▲ moves object up in the array = visually in front */}
                <button
                  style={{ ...styles.iconBtn, opacity: isTop ? 0.3 : 1 }}
                  title="Bring forward"
                  disabled={isTop}
                  onClick={() => moveUp(obj.id)}
                >
                  ▲
                </button>
                <button
                  style={{ ...styles.iconBtn, opacity: isBottom ? 0.3 : 1 }}
                  title="Send backward"
                  disabled={isBottom}
                  onClick={() => moveDown(obj.id)}
                >
                  ▼
                </button>
                <button
                  style={styles.iconBtn}
                  title="Toggle visibility"
                  onClick={() => toggleVisibility(obj.id, !obj.visible)}
                >
                  {obj.visible ? "👁" : "🚫"}
                </button>
                <button
                  style={styles.delBtn}
                  title="Delete"
                  onClick={() => deleteObject(obj.id)}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function typeIcon(type: string): string {
  const icons: Record<string, string> = {
    rect: "▭",
    circle: "○",
    line: "╱",
    text: "T",
    image: "🖼",
    path: "✏",
  };
  return icons[type] ?? "?";
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 190,
    background: "#1E1E2E",
    borderRight: "1px solid #313244",
    overflowY: "auto",
    flexShrink: 0,
  },
  header: {
    padding: "10px 12px 6px",
    fontWeight: 600,
    fontSize: 11,
    color: "#89B4FA",
    letterSpacing: 1,
    borderBottom: "1px solid #313244",
  },
  empty: {
    padding: 16,
    color: "#6C7086",
    fontSize: 12,
  },
  layer: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 6px",
    cursor: "pointer",
    fontSize: 12,
    color: "#CDD6F4",
    borderBottom: "1px solid #313244",
    transition: "background 0.1s",
  },
  layerSelected: {
    background: "#313244",
    color: "#89B4FA",
  },
  layerLocked: {
    opacity: 0.6,
  },
  typeIcon: {
    fontSize: 13,
    flexShrink: 0,
    width: 16,
  },
  name: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 11,
    minWidth: 0,
  },
  controls: {
    display: "flex",
    gap: 1,
    flexShrink: 0,
  },
  iconBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 10,
    padding: "1px 2px",
    color: "#A6ADC8",
    lineHeight: 1,
  },
  delBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#F38BA8",
    fontSize: 15,
    padding: "0 2px",
    lineHeight: 1,
  },
};
