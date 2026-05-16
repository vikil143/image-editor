// ─── Hit Detection ────────────────────────────────────────────────────────────
// Determines which scene object is under a mouse cursor.
//
// Strategy: inverse-transform the mouse point into each object's LOCAL space,
// then do a simple AABB (axis-aligned bounding box) test at [0,0,w,h].
//
// Why inverse transform instead of testing the transformed bounds?
//   Transformed bounds of a rotated rect form a non-rectangle. Inverse-
//   transforming the cursor turns the complex rotated-rect test into a
//   trivial rectangle test at local [0,0,w,h]. This is the standard GPU
//   picking technique adapted for 2D.
//
// Hit-test order: iterate in REVERSE z-order so the topmost object wins.

import type { AnySceneObject, Point, ResizeHandle } from "../../types";
import { Matrix2D } from "../matrix/Matrix2D";

const HANDLE_SIZE = 8; // px, in screen space
const ROTATE_HANDLE_OFFSET = 28; // px above the top edge

export interface HitResult {
  object: AnySceneObject;
  handle: ResizeHandle | null;
}

export class HitDetector {
  // Returns the topmost object (and handle) under the point, or null.
  hit(
    point: Point,
    objects: AnySceneObject[],
    zoom = 1
  ): HitResult | null {
    // Iterate back-to-front (topmost = last in array)
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (!obj.visible || obj.locked) continue;

      // First check handles if this object is selected
      if (obj.selected) {
        const handle = this.hitHandle(point, obj, zoom);
        if (handle) return { object: obj, handle };
      }

      // Then check the object body
      if (this.hitObject(point, obj)) {
        return { object: obj, handle: null };
      }
    }
    return null;
  }

  // Test if a point is inside an object using inverse transform
  hitObject(point: Point, obj: AnySceneObject): boolean {
    const mat = Matrix2D.forObject(
      obj.x,
      obj.y,
      obj.width,
      obj.height,
      obj.rotation,
      obj.scaleX,
      obj.scaleY
    );

    const inv = mat.invert();
    if (!inv) return false;

    // Transform mouse point into object's local (unrotated) space
    const local = inv.transformPoint(point.x, point.y);

    if (obj.type === "circle") {
      // Ellipse test in local space: check if point is inside the ellipse
      // defined by the object's bounding rect
      const rx = obj.width / 2;
      const ry = obj.height / 2;
      const cx = obj.x + rx;
      const cy = obj.y + ry;
      const lx = local.x - cx;
      const ly = local.y - cy;
      return (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1;
    }

    // Default: AABB in local space
    return (
      local.x >= obj.x &&
      local.x <= obj.x + obj.width &&
      local.y >= obj.y &&
      local.y <= obj.y + obj.height
    );
  }

  // Check if point hits a resize/rotate handle
  hitHandle(
    point: Point,
    obj: AnySceneObject,
    zoom: number
  ): ResizeHandle | null {
    const hs = HANDLE_SIZE / zoom;
    const handles = this.getHandlePositions(obj);

    for (const [name, pos] of Object.entries(handles)) {
      if (
        point.x >= pos.x - hs &&
        point.x <= pos.x + hs &&
        point.y >= pos.y - hs &&
        point.y <= pos.y + hs
      ) {
        return name as ResizeHandle;
      }
    }
    return null;
  }

  // Compute world-space positions of all handles for an object.
  // Handles are placed at the bounding-box corners/edges, then rotated
  // by the object's rotation around its center.
  getHandlePositions(obj: AnySceneObject): Record<ResizeHandle, Point> {
    const cx = obj.x + obj.width / 2;
    const cy = obj.y + obj.height / 2;
    const cos = Math.cos(obj.rotation);
    const sin = Math.sin(obj.rotation);

    const rotate = (px: number, py: number): Point => {
      const dx = px - cx;
      const dy = py - cy;
      return {
        x: cx + dx * cos - dy * sin,
        y: cy + dx * sin + dy * cos,
      };
    };

    const { x, y, width: w, height: h } = obj;
    const mx = x + w / 2;
    const my = y + h / 2;

    // Rotate handle: above the top edge, along the vertical center axis
    const rotateHandleLocal: Point = { x: mx, y: y - ROTATE_HANDLE_OFFSET };

    return {
      nw: rotate(x, y),
      n: rotate(mx, y),
      ne: rotate(x + w, y),
      e: rotate(x + w, my),
      se: rotate(x + w, y + h),
      s: rotate(mx, y + h),
      sw: rotate(x, y + h),
      w: rotate(x, my),
      rotate: rotate(rotateHandleLocal.x, rotateHandleLocal.y),
    };
  }
}
