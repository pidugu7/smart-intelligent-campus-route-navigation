import { describe, expect, it } from 'vitest';
import { clampApparentK, edgeFadeFactor } from '../../src/viz/label-scale';

describe('clampApparentK (label/badge apparent-size clamps)', () => {
  it('boosts a too-small label up to the minimum apparent height', () => {
    // base k would render at 8 px; min is 14 px → k must scale by 14/8.
    const k = clampApparentK(1.0, 8, 14, 40);
    expect(k).toBeCloseTo(14 / 8, 9);
  });

  it('shrinks a too-large label down to the maximum apparent height', () => {
    // base k would render at 90 px; max is 40 px → k must scale by 40/90.
    const k = clampApparentK(2.0, 90, 14, 40);
    expect(k).toBeCloseTo((40 / 90) * 2.0, 9);
  });

  it('leaves an in-range label untouched', () => {
    expect(clampApparentK(1.7, 30, 14, 40)).toBe(1.7);
  });

  it('returns k unchanged for a degenerate apparent height (≈0)', () => {
    expect(clampApparentK(1.3, 0, 14, 40)).toBe(1.3);
    expect(clampApparentK(1.3, 1e-9, 14, 40)).toBe(1.3);
  });

  it('clamps exactly onto the bounds (both edges)', () => {
    expect(clampApparentK(1.0, 14, 14, 40)).toBeCloseTo(1.0, 9); // at min
    expect(clampApparentK(1.0, 40, 14, 40)).toBeCloseTo(1.0, 9); // at max
  });
});

describe('edgeFadeFactor (screen-edge label fade)', () => {
  it('is 1 when the label is fully inside the inset', () => {
    expect(edgeFadeFactor(31, 30)).toBe(1);
    expect(edgeFadeFactor(500, 30)).toBe(1);
  });

  it('fades linearly toward the edge', () => {
    expect(edgeFadeFactor(15, 30)).toBeCloseTo(0.5, 9);
    expect(edgeFadeFactor(6, 30)).toBeCloseTo(0.2, 9);
  });

  it('never fades below the floor (default 0.05) at or beyond the edge', () => {
    expect(edgeFadeFactor(0, 30)).toBe(0.05);
    expect(edgeFadeFactor(-20, 30)).toBe(0.05);
  });

  it('honours a custom floor', () => {
    expect(edgeFadeFactor(-1, 30, 0.1)).toBe(0.1);
  });
});
