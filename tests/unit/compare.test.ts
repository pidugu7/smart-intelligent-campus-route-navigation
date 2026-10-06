import { describe, expect, it } from 'vitest';
import { aStar } from '../../src/engine/algorithms/a-star';
import { dijkstra } from '../../src/engine/algorithms/dijkstra';
import { WeightedGraph } from '../../src/engine/graph/graph';
import { compareAlgorithms } from '../../src/engine/routing/compare';
import { disconnectedGraph, gridGraph, longCheapTailGraph } from '../fixtures/graphs';
import { mulberry32 } from '../fixtures/rng';

/**
 * Random SPATIAL graph: n points, each connected to its 2 nearest neighbours,
 * weight = length × factor with factor in [1, 1.5] — so the Euclidean
 * heuristic is admissible for every edge (the A* guarantee's precondition).
 */
function randomSpatialGraph(seed: number, n = 10): WeightedGraph {
  const rand = mulberry32(seed);
  const g = new WeightedGraph();
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i += 1) {
    pts.push({ x: Math.round(rand() * 1000) / 10, y: Math.round(rand() * 1000) / 10 });
  }
  for (let i = 0; i < n; i += 1) {
    g.addVertex({ id: `r${i}`, name: `node ${i}`, type: 'intersection', x: pts[i]!.x, y: pts[i]!.y, z: 0 });
  }
  const added = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  for (let i = 0; i < n; i += 1) {
    const neighbours = pts
      .map((q, j) => ({ j, d: Math.hypot(pts[i]!.x - q.x, pts[i]!.y - q.y) }))
      .filter((e) => e.j !== i)
      .sort((a, b) => a.d - b.d);
    for (const e of neighbours.slice(0, 2)) {
      const k = key(i, e.j);
      if (added.has(k)) continue;
      added.add(k);
      const weight = Math.max(0.1, Math.round(e.d * (1 + 0.5 * rand()) * 10) / 10);
      g.addEdge({ from: `r${i}`, to: `r${e.j}`, weight, kind: 'path' });
    }
  }
  return g;
}

describe('Dijkstra vs A* comparison', () => {
  it('verifies equal optimal cost and measures the expansion saving on the cheap-tail graph', () => {
    const comparison = compareAlgorithms(longCheapTailGraph(), 's', 't');

    expect(comparison.sameOptimalCost).toBe(true);
    expect(comparison.dijkstra.totalDistance).toBe(50);
    expect(comparison.astar.totalDistance).toBe(50);
    expect(comparison.dijkstra.path).toEqual(['s', 'p1', 'p2', 'p3', 'p4', 't']);
    expect(comparison.astar.path).toEqual(comparison.dijkstra.path);
    expect(comparison.dijkstra.nodesExpanded).toBe(36);
    expect(comparison.astar.nodesExpanded).toBe(6);
    expect(comparison.nodesExpandedDelta).toBe(30);
    expect(comparison.dijkstra.traceSteps).toBeGreaterThan(comparison.astar.traceSteps);
    // summary shape
    expect(comparison.dijkstra.algorithm).toBe('dijkstra');
    expect(comparison.astar.algorithm).toBe('astar');
    expect(comparison.sourceId).toBe('s');
    expect(comparison.targetId).toBe('t');
  });

  it('A* is NOT always faster: on a uniform grid it expands the same nodes (delta 0)', () => {
    const comparison = compareAlgorithms(gridGraph(4, 4), 'v0-0', 'v3-3');
    expect(comparison.sameOptimalCost).toBe(true);
    expect(comparison.dijkstra.totalDistance).toBe(60);
    expect(comparison.astar.totalDistance).toBe(60);
    // Every grid node has f <= f(target) on this query, so both expand all 16.
    // Documented behaviour: the saving depends on the heuristic and the graph.
    expect(comparison.dijkstra.nodesExpanded).toBe(16);
    expect(comparison.astar.nodesExpanded).toBe(16);
    expect(comparison.nodesExpandedDelta).toBe(0);
  });

  it('with a zero heuristic, A* expands exactly as much as Dijkstra (degenerate case)', () => {
    const comparison = compareAlgorithms(longCheapTailGraph(), 's', 't', { heuristic: () => 0 });
    expect(comparison.sameOptimalCost).toBe(true);
    expect(comparison.nodesExpandedDelta).toBe(0);
  });

  it('agrees on unreachable targets (both abort)', () => {
    const comparison = compareAlgorithms(disconnectedGraph(), 'a', 'x');
    expect(comparison.dijkstra.status).toBe('unreachable');
    expect(comparison.astar.status).toBe('unreachable');
    expect(comparison.sameOptimalCost).toBe(true);
    expect(comparison.dijkstra.totalDistance).toBeNull();
    expect(comparison.astar.path).toEqual([]);
  });

  it('is deterministic: two comparisons on the same input are identical', () => {
    const a = compareAlgorithms(longCheapTailGraph(), 's', 't');
    const b = compareAlgorithms(longCheapTailGraph(), 's', 't');
    expect(a).toEqual(b);
  });

  it('A* cost equals Dijkstra cost on random spatial graphs (admissible heuristic, all pairs)', () => {
    // Property-style check: on random geometric graphs with weight = length ×
    // factor (factor >= 1), the Euclidean heuristic is admissible, so A* MUST
    // match Dijkstra's optimal cost on every query (reachable or not).
    for (const seed of [1, 7, 42]) {
      const g = randomSpatialGraph(seed, 10);
      const ids = g.vertexIds();
      for (const a of ids) {
        for (const b of ids) {
          if (a === b) continue;
          const comparison = compareAlgorithms(g, a, b);
          expect(
            comparison.sameOptimalCost,
            `seed ${seed}, ${a} -> ${b}: dijkstra=${comparison.dijkstra.totalDistance} astar=${comparison.astar.totalDistance}`,
          ).toBe(true);
        }
      }
    }
  });

  it('the A* path returned by the comparison is a valid path whose edge costs sum to the reported total', () => {
    const g = randomSpatialGraph(99, 10);
    const comparison = compareAlgorithms(g, 'r0', 'r9');
    if (comparison.astar.status !== 'ok') {
      // r0 and r9 may be disconnected on this seed; then Dijkstra must say so too.
      expect(comparison.dijkstra.status).toBe('unreachable');
      return;
    }
    let total = 0;
    for (let i = 0; i + 1 < comparison.astar.path.length; i += 1) {
      const u = comparison.astar.path[i]!;
      const v = comparison.astar.path[i + 1]!;
      const edge = g.neighborsOf(u).find((e) => e.to === v);
      expect(edge, `${u} -> ${v} must be a real edge`).toBeDefined();
      total += edge!.weight;
    }
    expect(total).toBeCloseTo(comparison.astar.totalDistance!, 6);
  });

  it('both algorithms agree directly (cross-check of the raw runs, not just summaries)', () => {
    const g = randomSpatialGraph(5, 12);
    const ids = g.vertexIds();
    let checked = 0;
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        const dj = dijkstra(g, a, { targetId: b });
        const as = aStar(g, a, { targetId: b });
        const djOk = dj.trace[dj.trace.length - 1]?.type === 'finalize';
        const asOk = as.trace[as.trace.length - 1]?.type === 'finalize';
        expect(djOk).toBe(asOk);
        if (djOk && asOk) {
          expect(as.distances.get(b)).toBe(dj.distances.get(b));
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
