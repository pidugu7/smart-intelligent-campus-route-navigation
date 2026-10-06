import { describe, expect, it } from 'vitest';
import { bfs } from '../../src/engine/algorithms/bfs';
import { dijkstra } from '../../src/engine/algorithms/dijkstra';
import { GraphError } from '../../src/engine/graph/graph';
import { reconstructPath } from '../../src/engine/routing/path-reconstruct';
import { disconnectedGraph, gridGraph, hopsVsDistanceGraph, ringGraph } from '../fixtures/graphs';

type VisitEvent = Extract<ReturnType<typeof bfs>['trace'][number], { type: 'visit' }>;

describe('BFS (unweighted, fewest-hop routing)', () => {
  it('minimizes HOPS, not metres: takes the 10 m direct edge over the 2 m detour', () => {
    const g = hopsVsDistanceGraph();
    const run = bfs(g, 'a', { targetId: 'b' });
    const dj = dijkstra(g, 'a', { targetId: 'b' });

    // BFS: 1 hop, direct edge (cost 10 m). Dijkstra: 2 metres via c.
    // Same graph, different cost objective -> different routes. This is the
    // canonical BFS-vs-Dijkstra viva example.
    expect(run.hopCounts.get('b')).toBe(1);
    expect(reconstructPath(run.parent, 'a', 'b')).toEqual(['a', 'b']);
    expect(dj.distances.get('b')).toBe(2);
    expect(reconstructPath(dj.parent, 'a', 'b')).toEqual(['a', 'c', 'b']);
  });

  it('fewest hops around a weighted ring (2 hops via n4, though n1 side costs less in metres)', () => {
    const g = ringGraph();
    const run = bfs(g, 'n0', { targetId: 'n3' });
    expect(run.hopCounts.get('n3')).toBe(2);
    expect(reconstructPath(run.parent, 'n0', 'n3')).toEqual(['n0', 'n4', 'n3']);
    // Dijkstra on the same query costs 11 m (also via n4 — coincidence of weights);
    // the BFS cost is 2 HOPS, a different unit entirely.
    const dj = dijkstra(g, 'n0', { targetId: 'n3' });
    expect(dj.distances.get('n3')).toBe(11);
  });

  it('computes exact fewest-hop distances on a grid', () => {
    const g = gridGraph(4, 4);
    const run = bfs(g, 'v0-0');
    expect(run.hopCounts.get('v0-0')).toBe(0);
    expect(run.hopCounts.get('v0-1')).toBe(1);
    expect(run.hopCounts.get('v1-1')).toBe(2);
    expect(run.hopCounts.get('v3-3')).toBe(6);
    expect(run.nodesExpanded).toBe(16);
  });

  it('reports unreachable targets via the trace (no exception)', () => {
    const run = bfs(disconnectedGraph(), 'a', { targetId: 'x' });
    const last = run.trace[run.trace.length - 1];
    expect(last).toEqual({ type: 'abort', reason: 'unreachable' });
    expect(run.hopCounts.has('x')).toBe(false);
  });

  it('handles source === target (0 hops)', () => {
    const run = bfs(gridGraph(), 'v0-0', { targetId: 'v0-0' });
    expect(run.hopCounts.get('v0-0')).toBe(0);
    expect(run.nodesExpanded).toBe(1);
    expect(run.trace[run.trace.length - 1]).toEqual({ type: 'finalize', targetId: 'v0-0', totalDistance: 0 });
    expect(reconstructPath(run.parent, 'v0-0', 'v0-0')).toEqual(['v0-0']);
  });

  it('throws GraphError for unknown source or target ids', () => {
    const g = gridGraph();
    expect(() => bfs(g, 'ghost')).toThrow(GraphError);
    expect(() => bfs(g, 'v0-0', { targetId: 'ghost' })).toThrow(/target vertex "ghost"/);
  });

  it('visit depths are non-decreasing (BFS level-by-level invariant)', () => {
    const run = bfs(gridGraph(4, 4), 'v0-0');
    const visits: VisitEvent[] = run.trace.filter((e): e is VisitEvent => e.type === 'visit');
    expect(visits.length).toBe(16);
    for (let i = 1; i < visits.length; i += 1) {
      expect(visits[i]!.bestDistance).toBeGreaterThanOrEqual(visits[i - 1]!.bestDistance);
    }
  });

  it('relax events improve only on first discovery (oldDistance null)', () => {
    const run = bfs(gridGraph(4, 4), 'v0-0');
    for (const e of run.trace) {
      if (e.type !== 'relax') continue;
      if (e.improved) {
        expect(e.oldDistance).toBeNull();
      } else {
        expect(e.oldDistance).not.toBeNull();
      }
    }
  });

  it('is deterministic: two identical runs produce identical traces', () => {
    const g = ringGraph();
    const first = bfs(g, 'n0', { targetId: 'n3' });
    const second = bfs(g, 'n0', { targetId: 'n3' });
    expect(JSON.stringify(first.trace)).toBe(JSON.stringify(second.trace));
    expect(first.hopCounts).toEqual(second.hopCounts);
    expect(first.parent).toEqual(second.parent);
  });

  it('early exit stops expanding at the target', () => {
    const g = gridGraph(4, 4);
    const early = bfs(g, 'v0-0', { targetId: 'v0-2' }); // 2 hops away
    const full = bfs(g, 'v0-0');
    expect(early.nodesExpanded).toBeLessThan(full.nodesExpanded);
    expect(early.hopCounts.get('v3-3')).toBeUndefined(); // far corner never reached
  });
});
