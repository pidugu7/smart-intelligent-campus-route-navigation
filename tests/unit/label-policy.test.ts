/**
 * Unit tests for the Phase 4.1 label visibility policy (pure — no three.js).
 *
 * Covers:
 *   - zoom tiers: far → major + essential only; medium → + medium; close → all
 *   - essential labels (start / destination / hovered) survive every tier
 *   - greedy screen-space overlap culling: higher priority wins
 *   - visibility-only: nothing is ever removed, only hidden
 */

import { describe, expect, it } from 'vitest';
import {
  LABEL_FAR_DISTANCE,
  LABEL_MEDIUM_DISTANCE,
  visibleLabelIds,
  type LabelPlacement,
} from '../../src/viz/label-policy';

function place(
  id: string,
  tier: LabelPlacement['tier'],
  rect: { left: number; top: number; right: number; bottom: number },
  essential = false,
  distance = 500,
): LabelPlacement {
  return { id, tier, essential, distance, rect };
}

/** A 100×40 screen rect at the given origin, so tests can place labels precisely. */
const box = (x: number, y: number) => ({ left: x, top: y, right: x + 100, bottom: y + 40 });

describe('visibleLabelIds — zoom tiers', () => {
  const placements = [
    place('major-1', 'major', box(0, 0)),
    place('medium-1', 'medium', box(200, 0)),
    place('detail-1', 'detail', box(400, 0)),
  ];

  it('far zoom: only major labels (no essentials present)', () => {
    const visible = visibleLabelIds(placements, LABEL_FAR_DISTANCE + 100);
    expect(visible.has('major-1')).toBe(true);
    expect(visible.has('medium-1')).toBe(false);
    expect(visible.has('detail-1')).toBe(false);
  });

  it('medium zoom: major + medium labels', () => {
    const visible = visibleLabelIds(placements, (LABEL_MEDIUM_DISTANCE + LABEL_FAR_DISTANCE) / 2);
    expect(visible.has('major-1')).toBe(true);
    expect(visible.has('medium-1')).toBe(true);
    expect(visible.has('detail-1')).toBe(false);
  });

  it('close zoom: everything', () => {
    const visible = visibleLabelIds(placements, 100);
    expect(visible).toEqual(new Set(['major-1', 'medium-1', 'detail-1']));
  });

  it('boundaries: exactly FAR shows medium; exactly MEDIUM shows detail', () => {
    expect(visibleLabelIds(placements, LABEL_FAR_DISTANCE).has('medium-1')).toBe(true);
    expect(visibleLabelIds(placements, LABEL_MEDIUM_DISTANCE).has('detail-1')).toBe(true);
  });
});

describe('visibleLabelIds — essential protection', () => {
  it('an essential detail label is visible even at far zoom', () => {
    const placements = [place('start', 'detail', box(0, 0), true)];
    expect(visibleLabelIds(placements, LABEL_FAR_DISTANCE + 500).has('start')).toBe(true);
  });

  it('essential labels win collisions against non-essentials at the same rect', () => {
    const placements = [
      place('hovered', 'detail', box(0, 0), true),
      place('ordinary', 'major', box(0, 0)),
    ];
    const visible = visibleLabelIds(placements, LABEL_FAR_DISTANCE + 100);
    expect(visible.has('hovered')).toBe(true);
    expect(visible.has('ordinary')).toBe(false);
  });
});

describe('visibleLabelIds — overlap culling', () => {
  it('non-overlapping labels all survive even when their tier is hidden by collisions elsewhere', () => {
    const placements = [
      place('a', 'medium', box(0, 0)),
      place('b', 'medium', box(300, 300)),
    ];
    const visible = visibleLabelIds(placements, 100);
    expect(visible).toEqual(new Set(['a', 'b']));
  });

  it('two colliding same-tier labels: the nearer one wins', () => {
    const placements = [
      place('far-vertex', 'medium', box(0, 0), false, 900),
      place('near-vertex', 'medium', box(10, 10), false, 120),
    ];
    const visible = visibleLabelIds(placements, 100);
    expect(visible.has('near-vertex')).toBe(true);
    expect(visible.has('far-vertex')).toBe(false);
  });

  it('major beats medium in a collision, medium beats detail', () => {
    const placements = [
      place('detail', 'detail', box(0, 0)),
      place('medium', 'medium', box(5, 5)),
      place('major', 'major', box(9, 9)),
    ];
    const visible = visibleLabelIds(placements, 100);
    expect(visible.has('major')).toBe(true);
    expect(visible.has('medium')).toBe(false);
    expect(visible.has('detail')).toBe(false);
  });

  it('rects within the 2px padding are treated as overlapping', () => {
    const placements = [
      place('a', 'medium', box(0, 0)),
      place('b', 'medium', box(101, 0), false, 999), // 1px gap → inside padding
    ];
    const visible = visibleLabelIds(placements, 100);
    expect(visible).toEqual(new Set(['a']));
  });

  it('rects just outside the padding do not collide', () => {
    const placements = [
      place('a', 'medium', box(0, 0)),
      place('b', 'medium', box(105, 0)), // 5px gap → outside padding
    ];
    const visible = visibleLabelIds(placements, 100);
    expect(visible).toEqual(new Set(['a', 'b']));
  });
});

describe('visibleLabelIds — invariants', () => {
  it('returns at most the input ids (visibility only, no invented labels)', () => {
    const placements = [place('x', 'major', box(0, 0)), place('y', 'detail', box(500, 500))];
    const visible = visibleLabelIds(placements, 50);
    for (const id of visible) expect(['x', 'y']).toContain(id);
  });

  it('an empty placement list yields an empty result', () => {
    expect(visibleLabelIds([], 100).size).toBe(0);
  });
});
