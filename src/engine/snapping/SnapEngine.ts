// ─── Snap Engine ──────────────────────────────────────────────────────────────
//
// Magnetic alignment snapping — the same interaction model used by Figma,
// Sketch, and Illustrator. When a dragged object comes within a threshold
// of an alignment point on another object, it "snaps" to align precisely.
//
// ── Algorithm ─────────────────────────────────────────────────────────────────
//
//   1. Collect snap candidates from all visible, non-selected objects:
//        left edge, right edge, center X (x-axis)
//        top edge,  bottom edge, center Y (y-axis)
//
//   2. For the dragged rect, compute its own 3 test points per axis:
//        left, center-x, right  (x-axis)
//        top,  center-y, bottom (y-axis)
//
//   3. Find the closest candidate that is within THRESHOLD screen pixels.
//      Using screen-space threshold means snap behavior feels consistent
//      regardless of zoom level.
//        worldThreshold = screenThreshold / zoom
//
//   4. Offset the dragged rect so the test point exactly aligns with the
//      candidate. Return guide lines to render.
//
// ── Guide Lines ───────────────────────────────────────────────────────────────
//
//   Each snap produces a colored guide line in world space spanning the full
//   extent of the aligned objects. Canvas2D renders these as lineTo() calls.
//   WebGL would render them as instanced line geometry (GL_LINES).
//
// ── Grid Snapping ─────────────────────────────────────────────────────────────
//
//   If gridSize > 0, the object's own edges/center snap to the nearest grid
//   line. Grid lines are candidates at multiples of gridSize. Guide lines for
//   grid snaps span the full visible area (-10000 to 10000 world units).
//
// ── Performance Note ──────────────────────────────────────────────────────────
//
//   N objects → 6N candidates, O(N) scan. For scenes > 500 objects, replace
//   the linear scan with spatial hashing (divide world into cells, only check
//   cells near the drag rect). Current implementation is fine up to ~200 objects.

import type { AnySceneObject, GuideLine, Rect, SnapResult } from "../../types";

const SNAP_THRESHOLD_SCREEN = 7; // CSS pixels — feels like Figma's snapping

interface SnapCandidate {
  value: number;
  axis: "x" | "y";
  // World-space extents for the rendered guide line
  guideStart: number;
  guideEnd: number;
}

export class SnapEngine {
  // ── Primary snap: objects + optional grid ─────────────────────────────────
  static snap(
    dragRect: Rect,
    allObjects: AnySceneObject[],
    zoom: number,
    gridSize?: number
  ): SnapResult {
    const threshold = SNAP_THRESHOLD_SCREEN / zoom;

    const candidates = this.collectObjectCandidates(allObjects);

    // Grid candidates
    if (gridSize && gridSize > 0) {
      this.addGridCandidates(candidates, dragRect, threshold, gridSize);
    }

    // Test points on the dragged rect (left, centerX, right / top, centerY, bottom)
    const testX = [dragRect.x, dragRect.x + dragRect.width / 2, dragRect.x + dragRect.width];
    const testY = [dragRect.y, dragRect.y + dragRect.height / 2, dragRect.y + dragRect.height];

    let bestX: SnapCandidate | null = null;
    let bestXDist = Infinity;
    let bestXTest = 0;

    let bestY: SnapCandidate | null = null;
    let bestYDist = Infinity;
    let bestYTest = 0;

    for (const c of candidates) {
      if (c.axis === "x") {
        for (const tp of testX) {
          const d = Math.abs(tp - c.value);
          if (d < threshold && d < bestXDist) {
            bestXDist = d;
            bestX = c;
            bestXTest = tp;
          }
        }
      } else {
        for (const tp of testY) {
          const d = Math.abs(tp - c.value);
          if (d < threshold && d < bestYDist) {
            bestYDist = d;
            bestY = c;
            bestYTest = tp;
          }
        }
      }
    }

    const guides: GuideLine[] = [];
    let snappedX = dragRect.x;
    let snappedY = dragRect.y;

    if (bestX !== null) {
      snappedX += bestX.value - bestXTest;
      guides.push({
        x1: bestX.value, y1: bestX.guideStart,
        x2: bestX.value, y2: bestX.guideEnd,
        color: "#FF6AC1",
      });
    }

    if (bestY !== null) {
      snappedY += bestY.value - bestYTest;
      guides.push({
        x1: bestY.guideStart, y1: bestY.value,
        x2: bestY.guideEnd,  y2: bestY.value,
        color: "#FF6AC1",
      });
    }

    return {
      x: snappedX,
      y: snappedY,
      didSnapX: bestX !== null,
      didSnapY: bestY !== null,
      guides,
    };
  }

  // ── Grid-only snap (used by shape creation tools) ─────────────────────────
  static snapToGrid(value: number, gridSize: number): number {
    return Math.round(value / gridSize) * gridSize;
  }

  // ── Internal: collect edge/center candidates from scene objects ────────────
  private static collectObjectCandidates(objects: AnySceneObject[]): SnapCandidate[] {
    const cs: SnapCandidate[] = [];

    for (const obj of objects) {
      if (!obj.visible || obj.selected) continue;

      const { x, y, width: w, height: h } = obj;
      const r = x + w;
      const b = y + h;
      const cx = x + w / 2;
      const cy = y + h / 2;

      // X candidates with Y-axis guide extents
      cs.push(
        { value: x,  axis: "x", guideStart: y, guideEnd: b },
        { value: r,  axis: "x", guideStart: y, guideEnd: b },
        { value: cx, axis: "x", guideStart: y, guideEnd: b }
      );

      // Y candidates with X-axis guide extents
      cs.push(
        { value: y,  axis: "y", guideStart: x, guideEnd: r },
        { value: b,  axis: "y", guideStart: x, guideEnd: r },
        { value: cy, axis: "y", guideStart: x, guideEnd: r }
      );
    }

    return cs;
  }

  // ── Internal: add grid candidates near the drag rect ─────────────────────
  private static addGridCandidates(
    candidates: SnapCandidate[],
    rect: Rect,
    threshold: number,
    gridSize: number
  ): void {
    const testX = [rect.x, rect.x + rect.width / 2, rect.x + rect.width];
    const testY = [rect.y, rect.y + rect.height / 2, rect.y + rect.height];

    for (const tp of testX) {
      const snapped = Math.round(tp / gridSize) * gridSize;
      if (Math.abs(tp - snapped) <= threshold) {
        candidates.push({ value: snapped, axis: "x", guideStart: -10000, guideEnd: 10000 });
      }
    }

    for (const tp of testY) {
      const snapped = Math.round(tp / gridSize) * gridSize;
      if (Math.abs(tp - snapped) <= threshold) {
        candidates.push({ value: snapped, axis: "y", guideStart: -10000, guideEnd: 10000 });
      }
    }
  }
}
