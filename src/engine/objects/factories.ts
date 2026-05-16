// ─── Object Factories ─────────────────────────────────────────────────────────
// Each factory returns a fully-initialized scene object with safe defaults.
// Using factory functions (not classes) keeps objects as plain data —
// easier to serialize, clone, and diff for the undo stack.

import { v4 as uuidv4 } from "uuid";
import type {
  RectObject,
  CircleObject,
  LineObject,
  TextObject,
  ImageObject,
  PathObject,
  Point,
} from "../../types";

const baseDefaults = {
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
  visible: true,
  locked: false,
  selected: false,
};

export function createRect(
  x: number,
  y: number,
  width = 100,
  height = 80
): RectObject {
  return {
    ...baseDefaults,
    id: uuidv4(),
    type: "rect",
    x,
    y,
    width,
    height,
    fillColor: "#4A90D9",
    strokeColor: "#2A70B9",
    strokeWidth: 0,
    cornerRadius: 0,
  };
}

export function createCircle(
  x: number,
  y: number,
  width = 100,
  height = 100
): CircleObject {
  return {
    ...baseDefaults,
    id: uuidv4(),
    type: "circle",
    x,
    y,
    width,
    height,
    fillColor: "#E8845C",
    strokeColor: "#C8643C",
    strokeWidth: 0,
  };
}

export function createLine(
  x: number,
  y: number,
  x2: number,
  y2: number
): LineObject {
  return {
    ...baseDefaults,
    id: uuidv4(),
    type: "line",
    x,
    y,
    width: Math.abs(x2 - x),
    height: Math.abs(y2 - y),
    x2,
    y2,
    strokeColor: "#333333",
    strokeWidth: 2,
    arrowHead: false,
  };
}

export function createText(x: number, y: number, content = "Text"): TextObject {
  return {
    ...baseDefaults,
    id: uuidv4(),
    type: "text",
    x,
    y,
    width: 200,
    height: 40,
    content,
    fontSize: 24,
    fontFamily: "Inter, system-ui, sans-serif",
    fontWeight: "400",
    fontStyle: "normal",
    textColor: "#1A1A2E",
    textAlign: "left",
    lineHeight: 1.4,
  };
}

// ─── ImageObject factory ──────────────────────────────────────────────────────
// cropSx/cropSy/cropSWidth/cropSHeight default to 0, meaning "no crop — show
// the full image". The renderer checks `cropSWidth === 0` as the "no crop" sentinel.
export function createImage(
  x: number,
  y: number,
  src: string,
  width = 300,
  height = 200
): ImageObject {
  return {
    ...baseDefaults,
    id: uuidv4(),
    type: "image",
    x,
    y,
    width,
    height,
    src,
    // No crop initially
    cropSx: 0,
    cropSy: 0,
    cropSWidth: 0,
    cropSHeight: 0,
    flipX: false,
    flipY: false,
  };
}

// ─── PathObject factory ───────────────────────────────────────────────────────
// Points are world-space absolute coordinates. Bounding box (x/y/width/height)
// is computed from the points and stored for hit detection.
export function createPath(
  points: Point[],
  strokeColor = "#1A1A2E",
  strokeWidth = 2
): PathObject {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = xs.length ? Math.min(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;

  return {
    ...baseDefaults,
    id: uuidv4(),
    type: "path",
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
    points,
    strokeColor,
    strokeWidth,
    smoothing: true,
  };
}
