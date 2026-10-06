/**
 * Integration test — Phase 4 visualization layout (pure layer, no WebGL).
 *
 * The layout module is the single source of the data → geometry decisions,
 * so this test pins its structural properties against the real EPCOT
 * dataset: every vertex gets a position, every edge resolves both ends,
 * bounds cover the park, and the promenade ring is detected (which is what
 * makes the lagoon appear in the 3D scene).
 */

import { describe, expect, it } from 'vitest';
import epcot from '../../src/data/datasets/epcot/dataset.json';
import { loadDataset } from '../../src/data/loader';
import { buildCampusLayout } from '../../src/viz/layout';

const loaded = loadDataset(epcot);
const layout = buildCampusLayout(loaded.dataset);

describe('EPCOT visualization layout', () => {
  it('places every dataset vertex with a finite position', () => {
    expect(layout.vertices).toHaveLength(loaded.report.vertexCount);
    for (const v of layout.vertices) {
      expect(Number.isFinite(v.x)).toBe(true);
      expect(Number.isFinite(v.y)).toBe(true);
      expect(layout.vertexById.get(v.id)).toBeDefined();
    }
  });

  it('resolves every edge to existing endpoints with finite geometry', () => {
    expect(layout.edges).toHaveLength(loaded.report.edgeCount);
    for (const e of layout.edges) {
      expect(layout.vertexById.get(e.fromId), e.id).toBeDefined();
      expect(layout.vertexById.get(e.toId), e.id).toBeDefined();
      const len = Math.hypot(e.toX - e.fromX, e.toY - e.fromY);
      expect(len, e.id).toBeGreaterThan(0);
    }
    const bridges = layout.edges.filter((e) => e.isBridge);
    expect(bridges).toHaveLength(1);
    expect(bridges[0]!.id).toBe('e-bridge-showcase');
  });

  it('bounds contain all vertices', () => {
    const { minX, maxX, minY, maxY } = layout.bounds;
    for (const v of layout.vertices) {
      expect(v.x).toBeGreaterThanOrEqual(minX);
      expect(v.x).toBeLessThanOrEqual(maxX);
      expect(v.y).toBeGreaterThanOrEqual(minY);
      expect(v.y).toBeLessThanOrEqual(maxY);
    }
    // The park is taller than it is wide (teardrop + lagoon).
    expect(maxY - minY).toBeGreaterThan(maxX - minX);
  });

  it('detects the promenade ring and derives the lagoon radius from it', () => {
    expect(layout.ringRadius).toBeGreaterThan(280);
    expect(layout.ringRadius).toBeLessThan(340);
    expect(layout.lagoonRadius).toBeCloseTo(layout.ringRadius * 0.94, 6);
    // The center target sits inside the park.
    expect(layout.center.y).toBeLessThan(0);
  });

  it('labels all major locations prominently', () => {
    const majors = layout.vertices.filter((v) => v.major);
    for (const id of ['pav-mexico', 'pav-germany', 'pav-morocco', 'pav-canada', 'gate-main', 'gate-gateway', 'bridge-showcase', 'land-spaceship']) {
      expect(majors.some((v) => v.id === id), id).toBe(true);
    }
    // Pavilion-internal rooms stay minor (no label clutter).
    for (const id of ['land-pyramid', 'attr-granfiesta', 'attr-frozen']) {
      expect(layout.vertexById.get(id)!.major, id).toBe(false);
    }
  });

  it('width classes are consistent: promenade ring + bridge wide, indoor narrow, rest regular', () => {
    for (const e of layout.edges) {
      if (e.kind === 'bridge') expect(e.widthClass, e.id).toBe(1);
      else if (e.kind === 'indoor') expect(e.widthClass, e.id).toBe(-1);
    }
    // Every promenade ring segment is wide…
    const ringEdges = layout.edges.filter((e) => e.id.startsWith('e-ring-'));
    expect(ringEdges).toHaveLength(13);
    for (const e of ringEdges) expect(e.widthClass, e.id).toBe(1);
    // …and wide edges are exactly the 13 ring segments + the bridge.
    expect(layout.edges.filter((e) => e.widthClass === 1)).toHaveLength(14);
    // The remaining edges are regular (0) or indoor (-1).
    for (const e of layout.edges) {
      if (e.widthClass !== 1) expect([-1, 0]).toContain(e.widthClass);
    }
  });
});
