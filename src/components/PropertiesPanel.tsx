// ─── Properties Panel ─────────────────────────────────────────────────────────
//
// Shows editable properties for the currently selected object.
// Updates are applied live via sceneGraph.update() + markDirty().
// No intermediate state — edits are immediate and undoable via HistoryManager.

import { useEditorStore, sceneGraph, rendererRef, historyManager } from "../store/editorStore";
import { FilterCommand } from "../engine/history/HistoryManager";
import { FilterEngine, NEUTRAL_FILTERS } from "../engine/filters/FilterEngine";
import type {
  AnySceneObject,
  RectObject,
  CircleObject,
  TextObject,
  ImageObject,
  PathObject,
  FilterState,
} from "../types";

export default function PropertiesPanel() {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  useEditorStore((s) => s.sceneVersion);

  const selected = selectedIds
    .map((id) => sceneGraph.getById(id))
    .filter(Boolean) as AnySceneObject[];

  if (selected.length === 0) {
    return (
      <div style={styles.panel}>
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>↖</div>
          <div style={styles.emptyText}>Select an object to edit its properties</div>
        </div>
      </div>
    );
  }

  if (selected.length > 1) {
    return (
      <div style={styles.panel}>
        <div style={styles.header}>{selected.length} OBJECTS</div>
        <Section title="Position">
          <Row label="X">
            <NumberInput
              value={Math.round(selected[0].x)}
              onChange={(v) => {
                for (const o of selected) update(o.id, { x: v });
              }}
            />
          </Row>
          <Row label="Y">
            <NumberInput
              value={Math.round(selected[0].y)}
              onChange={(v) => {
                for (const o of selected) update(o.id, { y: v });
              }}
            />
          </Row>
        </Section>
      </div>
    );
  }

  const obj = selected[0];

  return (
    <div style={styles.panel}>
      <div style={styles.header}>{obj.type.toUpperCase()}</div>

      <Section title="Position & Size">
        <Row label="X">
          <NumberInput value={Math.round(obj.x)}     onChange={(v) => update(obj.id, { x: v })} />
        </Row>
        <Row label="Y">
          <NumberInput value={Math.round(obj.y)}     onChange={(v) => update(obj.id, { y: v })} />
        </Row>
        <Row label="W">
          <NumberInput value={Math.round(obj.width)}  onChange={(v) => update(obj.id, { width: Math.max(1, v) })} min={1} />
        </Row>
        <Row label="H">
          <NumberInput value={Math.round(obj.height)} onChange={(v) => update(obj.id, { height: Math.max(1, v) })} min={1} />
        </Row>
        {obj.type !== "path" && (
          <Row label="Angle">
            <NumberInput
              value={Math.round((obj.rotation * 180) / Math.PI)}
              onChange={(v) => update(obj.id, { rotation: (v * Math.PI) / 180 })}
            />
          </Row>
        )}
      </Section>

      <Section title="Appearance">
        <Row label="Opacity">
          <NumberInput
            value={Math.round(obj.opacity * 100)}
            onChange={(v) => update(obj.id, { opacity: Math.max(0, Math.min(1, v / 100)) })}
            min={0} max={100}
          />
        </Row>

        {(obj.type === "rect" || obj.type === "circle") && (
          <>
            <Row label="Fill">
              <ColorInput
                value={(obj as RectObject | CircleObject).fillColor}
                onChange={(v) => update(obj.id, { fillColor: v } as any)}
              />
            </Row>
            <Row label="Stroke">
              <ColorInput
                value={(obj as RectObject | CircleObject).strokeColor}
                onChange={(v) => update(obj.id, { strokeColor: v } as any)}
              />
            </Row>
            <Row label="S.W">
              <NumberInput
                value={(obj as RectObject | CircleObject).strokeWidth}
                onChange={(v) => update(obj.id, { strokeWidth: v } as any)}
                min={0}
              />
            </Row>
          </>
        )}

        {obj.type === "rect" && (
          <Row label="Radius">
            <NumberInput
              value={(obj as RectObject).cornerRadius}
              onChange={(v) => update(obj.id, { cornerRadius: v } as any)}
              min={0}
            />
          </Row>
        )}

        {obj.type === "text"  && <TextProperties  obj={obj as TextObject}  />}
        {obj.type === "image" && <ImageProperties obj={obj as ImageObject} />}
        {obj.type === "path"  && <PathProperties  obj={obj as PathObject}  />}
      </Section>

      <Section title="Visibility">
        <Row label="Visible">
          <input type="checkbox" checked={obj.visible} onChange={(e) => update(obj.id, { visible: e.target.checked })} />
        </Row>
        <Row label="Locked">
          <input type="checkbox" checked={obj.locked}  onChange={(e) => update(obj.id, { locked: e.target.checked })} />
        </Row>
      </Section>
    </div>
  );
}

// ── Type-specific property sections ──────────────────────────────────────────

function TextProperties({ obj }: { obj: TextObject }) {
  return (
    <>
      <Row label="Color">
        <ColorInput value={obj.textColor} onChange={(v) => update(obj.id, { textColor: v } as any)} />
      </Row>
      <Row label="Size">
        <NumberInput value={obj.fontSize} onChange={(v) => update(obj.id, { fontSize: v } as any)} min={6} />
      </Row>
      <Row label="Align">
        <select
          value={obj.textAlign}
          onChange={(e) => update(obj.id, { textAlign: e.target.value as CanvasTextAlign } as any)}
          style={styles.select}
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </Row>
      <Row label="Bold">
        <input
          type="checkbox"
          checked={obj.fontWeight === "700"}
          onChange={(e) => update(obj.id, { fontWeight: e.target.checked ? "700" : "400" } as any)}
        />
      </Row>
      <Row label="Italic">
        <input
          type="checkbox"
          checked={obj.fontStyle === "italic"}
          onChange={(e) => update(obj.id, { fontStyle: e.target.checked ? "italic" : "normal" } as any)}
        />
      </Row>
      <Row label="Text">
        <textarea
          style={styles.textarea}
          value={obj.content}
          onChange={(e) => update(obj.id, { content: e.target.value } as any)}
          rows={3}
        />
      </Row>
    </>
  );
}

function ImageProperties({ obj }: { obj: ImageObject }) {
  const setActiveTool = useEditorStore((s) => s.setActiveTool);

  const hasCrop   = obj.cropSWidth > 0 || obj.cropSHeight > 0;
  const naturalW  = obj.imageElement?.naturalWidth  ?? "—";
  const naturalH  = obj.imageElement?.naturalHeight ?? "—";
  const filters   = obj.filters ?? NEUTRAL_FILTERS;

  const updateFilter = (patch: Partial<FilterState>) => {
    const before = obj.filters;
    const after  = FilterEngine.clamp(FilterEngine.merge(filters, patch));
    const cmd = new FilterCommand(
      sceneGraph, obj.id, before, after,
      () => {
        rendererRef.current?.markDirty();
        useEditorStore.getState().bumpScene();
      }
    );
    historyManager.execute(cmd);
    rendererRef.current?.markDirty();
    useEditorStore.getState().bumpScene();
  };

  const resetFilters = () => {
    updateFilter({ ...NEUTRAL_FILTERS });
  };

  const isFiltered = !FilterEngine.isNeutral(filters);

  return (
    <>
      <Row label="Source">
        <span style={styles.readonlyText}>{naturalW}×{naturalH}px</span>
      </Row>

      {hasCrop && (
        <>
          <Row label="Crop W"><span style={styles.readonlyText}>{Math.round(obj.cropSWidth)}</span></Row>
          <Row label="Crop H"><span style={styles.readonlyText}>{Math.round(obj.cropSHeight)}</span></Row>
        </>
      )}

      <Row label="Flip X">
        <input type="checkbox" checked={obj.flipX} onChange={(e) => update(obj.id, { flipX: e.target.checked } as any)} />
      </Row>
      <Row label="Flip Y">
        <input type="checkbox" checked={obj.flipY} onChange={(e) => update(obj.id, { flipY: e.target.checked } as any)} />
      </Row>

      <div style={{ padding: "4px 12px", display: "flex", gap: 4 }}>
        <button
          style={styles.actionBtnSmall}
          onClick={() => {
            sceneGraph.selectOnly(obj.id);
            useEditorStore.getState().setSelectedIds([obj.id]);
            setActiveTool("crop");
          }}
        >
          ⊡ Crop
        </button>
        {hasCrop && (
          <button
            style={styles.resetBtnSmall}
            onClick={() => update(obj.id, { cropSx: 0, cropSy: 0, cropSWidth: 0, cropSHeight: 0 } as any)}
          >
            Reset Crop
          </button>
        )}
      </div>

      {/* ── Image Filters ── */}
      <div style={styles.filterHeader}>
        <span>Filters</span>
        {isFiltered && (
          <button style={styles.resetFiltersBtn} onClick={resetFilters}>Reset</button>
        )}
      </div>

      <FilterSlider
        label="Brightness"
        value={filters.brightness}
        min={0} max={300} neutral={100}
        onChange={(v) => updateFilter({ brightness: v })}
      />
      <FilterSlider
        label="Contrast"
        value={filters.contrast}
        min={0} max={300} neutral={100}
        onChange={(v) => updateFilter({ contrast: v })}
      />
      <FilterSlider
        label="Saturation"
        value={filters.saturation}
        min={0} max={300} neutral={100}
        onChange={(v) => updateFilter({ saturation: v })}
      />
      <FilterSlider
        label="Grayscale"
        value={filters.grayscale}
        min={0} max={100} neutral={0}
        onChange={(v) => updateFilter({ grayscale: v })}
      />
      <FilterSlider
        label="Blur"
        value={filters.blur}
        min={0} max={40} neutral={0}
        onChange={(v) => updateFilter({ blur: v })}
      />
      <FilterSlider
        label="Hue Rotate"
        value={filters.hueRotate}
        min={0} max={360} neutral={0}
        onChange={(v) => updateFilter({ hueRotate: v })}
      />
      <FilterSlider
        label="Invert"
        value={filters.invert}
        min={0} max={100} neutral={0}
        onChange={(v) => updateFilter({ invert: v })}
      />
      <FilterSlider
        label="Sepia"
        value={filters.sepia}
        min={0} max={100} neutral={0}
        onChange={(v) => updateFilter({ sepia: v })}
      />
    </>
  );
}

function PathProperties({ obj }: { obj: PathObject }) {
  return (
    <>
      <Row label="Color">
        <ColorInput value={obj.strokeColor} onChange={(v) => update(obj.id, { strokeColor: v } as any)} />
      </Row>
      <Row label="Width">
        <NumberInput value={obj.strokeWidth} onChange={(v) => update(obj.id, { strokeWidth: v } as any)} min={1} max={50} />
      </Row>
      <Row label="Smooth">
        <input type="checkbox" checked={obj.smoothing} onChange={(e) => update(obj.id, { smoothing: e.target.checked } as any)} />
      </Row>
      <Row label="Points">
        <span style={styles.readonlyText}>{obj.points.length}</span>
      </Row>
    </>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function update(id: string, partial: Partial<AnySceneObject>) {
  sceneGraph.update(id, partial);
  rendererRef.current?.markDirty();
  useEditorStore.getState().bumpScene();
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <div style={styles.rowValue}>{children}</div>
    </div>
  );
}

function NumberInput({
  value, onChange, min = -99999, max = 99999,
}: {
  value: number; onChange: (v: number) => void; min?: number; max?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min} max={max}
      style={styles.numberInput}
    />
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={styles.colorRow}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} style={styles.colorSwatch} />
      <input type="text"  value={value} onChange={(e) => onChange(e.target.value)} style={styles.colorText} />
    </div>
  );
}

function FilterSlider({
  label, value, min, max, neutral, onChange,
}: {
  label: string; value: number; min: number; max: number; neutral: number;
  onChange: (v: number) => void;
}) {
  const isChanged = value !== neutral;
  return (
    <div style={styles.filterRow}>
      <span style={{ ...styles.filterLabel, color: isChanged ? "#CDD6F4" : "#585B70" }}>
        {label}
      </span>
      <input
        type="range"
        min={min} max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={styles.slider}
      />
      <span style={styles.filterValue}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width:     224,
    background: "#1E1E2E",
    borderLeft: "1px solid #313244",
    overflowY:  "auto",
    color:      "#CDD6F4",
    fontSize:   12,
    flexShrink: 0,
    display:    "flex",
    flexDirection: "column",
  },
  emptyState: {
    flex:           1,
    display:        "flex",
    flexDirection:  "column",
    alignItems:     "center",
    justifyContent: "center",
    gap:            8,
    padding:        24,
  },
  emptyIcon: {
    fontSize: 32,
    color:    "#313244",
  },
  emptyText: {
    color:     "#585B70",
    fontSize:  11,
    textAlign: "center",
    lineHeight: 1.4,
  },
  header: {
    padding:      "10px 12px 6px",
    fontWeight:   600,
    fontSize:     10,
    color:        "#89B4FA",
    letterSpacing: 1,
    borderBottom: "1px solid #313244",
  },
  section: {
    borderBottom: "1px solid #313244",
    padding:      "6px 0",
  },
  sectionTitle: {
    padding:       "2px 12px 4px",
    fontSize:      10,
    color:         "#585B70",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: {
    display:    "flex",
    alignItems: "center",
    padding:    "2px 12px",
    gap:        8,
  },
  rowLabel: {
    width:     54,
    color:     "#A6ADC8",
    fontSize:  11,
    flexShrink: 0,
  },
  rowValue: {
    flex: 1,
  },
  numberInput: {
    width:        "100%",
    background:   "#313244",
    border:       "1px solid #45475A",
    borderRadius: 4,
    color:        "#CDD6F4",
    padding:      "2px 6px",
    fontSize:     11,
  },
  colorRow: {
    display:    "flex",
    alignItems: "center",
    gap:        6,
  },
  colorSwatch: {
    width:        22,
    height:       22,
    padding:      0,
    border:       "none",
    borderRadius: 4,
    cursor:       "pointer",
  },
  colorText: {
    flex:         1,
    background:   "#313244",
    border:       "1px solid #45475A",
    borderRadius: 4,
    color:        "#CDD6F4",
    padding:      "2px 6px",
    fontSize:     11,
  },
  textarea: {
    width:        "100%",
    background:   "#313244",
    border:       "1px solid #45475A",
    borderRadius: 4,
    color:        "#CDD6F4",
    padding:      "4px 6px",
    fontSize:     11,
    resize:       "vertical",
    boxSizing:    "border-box",
  },
  select: {
    width:        "100%",
    background:   "#313244",
    border:       "1px solid #45475A",
    borderRadius: 4,
    color:        "#CDD6F4",
    padding:      "2px 4px",
    fontSize:     11,
  },
  readonlyText: {
    color:   "#6C7086",
    fontSize: 11,
  },
  actionBtnSmall: {
    flex:         1,
    padding:      "3px 6px",
    background:   "#313244",
    border:       "1px solid #89B4FA",
    borderRadius: 4,
    color:        "#89B4FA",
    cursor:       "pointer",
    fontSize:     11,
  },
  resetBtnSmall: {
    flex:         1,
    padding:      "3px 6px",
    background:   "transparent",
    border:       "1px solid #F38BA8",
    borderRadius: 4,
    color:        "#F38BA8",
    cursor:       "pointer",
    fontSize:     11,
  },
  // Filter controls
  filterHeader: {
    display:        "flex",
    alignItems:     "center",
    justifyContent: "space-between",
    padding:        "6px 12px 2px",
    fontSize:       10,
    color:          "#585B70",
    textTransform:  "uppercase" as const,
    letterSpacing:  0.5,
  },
  resetFiltersBtn: {
    background:   "transparent",
    border:       "1px solid #45475A",
    borderRadius: 3,
    color:        "#F38BA8",
    cursor:       "pointer",
    fontSize:     9,
    padding:      "1px 5px",
  },
  filterRow: {
    display:    "flex",
    alignItems: "center",
    padding:    "2px 12px",
    gap:        6,
  },
  filterLabel: {
    width:     68,
    fontSize:  10,
    flexShrink: 0,
    color:     "#585B70",
  },
  slider: {
    flex:      1,
    height:    3,
    cursor:    "pointer",
    accentColor: "#89B4FA",
  },
  filterValue: {
    width:     28,
    textAlign: "right",
    fontSize:  10,
    color:     "#6C7086",
    fontVariantNumeric: "tabular-nums",
  },
};
