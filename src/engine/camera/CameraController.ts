// ─── Camera Controller ─────────────────────────────────────────────────────────
//
// Pure functions for zoom and pan. No React, no side effects, no classes —
// just input → output Camera transforms. This makes them trivially testable
// and safe to call from any thread (future: OffscreenCanvas worker).
//
// ── Coordinate Systems ────────────────────────────────────────────────────────
//
//   World space:  coordinates that scene objects live in (unit = 1 artboard pixel)
//   Screen space: CSS pixels on the canvas element (top-left = 0,0)
//
//   World → Screen:  sx = wx * zoom + panX
//                    sy = wy * zoom + panY
//
//   Screen → World:  wx = (sx - panX) / zoom
//                    wy = (sy - panY) / zoom
//
// ── Zoom-toward-cursor Invariant ──────────────────────────────────────────────
//
//   After a zoom event the world point under the cursor must remain at the same
//   screen pixel. Derivation:
//
//     Before: screenX = worldX * oldZoom + oldPanX
//     After:  screenX = worldX * newZoom + newPanX
//     → newPanX = screenX - worldX * newZoom
//
//   Replace worldX with (screenX - oldPanX) / oldZoom → only three values needed:
//     oldCamera, screenX, newZoom
//
// ── WebGL migration note ──────────────────────────────────────────────────────
//
//   In WebGL the camera becomes a 4×4 projection matrix:
//     mat4.ortho(left, right, bottom, top, near, far)
//   The same zoom/pan math applies; only the output format changes.

import type { Camera } from "../../types";

export const MIN_ZOOM = 0.02;   // 2%  — far-out overview
export const MAX_ZOOM = 50;     // 5000% — pixel-level editing

export class CameraController {
  // ── Zoom toward a screen-space point (e.g., mouse cursor) ─────────────────
  // delta > 0 = wheel down = zoom out; delta < 0 = zoom in.
  // Normalizing delta handles the difference between trackpad (tiny deltas)
  // and physical mouse wheels (large discrete steps).
  static zoomToward(
    camera: Camera,
    screenX: number,
    screenY: number,
    delta: number
  ): Camera {
    // Cap the per-event zoom factor to avoid violent jumps on fast scroll.
    const normalized = Math.sign(delta) * Math.min(Math.abs(delta) * 0.001, 0.25);
    const factor = 1 - normalized;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * factor));

    // World point under cursor — this must stay at (screenX, screenY) after zoom.
    const worldX = (screenX - camera.x) / camera.zoom;
    const worldY = (screenY - camera.y) / camera.zoom;

    return {
      zoom: newZoom,
      x: screenX - worldX * newZoom,
      y: screenY - worldY * newZoom,
    };
  }

  // ── Pan by screen-space delta ──────────────────────────────────────────────
  static pan(camera: Camera, dx: number, dy: number): Camera {
    return { ...camera, x: camera.x + dx, y: camera.y + dy };
  }

  // ── Fit the artboard into the viewport with a margin ──────────────────────
  // Used on initial load to center the document. The resulting camera places
  // the artboard rect centered in the viewport at a comfortable zoom level.
  static fitToArtboard(
    artboardW: number,
    artboardH: number,
    viewportW: number,
    viewportH: number,
    margin = 0.88
  ): Camera {
    const zoom = Math.min(viewportW / artboardW, viewportH / artboardH) * margin;
    return {
      zoom,
      x: (viewportW - artboardW * zoom) / 2,
      y: (viewportH - artboardH * zoom) / 2,
    };
  }

  // ── Zoom to a specific level, keeping viewport center fixed ───────────────
  static zoomTo(
    camera: Camera,
    targetZoom: number,
    viewportW: number,
    viewportH: number
  ): Camera {
    const centerX = viewportW / 2;
    const centerY = viewportH / 2;
    return this.zoomToward(
      camera,
      centerX,
      centerY,
      // Compute synthetic delta that produces the target zoom
      -(targetZoom - camera.zoom) / camera.zoom * 1000
    );
  }

  // ── Screen → World ─────────────────────────────────────────────────────────
  static screenToWorld(
    screenX: number,
    screenY: number,
    camera: Camera
  ): { x: number; y: number } {
    return {
      x: (screenX - camera.x) / camera.zoom,
      y: (screenY - camera.y) / camera.zoom,
    };
  }

  // ── World → Screen ─────────────────────────────────────────────────────────
  static worldToScreen(
    worldX: number,
    worldY: number,
    camera: Camera
  ): { x: number; y: number } {
    return {
      x: worldX * camera.zoom + camera.x,
      y: worldY * camera.zoom + camera.y,
    };
  }

  // ── Visible world-space bounds for a viewport of given CSS size ───────────
  static getViewportBounds(
    viewportW: number,
    viewportH: number,
    camera: Camera
  ): { left: number; top: number; right: number; bottom: number } {
    return {
      left:   (-camera.x) / camera.zoom,
      top:    (-camera.y) / camera.zoom,
      right:  (-camera.x + viewportW) / camera.zoom,
      bottom: (-camera.y + viewportH) / camera.zoom,
    };
  }

  // ── Format zoom as a human-readable percentage string ─────────────────────
  static formatZoom(zoom: number): string {
    return `${Math.round(zoom * 100)}%`;
  }
}
