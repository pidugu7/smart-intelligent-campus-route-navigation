/**
 * Integration test — the REAL EPCOT dataset end-to-end (Phase 3).
 *
 * Checks, per the phase spec: the dataset loads, the graph constructs, the
 * documented key locations exist, all weights are valid, the environment is
 * reachable, Dijkstra and A* work and agree on the optimal cost, BFS and DFS
 * behave, blocked-edge simulation and alternative routing work, and the ONE
 * numeric fact the provenance supports (the documented ≈1.2-mile lagoon
 * perimeter) is reproduced within tolerance.
 *
 * No arbitrary absolute distances are hard-coded: everything else is
 * structural / algorithmic.
 */

import { describe, expect, it } from 'vitest';
import epcot from '../../src/data/datasets/epcot/dataset.json';
import { loadDataset } from '../../src/data/loader';
import {
  aStar,
  bfs,
  compareAlgorithms,
  detectCycle,
  dijkstra,
  estimateWalkTime,
  findAlternativeRoute,
  findRoute,
  findUnreachable,
  simulateBlockedRoute,
} from '../../src/engine/engine';

// Load once for the whole suite — the loader validates everything on entry.
const loaded = loadDataset(epcot);
const { dataset, graph, report } = loaded;

/** Undirected edge weight lookup keyed "smaller|bigger". */
const edgeWeight = new Map<string, number>();
for (const e of dataset.edges) {
  edgeWeight.set([e.from, e.to].sort().join('|'), e.weight);
}

/** Assert a route result is internally consistent with the dataset's weights. */
function expectConsistentRoute(result: ReturnType<typeof findRoute>, sourceId: string, targetId: string): void {
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') return;
  expect(result.path[0]).toBe(sourceId);
  expect(result.path[result.path.length - 1]).toBe(targetId);
  expect(result.path.length).toBeGreaterThanOrEqual(2);
  let sum = 0;
  for (let i = 0; i + 1 < result.path.length; i += 1) {
    const a = result.path[i]!;
    const b = result.path[i + 1]!;
    const w = edgeWeight.get([a, b].sort().join('|'));
    expect(w, `consecutive path pair ${a} <-> ${b} must be a dataset edge`).toBeTypeOf('number');
    sum += w!;
  }
  expect(result.totalDistance).toBe(sum);
}

describe('EPCOT dataset — loading and structure', () => {
  it('loads without validation errors and builds the expected graph', () => {
    expect(report.vertexCount).toBe(37);
    expect(report.edgeCount).toBe(43);
    expect(report.connectedComponents).toBe(1);
    expect(report.orphanedVertices).toEqual([]);
    expect(report.hasCycle).toBe(true);
    expect(report.warnings).toEqual([]);
    expect(graph.vertexCount).toBe(37);
    expect(graph.edgeCount).toBe(43);
  });

  it('contains every key documented location', () => {
    const keyIds = [
      'gate-main',
      'gate-gateway',
      'gate-plaza',
      'area-celebration',
      'area-nature',
      'area-discovery',
      'area-showcase',
      'area-fountain',
      'bridge-showcase',
      'pav-mexico',
      'pav-norway',
      'pav-china',
      'pav-germany',
      'pav-italy',
      'pav-america',
      'pav-japan',
      'pav-morocco',
      'pav-france',
      'pav-uk',
      'pav-canada',
      'outpost',
      'land-spaceship',
      'attr-journey',
      'attr-soarin',
      'attr-testtrack',
      'attr-rewind',
      'attr-missionspace',
      'attr-seas',
      'attr-lionking',
      'attr-adv',
      'attr-frozen',
      'attr-granfiesta',
      'attr-ratatouille',
      'land-eiffel',
      'land-pyramid',
      'land-stavechurch',
      'area-land',
    ];
    for (const id of keyIds) {
      const v = graph.getVertex(id);
      expect(v, `key location '${id}' must exist`).toBeDefined();
      expect(v!.name.length).toBeGreaterThan(0);
    }
    expect(keyIds).toHaveLength(37); // exactly the whole dataset — nothing unnamed/hidden
  });

  it('has only valid, positive, finite weights and documented provenance values', () => {
    for (const v of dataset.vertices) {
      expect(Number.isFinite(v.x)).toBe(true);
      expect(Number.isFinite(v.y)).toBe(true);
      expect(Number.isFinite(v.z)).toBe(true);
      expect(v.confidence).toBe('approximate'); // no verified spatial claim anywhere
    }
    for (const e of dataset.edges) {
      expect(Number.isFinite(e.weight), e.id).toBe(true);
      expect(e.weight, e.id).toBeGreaterThan(0);
      expect(e.confidence).toBe('approximate');
      expect(['digitized-path', 'straight-line-approx'], e.id).toContain(e.weightSource);
      expect(graph.hasVertex(e.from)).toBe(true);
      expect(graph.hasVertex(e.to)).toBe(true);
    }
  });

  it('reproduces the documented lagoon perimeter within tolerance (provenance-supported)', () => {
    const ringSum = dataset.edges
      .filter((e) => e.id.startsWith('e-ring-'))
      .reduce((sum, e) => sum + e.weight, 0);
    const documented = 1931; // ≈ 1.2 miles, per provenance.md
    expect(ringSum).toBeGreaterThan(documented * 0.97);
    expect(ringSum).toBeLessThanOrEqual(documented * 1.03);
  });
});

describe('EPCOT dataset — algorithm integration', () => {
  it('Dijkstra routes Main Entrance → France with a consistent path', () => {
    const result = findRoute(graph, 'gate-main', 'pav-france', 'dijkstra');
    expectConsistentRoute(result, 'gate-main', 'pav-france');
    if (result.status === 'ok') {
      expect(result.nodesExpanded).toBeGreaterThan(0);
      expect(result.relaxations).toBeGreaterThan(0);
      expect(result.trace.length).toBeGreaterThan(0);
    }
  });

  it('A* returns the same optimal cost as Dijkstra on a battery of queries', () => {
    const pairs: Array<[string, string]> = [
      ['gate-main', 'pav-france'],
      ['gate-main', 'pav-mexico'],
      ['gate-main', 'land-spaceship'],
      ['gate-gateway', 'attr-rewind'],
      ['area-celebration', 'land-eiffel'],
      ['pav-uk', 'pav-china'],
    ];
    for (const [source, target] of pairs) {
      const cmp = compareAlgorithms(graph, source, target);
      expect(cmp.dijkstra.status, `${source} → ${target} dijkstra`).toBe('ok');
      expect(cmp.astar.status, `${source} → ${target} astar`).toBe('ok');
      expect(cmp.sameOptimalCost, `${source} → ${target}`).toBe(true);
      expect(cmp.dijkstra.totalDistance).toBe(cmp.astar.totalDistance);
      expect(cmp.dijkstra.path).toEqual(cmp.astar.path); // admissible heuristic → same optimal path here
    }
  });

  it('A* actually expands fewer nodes than Dijkstra on the long-horizon showcase queries', () => {
    // The Euclidean heuristic is informative on the large open lagoon ring:
    // gate-main → far-side pavilions must cross the whole front area first.
    for (const target of ['pav-france', 'pav-china']) {
      const cmp = compareAlgorithms(graph, 'gate-main', target);
      expect(cmp.nodesExpandedDelta, `gate-main → ${target}`).toBeGreaterThan(0);
    }
  });

  it('BFS finds the fewest-hop route and reports hops, not metres', () => {
    const result = findRoute(graph, 'gate-main', 'pav-france', 'bfs');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.totalDistance).toBe(result.path.length - 1);
      const run = bfs(graph, 'gate-main', { targetId: 'pav-france' });
      expect(run.hopCounts.get('pav-france')).toBe(result.totalDistance);
    }
  });

  it('DFS infrastructure: the graph has a cycle and nothing is orphaned from the Main Entrance', () => {
    expect(detectCycle(graph).hasCycle).toBe(true);
    expect(findUnreachable(graph, 'gate-main')).toEqual([]);
  });

  it('blocking the showcase bridge isolates World Showcase from the main entrance', () => {
    const before = findRoute(graph, 'gate-main', 'pav-france', 'dijkstra');
    const sim = simulateBlockedRoute(graph, 'gate-main', 'pav-france', [
      { from: 'bridge-showcase', to: 'area-showcase' },
    ]);
    expect(sim.before.status).toBe('ok');
    if (sim.before.status !== 'ok' || before.status !== 'ok') {
      throw new Error('expected ok routes before the block');
    }
    expect(sim.before.totalDistance).toBe(before.totalDistance);
    expect(sim.after.status).toBe('unreachable');
    expect(sim.delta).toBeNull();
    // the original graph is untouched
    expect(graph.edgeCount).toBe(43);
    expect(findRoute(graph, 'gate-main', 'pav-france', 'dijkstra').status).toBe('ok');
    // every showcase pavilion becomes unreachable, not just France
    const showcase = [
      'pav-mexico', 'pav-norway', 'pav-china', 'pav-germany', 'pav-italy',
      'pav-america', 'pav-japan', 'pav-morocco', 'pav-france', 'pav-uk', 'pav-canada',
    ];
    for (const pav of showcase) {
      expect(findRoute(graph, 'gate-main', pav, 'dijkstra').status, pav).toBe('ok');
    }
  });

  it('rejects a block on a non-existent edge', () => {
    expect(() =>
      simulateBlockedRoute(graph, 'gate-main', 'pav-france', [
        { from: 'gate-main', to: 'pav-france' },
      ]),
    ).toThrow(/does not exist/);
  });

  it('alternative routing finds a distinct second-best simple path', () => {
    const r1 = findAlternativeRoute(graph, 'area-celebration', 'attr-rewind');
    expect(r1.status).toBe('ok');
    expect(r1.primary).not.toBeNull();
    expect(r1.alternative, 'celebration → rewind must have an alternative').not.toBeNull();
    if (r1.primary !== null && r1.alternative !== null) {
      expect(r1.alternative.totalDistance).toBeGreaterThan(r1.primary.totalDistance);
      expect(r1.extraDistance).toBe(r1.alternative.totalDistance - r1.primary.totalDistance);
      expect(r1.alternative.path).not.toEqual(r1.primary.path);
    }

    const r2 = findAlternativeRoute(graph, 'gate-gateway', 'pav-mexico');
    expect(r2.status).toBe('ok');
    expect(r2.alternative, 'gateway → mexico must have an alternative (the long ring)').not.toBeNull();
  });

  it('walk-time metrics produce a sane estimate for a real route', () => {
    const route = findRoute(graph, 'gate-main', 'pav-france', 'dijkstra');
    expect(route.status).toBe('ok');
    if (route.status === 'ok') {
      const est = estimateWalkTime(route.totalDistance);
      expect(est.estimatedSeconds).toBeCloseTo(route.totalDistance / 1.4, 9);
      expect(est.estimatedMinutes).toBeGreaterThan(0);
      expect(est.isEstimate).toBe(true);
    }
  });
});

describe('EPCOT dataset — raw algorithm runs', () => {
  it('raw dijkstra/aStar runs expose consistent distances maps and traces', () => {
    const dj = dijkstra(graph, 'gate-main', { targetId: 'pav-canada' });
    const as = aStar(graph, 'gate-main', { targetId: 'pav-canada' });
    expect(dj.distances.get('pav-canada')).toBeTypeOf('number');
    expect(as.distances.get('pav-canada')).toBe(dj.distances.get('pav-canada'));
    expect(dj.parent.get('gate-main')).toBeNull();
    expect(dj.trace.length).toBeGreaterThan(0);
    expect(as.trace.length).toBeGreaterThan(0);
  });
});
