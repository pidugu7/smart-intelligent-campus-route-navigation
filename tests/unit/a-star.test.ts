import { describe, expect, it } from 'vitest';
import { aStar } from '../../src/engine/algorithms/a-star';
import { dijkstra } from '../../src/engine/algorithms/dijkstra';
import { euclideanHeuristic } from '../../src/engine/algorithms/heuristic';
import { GraphError } from '../../src/engine/graph/graph';
import { reconstructPath } from '../../src/engine/routing/path-reconstruct';
import { disconnectedGraph, gridGraph, longCheapTailGraph } from '../fixtures/graphs';

/** Sum of edge weights along a path — must equal the reported optimal cost. */
function pathCost(graph: { neighborsOf: (id: string) => readonly { to: string; weight: number }[] }, path: string[]): number {
  let total = 0;
  for (let i = 0; i + 1 < path.length; i += 1) {
    const u = path[i]!;
    const v = path[i + 1]!;
    const edge = graph.neighborsOf(u).find((e) => e.to === v);
    if (edge === undefined) throw new Error(`path step ${u} -> ${v} is not an edge of the graph`);
    total += edge.weight;
  }
  return total;
}

describe('A* (f = g + h, Euclidean heuristic)', () => {
  it('finds the optimal corner-to-corner route on a grid (cost equals Dijkstra)', () => {
    const g = gridGraph();
    const run = aStar(g, 'v0-0', { targetId: 'v3-3' });
    const dj = dijkstra(g, 'v0-0', { targetId: 'v3-3' });
    expect(run.distances.get('v3-3')).toBe(60);
    expect(run.distances.get('v3-3')).toBe(dj.distances.get('v3-3'));
    const path = reconstructPath(run.parent, 'v0-0', 'v3-3');
    expect(path).not.toBeNull();
    expect(path).toHaveLength(7); // 6 edges: 3 east + 3 north
    expect(pathCost(g, path!)).toBe(60);
  });

  it('steers toward the target: far fewer expansions than Dijkstra on the cheap-tail graph', () => {
    const g = longCheapTailGraph();
    const run = aStar(g, 's', { targetId: 't' });
    const dj = dijkstra(g, 's', { targetId: 't' });

    // Same optimal cost...
    expect(run.distances.get('t')).toBe(50);
    expect(dj.distances.get('t')).toBe(50);
    // ...but A* never pops a tail node (their f = 50 + 2k >= 52 > f(target) = 50),
    // while Dijkstra (g-ordered) walks the whole 1 m tail first.
    expect(run.nodesExpanded).toBe(6); // s, p1..p4, t
    expect(dj.nodesExpanded).toBe(36); // s + 30 tail + p1..p4 + t
    expect(reconstructPath(run.parent, 's', 't')).toEqual(['s', 'p1', 'p2', 'p3', 'p4', 't']);
  });

  it('reports unreachable targets via the trace (no exception)', () => {
    const run = aStar(disconnectedGraph(), 'a', { targetId: 'x' });
    const last = run.trace[run.trace.length - 1];
    expect(last).toEqual({ type: 'abort', reason: 'unreachable' });
    expect(run.distances.has('x')).toBe(false);
  });

  it('handles source === target', () => {
    const run = aStar(gridGraph(), 'v0-0', { targetId: 'v0-0' });
    expect(run.distances.get('v0-0')).toBe(0);
    expect(run.nodesExpanded).toBe(1);
    expect(run.trace[run.trace.length - 1]).toEqual({ type: 'finalize', targetId: 'v0-0', totalDistance: 0 });
    expect(reconstructPath(run.parent, 'v0-0', 'v0-0')).toEqual(['v0-0']);
  });

  it('throws GraphError for unknown source or target ids', () => {
    const g = gridGraph();
    expect(() => aStar(g, 'ghost', { targetId: 'v0-0' })).toThrow(GraphError);
    expect(() => aStar(g, 'v0-0', { targetId: 'ghost' })).toThrow(/target vertex "ghost"/);
  });

  it('with h = 0 degrades to Dijkstra: identical trace and same optimal cost', () => {
    const g = gridGraph();
    const zero = aStar(g, 'v0-0', { targetId: 'v3-3', heuristic: () => 0 });
    const dj = dijkstra(g, 'v0-0', { targetId: 'v3-3' });
    // h = 0 makes f = g and the comparators identical, so the traces match event for event.
    expect(JSON.stringify(zero.trace)).toBe(JSON.stringify(dj.trace));
    expect(zero.distances.get('v3-3')).toBe(dj.distances.get('v3-3'));
    expect(zero.nodesExpanded).toBe(dj.nodesExpanded);
  });

  it('is deterministic: two identical runs produce identical traces', () => {
    const g = longCheapTailGraph();
    const first = aStar(g, 's', { targetId: 't' });
    const second = aStar(g, 's', { targetId: 't' });
    expect(JSON.stringify(first.trace)).toBe(JSON.stringify(second.trace));
    expect(first.distances).toEqual(second.distances);
    expect(first.parent).toEqual(second.parent);
  });

  it('trace uses g-values: the final visit equals the reported optimal cost', () => {
    const g = longCheapTailGraph();
    const run = aStar(g, 's', { targetId: 't' });
    const visitT = run.trace.find((e) => e.type === 'visit' && e.vertexId === 't');
    expect(visitT).toBeDefined();
    if (visitT?.type !== 'visit') throw new Error('unreachable test branch');
    expect(visitT.bestDistance).toBe(50);
    const terminal = run.trace[run.trace.length - 1];
    expect(terminal).toEqual({ type: 'finalize', targetId: 't', totalDistance: 50 });
    expect(run.trace[0]).toEqual({ type: 'start', sourceId: 's' });
  });

  it('relax events are consistent with their improved flag (g-value semantics)', () => {
    const g = gridGraph();
    const run = aStar(g, 'v0-0', { targetId: 'v3-3' });
    for (const e of run.trace) {
      if (e.type !== 'relax') continue;
      if (e.improved) {
        expect(e.oldDistance === null || e.newDistance < e.oldDistance).toBe(true);
      } else {
        expect(e.oldDistance).not.toBeNull();
        expect(e.newDistance).toBeGreaterThanOrEqual(e.oldDistance!);
      }
    }
  });

  it('the euclidean heuristic value is the true straight-line distance', () => {
    const target = { id: 't', name: 'T', type: 'poi', x: 3, y: 4, z: 0 };
    const h = euclideanHeuristic(target);
    expect(h({ id: 'a', name: 'A', type: 'poi', x: 0, y: 0, z: 0 }, target)).toBe(5);
    expect(h(target, target)).toBe(0);
  });
});
