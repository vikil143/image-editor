// ─── Filter Engine ────────────────────────────────────────────────────────────
//
// Non-destructive image filter pipeline built on CSS filter strings.
//
// ── How it works ──────────────────────────────────────────────────────────────
//
//   Filters are stored on ImageObject.filters as a plain FilterState object.
//   The source image is NEVER modified — filters are applied at draw time by
//   setting ctx.filter before each ctx.drawImage() call, then restoring.
//
//   ctx.filter = "brightness(120%) contrast(80%) blur(2px)"
//   ctx.drawImage(imageEl, ...)
//   ctx.filter = "none"
//
// ── Performance ───────────────────────────────────────────────────────────────
//
//   CSS filters run on the GPU in Chromium and Safari (via the compositor).
//   Firefox runs them on the CPU for canvas — acceptable for our use case.
//   There are no ImageData allocations; the filter string is rebuilt each
//   frame from the stored values (a handful of number-to-string conversions).
//
//   If CPU cost becomes measurable, cache the filter string on the object
//   and invalidate it whenever filters change — O(1) cache lookup per frame.
//
// ── WebGL migration path ──────────────────────────────────────────────────────
//
//   Each filter maps to a GLSL shader uniform or a framebuffer post-process:
//
//     brightness  → multiply RGB:  color.rgb *= u_brightness / 100.0
//     contrast    → linear remap:  color.rgb = (color.rgb - 0.5) * u_contrast + 0.5
//     saturation  → YUV rotation:  mix(luminance, color, u_saturation / 100.0)
//     grayscale   → luma weight:   mix(color, vec3(dot(color.rgb, LUMA)), u_grayscale)
//     blur        → two-pass separable Gaussian, radius = u_blur pixels
//     hueRotate   → YUV hue rotation matrix (3×3 mat mul in shader)
//     invert      → vec3(1.0) - color.rgb * (u_invert / 100.0)
//     sepia       → premultiplied sepia matrix
//
//   The stored FilterState values are identical whether driving CSS or GLSL.

import type { FilterState } from "../../types";

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

export class FilterEngine {
  // Build a CSS filter string. Returns 'none' when all values are neutral —
  // this lets the renderer skip the ctx.filter assignment entirely.
  static buildFilterString(f: FilterState): string {
    const parts: string[] = [];

    if (f.brightness  !== 100) parts.push(`brightness(${f.brightness}%)`);
    if (f.contrast    !== 100) parts.push(`contrast(${f.contrast}%)`);
    if (f.saturation  !== 100) parts.push(`saturate(${f.saturation}%)`);
    if (f.grayscale   !== 0)   parts.push(`grayscale(${f.grayscale}%)`);
    if (f.blur        !== 0)   parts.push(`blur(${f.blur}px)`);
    if (f.hueRotate   !== 0)   parts.push(`hue-rotate(${f.hueRotate}deg)`);
    if (f.invert      !== 0)   parts.push(`invert(${f.invert}%)`);
    if (f.sepia       !== 0)   parts.push(`sepia(${f.sepia}%)`);

    return parts.length > 0 ? parts.join(" ") : "none";
  }

  // True when filters produce no visual change (all neutral values)
  static isNeutral(f: FilterState): boolean {
    return (
      f.brightness === 100 &&
      f.contrast   === 100 &&
      f.saturation === 100 &&
      f.grayscale  === 0   &&
      f.blur       === 0   &&
      f.hueRotate  === 0   &&
      f.invert     === 0   &&
      f.sepia      === 0
    );
  }

  static getDefaults(): FilterState {
    return { ...NEUTRAL_FILTERS };
  }

  static merge(base: FilterState, patch: Partial<FilterState>): FilterState {
    return { ...base, ...patch };
  }

  // Clamp all values to their valid ranges
  static clamp(f: FilterState): FilterState {
    return {
      brightness: clamp(f.brightness, 0, 300),
      contrast:   clamp(f.contrast,   0, 300),
      saturation: clamp(f.saturation, 0, 300),
      grayscale:  clamp(f.grayscale,  0, 100),
      blur:       clamp(f.blur,       0, 40),
      hueRotate:  clamp(f.hueRotate,  0, 360),
      invert:     clamp(f.invert,     0, 100),
      sepia:      clamp(f.sepia,      0, 100),
    };
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
