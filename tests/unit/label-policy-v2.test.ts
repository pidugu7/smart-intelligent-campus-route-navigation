/**
 * Unit tests for the Phase 6 priority-aware label policy (resolveLabels in
 * viz/label-policy.ts).
 *
 * Guarantees:
 *   - deterministic: identical inputs always yield identical decisions;
 *   - priority order: hovered > selected > origin > destination > route
 *     stops > major > medium > detail;
 *   - origin / destination / hovered are NEVER 'hide' (they get shown,
 *     offset, or — last resort for a non-essential — fade);
 *   - 'hide' comes only from the zoom tier gate, never from overlap;
 *   - offsets are vertical, non-zero, and deterministic;
 *   - the dense-promenade stress cluster never loses the essential labels.
 */

import { describe, expect, it } from 'vitest';
import {
  LABEL_FAR_DISTANCE,
  LABEL_MEDIUM_DISTANCE,
  resolveLabels,
  type LabelContext,
  type LabelPlacement,
} from '../../src/viz/label-policy';

const box = (x: number, y: number, w = 100, h = 40) => ({ left: x, top: y, right: x + w, bottom: y + h });

function place(
  id: string,
  tier: LabelPlacement['tier'],
  rect: { left: number; top: number; right: number; bottom: number },
  distance = 500,
): LabelPlacement {
  return { id, tier, essential: false, distance, rect };
}

describe('resolveLabels — no overlaps: everything shows in place', () => {
  it('shows every tier-permitted label without offsets', () => {
    const placements = [
      place('a', 'major', box(0, 0)),
      place('b', 'medium', box(200, 0)),
      place('c', 'detail', box(400, 0)),
    ];
    const d = resolveLabels(placements, 500, {});
    for (const p of placements) {
      expect(d.get(p.id)!.verdict, p.id).toBe('show');
      expect(d.get(p.id)!.offsetY).toBe(0);
    }
  });
});

describe('resolveLabels — zoom tier gate is the only "hide" source', () => {
  it('far zoom hides non-essential medium/detail labels', () => {
    const placements = [
      place('a', 'major', box(0, 0)),
      place('b', 'medium', box(200, 0)),
      place('c', 'detail', box(400, 0)),
    ];
    const d = resolveLabels(placements, LABEL_FAR_DISTANCE + 1, {});
    expect(d.get('a')!.verdict).toBe('show');
    expect(d.get('b')!.verdict).toBe('hide');
    expect(d.get('c')!.verdict).toBe('hide');
  });

  it('medium zoom keeps medium but hides detail', () => {
    const placements = [
      place('a', 'medium', box(0, 0)),
      place('b', 'detail', box(200, 0)),
    ];
    const d = resolveLabels(placements, LABEL_FAR_DISTANCE - 10, {}); // below FAR, above MEDIUM
    expect(d.get('a')!.verdict).toBe('show');
    expect(d.get('b')!.verdict).toBe('hide');
  });

  it('close zoom shows every tier', () => {
    const placements = [
      place('a', 'medium', box(0, 0)),
      place('b', 'detail', box(200, 0)),
    ];
    const d = resolveLabels(placements, LABEL_MEDIUM_DISTANCE, {});
    expect(d.get('a')!.verdict).toBe('show');
    expect(d.get('b')!.verdict).toBe('show');
  });
});

describe('resolveLabels — collision priority order', () => {
  // Five labels stacked at exactly the same spot.
  const stack = (ctx: LabelContext) =>
    resolveLabels(
      [
        place('hovered', 'detail', box(100, 100), 300),
        place('selected', 'detail', box(100, 100), 310),
        place('origin', 'medium', box(100, 100), 320),
        place('destination', 'medium', box(100, 100), 330),
        place('rest', 'major', box(100, 100), 340),
      ],
      500,
      ctx,
    );

  it('hovered wins the stack outright (shown, may overlap others)', () => {
    const d = stack({ hoveredId: 'hovered' });
    expect(d.get('hovered')!.verdict).toBe('show');
    // lower-priority labels cannot take the hovered label's exact spot
    expect(d.get('rest')!.verdict).not.toBe('show');
  });

  it('without hover, selected beats origin', () => {
    const d = stack({ selectedId: 'selected', originId: 'origin' });
    expect(d.get('selected')!.verdict).toBe('show');
  });

  it('origin beats destination, destination beats route stops', () => {
    const ctx: LabelContext = { originId: 'origin', destinationId: 'destination', routeIds: ['rest'] };
    const d = stack(ctx);
    expect(d.get('origin')!.verdict).toBe('show');
    // destination and rest must be displaced (offset or fade), never also 'show' in the same spot
    const shownAtSpot = ['origin', 'destination', 'rest'].filter((id) => d.get(id)!.verdict === 'show');
    expect(shownAtSpot).toHaveLength(1);
    expect(shownAtSpot[0]).toBe('origin');
  });

  it('route stops beat plain major labels', () => {
    const ctx: LabelContext = { routeIds: ['rest'] };
    const d = stack(ctx);
    expect(d.get('rest')!.verdict).toBe('show'); // it is the route stop here
    expect(d.get('rest')!.emphasis).toBe(1);
  });
});

describe('resolveLabels — essentials are never hidden', () => {
  it('origin and destination survive even dense, tier-suppressed contexts', () => {
    const placements = [
      place('origin', 'detail', box(0, 0), 100), // detail tier…
      place('destination', 'detail', box(10, 5), 100),
      ...Array.from({ length: 12 }, (_, i) => place(`m${i}`, 'major', box(0 + (i % 4) * 20, 0 + Math.floor(i / 4) * 10), 200)),
    ];
    const d = resolveLabels(placements, 500, { originId: 'origin', destinationId: 'destination' });
    expect(d.get('origin')!.verdict).not.toBe('hide');
    expect(d.get('destination')!.verdict).not.toBe('hide');
  });

  it('essentials survive the FAR tier gate too', () => {
    const placements = [
      place('origin', 'detail', box(0, 0), 100),
      place('destination', 'detail', box(300, 0), 100),
    ];
    const d = resolveLabels(placements, LABEL_FAR_DISTANCE + 1, { originId: 'origin', destinationId: 'destination' });
    expect(d.get('origin')!.verdict).not.toBe('hide');
    expect(d.get('destination')!.verdict).not.toBe('hide');
  });
});

describe('resolveLabels — offsets are vertical, finite, deterministic', () => {
  it('offset decisions carry a non-zero vertical offset', () => {
    const placements = [
      place('a', 'major', box(0, 0)),
      place('b', 'major', box(0, 0)), // collides with a
      place('c', 'major', box(0, 0)), // collides with a + b
    ];
    const d = resolveLabels(placements, 500, {});
    const offsets = ['a', 'b', 'c'].map((id) => d.get(id)!);
    const offsetOnes = offsets.filter((o) => o.verdict === 'offset');
    expect(offsetOnes.length).toBeGreaterThanOrEqual(1);
    for (const o of offsetOnes) {
      expect(o.offsetY).not.toBe(0);
      expect(Number.isFinite(o.offsetY)).toBe(true);
    }
  });

  it('no overlaps + no tier suppression ⇒ no fade or offset at all', () => {
    const placements = Array.from({ length: 8 }, (_, i) => place(`v${i}`, 'major', box(i * 250, 0)));
    const d = resolveLabels(placements, 500, {});
    for (const p of placements) {
      expect(d.get(p.id)!.verdict).toBe('show');
    }
  });
});

describe('resolveLabels — determinism', () => {
  it('identical inputs produce identical decisions (run 5×)', () => {
    const placements = Array.from({ length: 14 }, (_, i) =>
      place(
        `n${i}`,
        (['major', 'medium', 'detail'] as const)[i % 3]!,
        box(60 + (i % 5) * 34, 40 + Math.floor(i / 5) * 18, 90, 30),
        400 + i * 7,
      ),
    );
    const ctx: LabelContext = { hoveredId: 'n3', originId: 'n0', destinationId: 'n13', routeIds: ['n1', 'n4', 'n7'] };
    const once = resolveLabels(placements, 520, ctx);
    for (let i = 0; i < 5; i += 1) {
      const again = resolveLabels(placements, 520, ctx);
      expect([...again.values()]).toEqual([...once.values()]);
      expect([...again.keys()]).toEqual([...once.keys()]);
    }
  });
});

describe('resolveLabels — dense promenade stress (Showcase Bridge / Fountain / Journey cluster)', () => {
  // Emulates the tight cluster: 9 labels in ~300×120 px, mixed tiers.
  it('keeps the essentials visible and loses only to offsets/fades', () => {
    const placements: LabelPlacement[] = [
      place('bridge', 'major', box(40, 40), 480),
      place('showcase-promenade', 'medium', box(70, 46), 485),
      place('fountain-garden', 'major', box(105, 42), 470),
      place('journey-of-water', 'detail', box(60, 70), 490),
      place('lion-king', 'detail', box(130, 74), 492),
      place('discovery', 'medium', box(20, 90), 500),
      place('nature', 'medium', box(150, 96), 505),
      place('origin', 'medium', box(85, 55), 460),
      place('destination', 'detail', box(115, 60), 462),
    ];
    const ctx: LabelContext = { originId: 'origin', destinationId: 'destination', routeIds: ['fountain-garden', 'journey-of-water'] };
    const d = resolveLabels(placements, 520, ctx);

    // the essentials always have a visible verdict
    for (const id of ['origin', 'destination']) {
      expect(d.get(id)!.verdict, id).not.toBe('hide');
    }
    // nothing is ever 'hide' at this (close) zoom — only show/offset/fade
    for (const p of placements) {
      expect(['show', 'offset', 'fade'].includes(d.get(p.id)!.verdict)).toBe(true);
    }
    // at least some labels are displaced (the cluster cannot all fit)
    const displaced = [...d.values()].filter((v) => v.verdict === 'offset' || v.verdict === 'fade');
    expect(displaced.length).toBeGreaterThan(0);
    // the winner of the origin's spot is the origin (priority)
    const sameSpot = placements
      .filter((p) => Math.abs(p.rect.left - 85) < 5 && Math.abs(p.rect.top - 55) < 5)
      .map((p) => p.id);
    const shownAtOriginSpot = sameSpot.filter((id) => d.get(id)!.verdict === 'show');
    expect(shownAtOriginSpot).toContain('origin');
  });
});
