// ─── Export Manager ───────────────────────────────────────────────────────────
//
// Handles exporting the editor scene to image files.
//
// ── Two export modes ──────────────────────────────────────────────────────────
//
//   exportCanvas(): snapshot the existing canvas element (DPR-aware, fast).
//     Use when: quick PNG/JPEG of whatever is currently on screen.
//
//   exportHighRes(): re-render the scene at a custom scale to an offscreen
//     canvas, then download. Camera is reset to cover the full artboard.
//     Use when: 2×/4× output for print or high-DPI displays.
//
// ── WebGL migration note ──────────────────────────────────────────────────────
//
//   exportHighRes() in WebGL maps to:
//     1. Create framebuffer at (artboardW × scale, artboardH × scale)
//     2. Render scene to FBO
//     3. gl.readPixels() → Uint8Array
//     4. Draw to 2D canvas for toBlob() (or use OffscreenCanvas directly)

import type { SceneGraph } from "../scene/SceneGraph";
import type { Camera, EditorConfig, RenderConfig } from "../../types";
import { Renderer } from "../renderer/Renderer";

export type ExportFormat = "png" | "jpeg";

export interface ExportOptions {
  format: ExportFormat;
  quality?: number;   // 0-1, JPEG only
  scale?: number;     // multiplier over artboard size
  filename?: string;
}

export class ExportManager {
  // ── Quick snapshot of the live canvas ────────────────────────────────────
  static exportCanvas(
    canvas: HTMLCanvasElement,
    options: ExportOptions = { format: "png" }
  ): void {
    const { format, quality = 0.92, filename } = options;
    const mime = format === "jpeg" ? "image/jpeg" : "image/png";
    const name = filename ?? `export-${Date.now()}.${format}`;

    canvas.toBlob(
      (blob) => { if (blob) ExportManager.downloadBlob(blob, name); },
      mime,
      format === "jpeg" ? quality : undefined
    );
  }

  // ── High-resolution re-render of the full artboard ────────────────────────
  //
  // Creates a fresh Renderer on an offscreen canvas, sets the camera so the
  // artboard exactly fills the output (zoom = scale, pan = 0), renders once,
  // and downloads the blob.
  //
  // The offscreen canvas has no DPR scaling — it represents actual pixels.
  static exportHighRes(
    sceneGraph: SceneGraph,
    config: EditorConfig,
    options: ExportOptions = { format: "png", scale: 2 }
  ): void {
    const { format = "png", quality = 0.92, scale = 2, filename } = options;

    const aw = config.canvasWidth;
    const ah = config.canvasHeight;

    const offscreen = document.createElement("canvas");
    offscreen.width  = aw * scale;
    offscreen.height = ah * scale;
    offscreen.style.width  = `${aw * scale}px`;
    offscreen.style.height = `${ah * scale}px`;

    const renderer = new Renderer(offscreen);

    // Camera: zoom = scale puts the artboard at exactly (0,0,aw*scale,ah*scale)
    const camera: Camera = { x: 0, y: 0, zoom: scale };

    const renderConfig: RenderConfig = {
      artboardWidth:      aw,
      artboardHeight:     ah,
      artboardBackground: config.backgroundColor,
      showGrid:           false, // no grid in exports
      gridSize:           config.gridSize,
    };

    renderer.render(sceneGraph, camera, renderConfig);

    const mime = format === "jpeg" ? "image/jpeg" : "image/png";
    const name = filename ?? `export-${Date.now()}.${format}`;

    offscreen.toBlob(
      (blob) => { if (blob) ExportManager.downloadBlob(blob, name); },
      mime,
      format === "jpeg" ? quality : undefined
    );
  }

  // ── Export only the selected objects ──────────────────────────────────────
  // Crops the output to the tight bounding box of selected objects.
  static exportSelection(
    sceneGraph: SceneGraph,
    config: EditorConfig,
    options: ExportOptions = { format: "png" }
  ): void {
    const selected = sceneGraph.getSelected();
    if (selected.length === 0) return;

    const { format = "png", quality = 0.92, filename } = options;

    // Compute tight bounding box of selected objects
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const obj of selected) {
      minX = Math.min(minX, obj.x);
      minY = Math.min(minY, obj.y);
      maxX = Math.max(maxX, obj.x + obj.width);
      maxY = Math.max(maxY, obj.y + obj.height);
    }

    const selW = maxX - minX;
    const selH = maxY - minY;

    const offscreen = document.createElement("canvas");
    offscreen.width  = selW;
    offscreen.height = selH;
    offscreen.style.width  = `${selW}px`;
    offscreen.style.height = `${selH}px`;

    const renderer = new Renderer(offscreen);

    // Offset camera so the selection appears at (0,0)
    const camera: Camera = { x: -minX, y: -minY, zoom: 1 };

    const renderConfig: RenderConfig = {
      artboardWidth:      config.canvasWidth,
      artboardHeight:     config.canvasHeight,
      artboardBackground: config.backgroundColor,
      showGrid:           false,
      gridSize:           config.gridSize,
    };

    renderer.render(sceneGraph, camera, renderConfig);

    const mime = format === "jpeg" ? "image/jpeg" : "image/png";
    const name = filename ?? `selection-${Date.now()}.${format}`;

    offscreen.toBlob(
      (blob) => { if (blob) ExportManager.downloadBlob(blob, name); },
      mime,
      format === "jpeg" ? quality : undefined
    );
  }

  private static downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href     = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
