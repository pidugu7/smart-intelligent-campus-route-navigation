/**
 * Integration test — the REAL EPCOT dataset through the full routing stack.
 *
 * These tests pin the deterministic behaviour of every routing entry point
 * on the frozen dataset (37 vertices / 43 edges). They are the "known
 * answer" tests a viva examiner can re-run:
 *
 *   - Dijkstra gate-main → pav-morocco: 1010 m, exact 11-vertex path
 *   - A* on the same query: identical 1010 m cost, far fewer expansions
 *   - BFS on the same query: fewest hops (10), a DIFFERENT objective
 *   - blocked lagoon bridge → showcase side unreachable (pinch point)
 *   - alternative route: distinct simple path, +14 m over the primary
 *   - traces: start … finalize, every path vertex actually visited
 *
 * The numeric constants below are the engine's current deterministic output
 * on the frozen dataset; they are not hand-computed.
 */

import { describe, expect, it } from 'vitest';
import epcot from '../../src/data/datasets/epcot/dataset.json';
import { loadDataset } from '../../src/data/loader';
import {
  compareAlgorithms,
  findAlternativeRoute,
  findRoute,
  simulateBlockedRoute,
} from '../../src/engine/engine';

const loaded = loadDataset(epcot);
const graph = loaded.graph;

/** Walk a path and verify every consecutive pair is a real edge. */
function expectValidPath(path: readonly string[]): void {
  expect(path.length).toBeGreaterThanOrEqual(2);
  for (let i = 0; i + 1 < path.length; i += 1) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const neighbour = graph.neighborsOf(a).find((e) => e.to === b);
    expect(neighbour, `${a} -> ${b} must be a real edge`).toBeDefined();
  }
}

describe('EPCOT routing — known answers', () => {
  it('Dijkstra: gate-main → pav-morocco is 1010 m over the promenade ring', () => {
    const r = findRoute(graph, 'gate-main', 'pav-morocco', 'dijkstra');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.totalDistance).toBe(1010);
    expect(r.path).toEqual([
      'gate-main', 'gate-plaza', 'area-celebration', 'attr-journey', 'area-fountain',
      'bridge-showcase', 'area-showcase', 'pav-canada', 'pav-uk', 'pav-france', 'pav-morocco',
    ]);
    expectValidPath(r.path);
    expect(r.nodesExpanded).toBe(31);
    expect(r.relaxations).toBe(37);
  });

  it('A*: same optimal 1010 m cost, but expands far fewer nodes (15 vs 31)', () => {
    const r = findRoute(graph, 'gate-main', 'pav-morocco', 'astar');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.totalDistance).toBe(1010);
    expectValidPath(r.path);
    // The Euclidean heuristic guides the search toward Morocco: 16 fewer
    // expansions than Dijkstra on THIS query (A* is not guaranteed this
    // everywhere — compareAlgorithms reports it honestly per query).
    expect(r.nodesExpanded).toBeLessThan(31);
    expect(r.nodesExpanded).toBe(15);
  });

  it('BFS: minimizes HOPS (10), not metres — same path shape, different cost model', () => {
    const r = findRoute(graph, 'gate-main', 'pav-morocco', 'bfs');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expectValidPath(r.path);
    // BFS cost is the hop count: exactly the number of edges on the path.
    expect(r.totalDistance).toBe(10);
    expect(r.totalDistance).toBe(r.path.length - 1);
    // …and hops are NOT metres (the weighted cost of this same walk is 1010).
    expect(r.totalDistance).not.toBe(1010);
  });

  it('Dijkstra vs A* comparison agrees: same optimal cost, measured Δexpansions', () => {
    const cmp = compareAlgorithms(graph, 'gate-main', 'pav-morocco');
    expect(cmp.sameOptimalCost).toBe(true);
    expect(cmp.dijkstra.totalDistance).toBe(1010);
    expect(cmp.astar.totalDistance).toBe(1010);
    expect(cmp.dijkstra.nodesExpanded).toBe(31);
    expect(cmp.astar.nodesExpanded).toBe(15);
    expect(cmp.nodesExpandedDelta).toBe(16); // Dijkstra − A* (can be 0/negative elsewhere)
  });

  it('gate-main → pav-germany: both weighted algorithms agree at 1198 m', () => {
    const di = findRoute(graph, 'gate-main', 'pav-germany', 'dijkstra');
    const as = findRoute(graph, 'gate-main', 'pav-germany', 'astar');
    expect(di.status).toBe('ok');
    expect(as.status).toBe('ok');
    if (di.status !== 'ok' || as.status !== 'ok') return;
    expect(di.totalDistance).toBe(1198);
    expect(as.totalDistance).toBe(1198);
  });
});

describe('EPCOT routing — blocked lagoon bridge (single pinch point)', () => {
  // The only walkable crossing of the showcase lagoon is
  // area-fountain ↔ bridge-showcase (edge e-fountain-bridge).
  const bridgeBlock = [{ from: 'area-fountain', to: 'bridge-showcase' }];

  it('blocking the bridge makes the showcase side unreachable', () => {
    const sim = simulateBlockedRoute(graph, 'gate-main', 'pav-france', bridgeBlock, 'dijkstra');
    expect(sim.before.status).toBe('ok');
    if (sim.before.status === 'ok') expect(sim.before.totalDistance).toBe(874);
    expect(sim.after.status).toBe('unreachable');
    expect(sim.delta).toBeNull();
    // The original graph is untouched: an unblocked rerun still finds 874 m.
    const again = findRoute(graph, 'gate-main', 'pav-france', 'dijkstra');
    expect(again.status).toBe('ok');
    if (again.status === 'ok') expect(again.totalDistance).toBe(874);
  });

  it('blocking the bridge does not affect front-of-park pairs (delta 0)', () => {
    const sim = simulateBlockedRoute(graph, 'gate-main', 'area-celebration', bridgeBlock, 'dijkstra');
    expect(sim.before.status).toBe('ok');
    expect(sim.after.status).toBe('ok');
    if (sim.before.status === 'ok' && sim.after.status === 'ok') {
      expect(sim.before.totalDistance).toBe(171);
      expect(sim.after.totalDistance).toBe(171);
      expect(sim.delta).toEqual({ beforeDistance: 171, afterDistance: 171, distanceDelta: 0 });
    }
  });
});

describe('EPCOT routing — alternative route', () => {
  it('finds a distinct simple path at +14 m over the 1010 m primary, deterministically', () => {
    const a1 = findAlternativeRoute(graph, 'gate-main', 'pav-morocco', 'dijkstra');
    const a2 = findAlternativeRoute(graph, 'gate-main', 'pav-morocco', 'dijkstra');
    expect(a1.status).toBe('ok');
    // Deterministic: identical result on every run.
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2));

    const primary = a1.primary!;
    const alternative = a1.alternative!;
    expect(primary.totalDistance).toBe(1010);
    expect(alternative.totalDistance).toBe(1024);
    expect(a1.extraDistance).toBe(14);
    expectValidPath(primary.path);
    expectValidPath(alternative.path);
    // Distinct from the primary (guarantee: best cost among all SIMPLE paths
    // distinct from the primary — this is NOT Yen's k-shortest listing).
    expect(JSON.stringify(alternative.path)).not.toBe(JSON.stringify(primary.path));
    // A distinct simple path cannot be cheaper than the optimal primary.
    expect(alternative.totalDistance).toBeGreaterThan(primary.totalDistance);
    // The alternative avoids one primary edge and is 11 edges long (12 vertices).
    expect(alternative.path).toHaveLength(12);
    expect(alternative.avoidsEdge).toBeDefined();
  });
});

describe('EPCOT routing — trace contract', () => {
  it('a successful run: start … finalize, and every path vertex is visited', () => {
    const r = findRoute(graph, 'gate-main', 'pav-morocco', 'dijkstra');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    const trace = r.trace;
    expect(trace.length).toBe(70);
    expect(trace[0]!.type).toBe('start');
    if (trace[0]!.type === 'start') expect(trace[0]!.sourceId).toBe('gate-main');
    const last = trace[trace.length - 1]!;
    expect(last.type).toBe('finalize');
    if (last.type === 'finalize') {
      expect(last.targetId).toBe('pav-morocco');
      expect(last.totalDistance).toBe(1010);
    }
    // Every vertex on the optimal path was expanded (visited) by the search.
    const visited = trace.filter((e) => e.type === 'visit').map((e) => (e.type === 'visit' ? e.vertexId : ''));
    for (const id of r.path) {
      expect(visited, `path vertex ${id} must be visited`).toContain(id);
    }
  });

  it('an aborted run (unreachable) ends with an abort event', () => {
    // Block the lagoon bridge, then ask for the showcase side.
    const sim = simulateBlockedRoute(graph, 'gate-main', 'pav-france', [
      { from: 'area-fountain', to: 'bridge-showcase' },
    ], 'dijkstra');
    expect(sim.after.status).toBe('unreachable');
    const last = sim.after.trace[sim.after.trace.length - 1]!;
    expect(last.type).toBe('abort');
    if (last.type === 'abort') expect(last.reason).toBe('unreachable');
  });
});
