/**
 * viz/label-scale.ts
 *
 * Pure apparent-size / screen-edge helpers for label + badge scaling.
 * No three.js, no DOM — the app's per-frame label pass calls these so the
 * clamping and edge-fade rules stay unit-testable without WebGL.
 */

/**
 * Clamp a distance-based scale factor `k` so the object's APPARENT pixel
 * height `hPx` (at the scale `k` produced) stays within [hMinPx, hMaxPx].
 *
 * The clamp is proportional: scaling k by (target / current) makes the
 * apparent height land exactly on the bound. With a degenerate `hPx`
 * (≈0, e.g. zero base height or infinite depth) k is returned unchanged.
 */
export function clampApparentK(k: number, hPx: number, hMinPx: number, hMaxPx: number): number {
  if (!(hPx > 1e-6)) return k;
  const lo = (hMinPx / hPx) * k;
  const hi = (hMaxPx / hPx) * k;
  return Math.min(Math.max(k, lo), hi);
}

/**
 * Screen-edge fade factor for a label whose rect inset (distance from the
 * NEAREST viewport edge, in px) is `rectInsetPx`:
 *  - fully inside (inset > insetPx) → 1
 *  - near the edge → linear 0..1, floored at `floor` (labels dim out at
 *    the edge instead of being cut off mid-word).
 */
export function edgeFadeFactor(rectInsetPx: number, insetPx: number, floor = 0.05): number {
  if (insetPx <= 0) return 1;
  if (rectInsetPx > insetPx) return 1;
  return Math.max(floor, rectInsetPx / insetPx);
}
