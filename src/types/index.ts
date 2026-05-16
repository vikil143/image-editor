// ─── Core Coordinate Types ────────────────────────────────────────────────────
// Right-handed 2D system: +X right, +Y down (canvas default).
// World space  = scene coordinates (what objects live in).
// Screen space = CSS pixels on the canvas element.
//
// World → Screen:  sx = wx * zoom + panX
// Screen → World:  wx = (sx - panX) / zoom

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

// ─── Object Types ─────────────────────────────────────────────────────────────

export type SceneObjectType =
  | "rect"
  | "circle"
  | "line"
  | "text"
  | "image"
  | "path";

// The canonical scene object. Every renderable entity extends this.
// Flat structure — trivial to serialize, diff for undo, and sync over a network
// (future CRDT/collaborative editing). No nested transform trees.
export interface SceneObject {
  id: string;
  type: SceneObjectType;
  name?: string; // Optional display name shown in layers panel

  // World-space position of the object's top-left anchor
  x: number;
  y: number;
  width: number;
  height: number;

  // Rotation in radians, around the object's center
  rotation: number;

  scaleX: number;
  scaleY: number;
  opacity: number; // 0–1

  visible: boolean;
  locked: boolean;

  // Selection state — NOT persisted (runtime only)
  selected: boolean;

  // Z-order — set by scene graph, consumers treat as read-only
  zIndex?: number;
}

// ─── Filter State ─────────────────────────────────────────────────────────────
// Non-destructive per-image filters. Values map 1:1 to CSS filter functions so
// they can drive ctx.filter (Canvas2D) and future WebGL shader uniforms.
//
// Neutral values (no visual change):
//   brightness 100, contrast 100, saturation 100
//   grayscale 0, blur 0, hueRotate 0, invert 0, sepia 0
//
// WebGL migration note:
//   Each filter → a shader uniform or a post-processing pass.
//   brightness  → multiply RGB channels
//   contrast    → linear remap or S-curve
//   saturation  → rotation in YUV / HSL color space
//   grayscale   → dot product with luminance weights (0.299, 0.587, 0.114)
//   blur        → two-pass separable Gaussian kernel
//   hueRotate   → rotation matrix in YUV space
export interface FilterState {
  brightness: number;  // 0–300  (100 = no change)
  contrast: number;    // 0–300  (100 = no change)
  saturation: number;  // 0–300  (100 = no change)
  grayscale: number;   // 0–100  (0   = full color)
  blur: number;        // 0–40 pixels (0 = sharp)
  hueRotate: number;   // 0–360 degrees (0 = no rotation)
  invert: number;      // 0–100  (0   = normal)
  sepia: number;       // 0–100  (0   = no sepia)
}

export const NEUTRAL_FILTERS: FilterState = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  grayscale: 0,
  blur: 0,
  hueRotate: 0,
  invert: 0,
  sepia: 0,
};

// ─── Concrete Object Types ────────────────────────────────────────────────────

export interface RectObject extends SceneObject {
  type: "rect";
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  cornerRadius: number;
}

export interface CircleObject extends SceneObject {
  type: "circle";
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
}

export interface LineObject extends SceneObject {
  type: "line";
  x2: number;
  y2: number;
  strokeColor: string;
  strokeWidth: number;
  arrowHead: boolean;
}

export interface TextObject extends SceneObject {
  type: "text";
  content: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  textColor: string;
  textAlign: CanvasTextAlign;
  lineHeight: number;
}

// ─── ImageObject ──────────────────────────────────────────────────────────────
// Non-destructive crop stored as source-pixel coordinates (sx,sy,sw,sh).
// flipX/flipY applied inside the draw call — do NOT affect the bounding box.
// filters is optional: absent/undefined = no filters applied.
export interface ImageObject extends SceneObject {
  type: "image";
  src: string;
  // Cached element — stripped on serialization, reconstructed on load
  imageElement?: HTMLImageElement;

  // Non-destructive crop in source-image pixel coordinates
  cropSx: number;
  cropSy: number;
  cropSWidth: number;  // 0 = use naturalWidth (no crop)
  cropSHeight: number; // 0 = use naturalHeight (no crop)

  flipX: boolean;
  flipY: boolean;

  // Non-destructive filters — omit or set to NEUTRAL_FILTERS for no effect
  filters?: FilterState;
}

// ─── PathObject ───────────────────────────────────────────────────────────────
// Freehand brush strokes and annotation paths.
// Points are stored in world space (absolute). x/y/width/height = bounding box
// for hit detection. On move, all points shift by the same delta.
export interface PathObject extends SceneObject {
  type: "path";
  points: Point[];
  strokeColor: string;
  strokeWidth: number;
  smoothing: boolean; // Catmull-Rom midpoint Bézier smoothing
}

export type AnySceneObject =
  | RectObject
  | CircleObject
  | LineObject
  | TextObject
  | ImageObject
  | PathObject;

// ─── Selection ────────────────────────────────────────────────────────────────

// Compass directions + rotate handle for the 8+1 transform handles
export type ResizeHandle =
  | "nw" | "n" | "ne"
  | "e"
  | "se" | "s" | "sw"
  | "w"
  | "rotate";

export interface SelectionState {
  selectedIds: Set<string>;
  activeHandle: ResizeHandle | null;
  dragStartObjects: Map<string, AnySceneObject>;
  dragStartPoint: Point | null;
  handleDragStart: Point | null;
}

// ─── Marquee Selection ────────────────────────────────────────────────────────
// Rubber-band drag-selection box. Coordinates are in world space so zoom/pan
// don't affect which objects are selected.
// width/height can be negative (drag from bottom-right to top-left) —
// normalize before testing intersection.
export interface MarqueeState {
  active: boolean;
  x: number;      // world space start
  y: number;
  width: number;  // can be negative
  height: number;
}

// ─── Snap System ─────────────────────────────────────────────────────────────
// Guide lines are world-space line segments rendered on top of all objects.
// In a WebGL renderer these would be rendered as instanced line geometry.
export interface GuideLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

export interface SnapResult {
  x: number;          // adjusted world X (may equal input if no snap)
  y: number;          // adjusted world Y
  didSnapX: boolean;
  didSnapY: boolean;
  guides: GuideLine[];
}

// ─── Tool Types ───────────────────────────────────────────────────────────────

export type ToolType =
  | "select"
  | "rect"
  | "circle"
  | "line"
  | "arrow"
  | "text"
  | "brush"
  | "polygon"
  | "crop";

// ─── Crop State ───────────────────────────────────────────────────────────────
// Lives in the Zustand store. CropTool writes; Renderer and React UI read.

export interface CropState {
  isActive: boolean;
  targetId: string | null;
  rect: Rect; // world-space crop box
  phase: "drawing" | "confirming" | "idle";
}

// ─── History / Command Pattern ────────────────────────────────────────────────

export interface Command {
  execute(): void;
  undo(): void;
  description: string;
}

// ─── Camera / Viewport ────────────────────────────────────────────────────────
// Camera lives entirely in screen space.
// Objects live in world space — camera transforms between the two.
//
// Rendering: ctx.translate(camera.x, camera.y); ctx.scale(camera.zoom, camera.zoom)
// After that, draw objects at their world coordinates directly.

export interface Camera {
  x: number;      // pan offset X in CSS pixels
  y: number;      // pan offset Y in CSS pixels
  zoom: number;   // scale factor (1.0 = 100%, 2.0 = 200%)
}

// ─── Render Config ────────────────────────────────────────────────────────────
// Passed to Renderer.render() each frame. Decouples renderer from Zustand.

export interface RenderConfig {
  artboardWidth: number;
  artboardHeight: number;
  artboardBackground: string;
  showGrid: boolean;
  gridSize: number;
}

// ─── Editor Config ────────────────────────────────────────────────────────────

export interface EditorConfig {
  // Artboard (document) dimensions in world units
  canvasWidth: number;
  canvasHeight: number;
  backgroundColor: string;   // artboard background color

  showGrid: boolean;
  snapToGrid: boolean;
  snapToObjects: boolean;    // NEW: magnetic object-edge snapping
  gridSize: number;
}
