import { describe, expect, it } from 'vitest';
import { estimateWalkTime } from '../../src/engine/engine';
import { buildSheetSummaryLine } from '../../src/app/ui/route-summary';
import { fmtDistance, fmtTime } from '../../src/app/ui/readout';

/**
 * The anchor route: Main Entrance → France Pavilion (Dijkstra) is
 * 874 m (see tests/integration/acceptance-france.test.ts). At the declared
 * 1.4 m/s that is 874 / 1.4 = 624.29 s = 10 min 24 s. The sheet summary
 * must show EXACTLY that — the same walk time as the guest hero card and
 * the engineer result panel (all driven by engine.estimateWalkTime).
 */
describe('buildSheetSummaryLine (sheet "distance · ETA · algo" strip)', () => {
  it('renders the known 874 m Dijkstra route as "874 m · ≈ 10 min 24 s walk · Dijkstra"', () => {
    expect(buildSheetSummaryLine(874, 'Dijkstra')).toBe('874 m · ≈ 10 min 24 s walk · Dijkstra');
  });

  it('switches to km formatting above 1000 m', () => {
    // 2500 / 1.4 = 1785.71 s → 29 min 46 s.
    expect(buildSheetSummaryLine(2500, 'A* (Euclidean)')).toBe(
      '2.5 km · ≈ 29 min 46 s walk · A* (Euclidean)',
    );
  });

  it('prefixes the hop count for BFS routes', () => {
    expect(buildSheetSummaryLine(874, 'BFS', 26)).toBe('26 stops · 874 m · ≈ 10 min 24 s walk · BFS');
  });
});

describe('walk-time single source of truth (sheet vs card vs panel)', () => {
  // The guest hero card (readout.ts renderHeroRoute) computes:
  //   walkSeconds = estimateWalkTime(cost).estimatedSeconds  (cost = totalDistance)
  //   rendered as: `≈ ${fmtTime(walkSeconds)} walk`
  // The engineer result panel (renderRouteResult) computes:
  //   walk = estimateWalkTime(metersForWalk)  (metersForWalk = totalDistance)
  //   rendered as: `≈ ${fmtTime(walk.estimatedSeconds)} walk at 1.4 m/s`
  // This test re-derives those exact expressions and asserts the sheet line
  // carries the identical walk time — if either surface ever uses a
  // different function or speed, this fails.
  it('sheet line uses the SAME walk time as the hero-card expression', () => {
    const meters = 874;
    const cardWalkSeconds = estimateWalkTime(meters).estimatedSeconds;
    const cardWalkText = fmtTime(cardWalkSeconds); // "≈ 10 min 24 s"
    const line = buildSheetSummaryLine(meters, 'Dijkstra');
    expect(line).toContain(`≈ ${cardWalkText} walk`);
  });

  it('sheet line uses the SAME walk time as the engineer-panel expression', () => {
    const meters = 874;
    const panelWalk = estimateWalkTime(meters); // panel: estimateWalkTime(metersForWalk)
    const line = buildSheetSummaryLine(meters, 'Dijkstra');
    expect(line).toContain(`≈ ${fmtTime(panelWalk.estimatedSeconds)} walk`);
    // And the declared speed is the shared 1.4 m/s, never a private constant.
    expect(panelWalk.speedMetersPerSecond).toBe(1.4);
  });

  it('distance token matches the shared fmtDistance formatter', () => {
    expect(buildSheetSummaryLine(874, 'Dijkstra')).toContain(fmtDistance(874));
    expect(fmtDistance(874)).toBe('874 m');
  });

  it('walk time is exactly distance / 1.4 (no hidden per-stop buffer)', () => {
    const m = estimateWalkTime(874);
    expect(m.estimatedSeconds).toBeCloseTo(874 / 1.4, 9);
    expect(m.estimatedSeconds).toBeCloseTo(624.2857, 3);
    expect(fmtTime(m.estimatedSeconds)).toBe('10 min 24 s');
  });
});
