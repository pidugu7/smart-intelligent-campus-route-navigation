import { describe, expect, it } from 'vitest';
import { GraphError } from '../../src/engine/graph/graph';
import { simulateBlockedRoute } from '../../src/engine/simulation/block';
import { lineGraph, ringGraph } from '../fixtures/graphs';

describe('blocked-path simulation (clone + mutate view, original untouched)', () => {
  it('re-routes around a blocked edge and reports the before/after delta', () => {
    const g = ringGraph();
    const result = simulateBlockedRoute(g, 'n0', 'n2', [{ from: 'n2', to: 'n1' }]);

    // blocked edge is canonicalized regardless of the direction it was given in
    expect(result.blockedEdges).toEqual([{ from: 'n1', to: 'n2' }]);

    expect(result.before.status).toBe('ok');
    if (result.before.status !== 'ok') throw new Error('unreachable test branch');
    expect(result.before.path).toEqual(['n0', 'n1', 'n2']);
    expect(result.before.totalDistance).toBe(11);

    expect(result.after.status).toBe('ok');
    if (result.after.status !== 'ok') throw new Error('unreachable test branch');
    expect(result.after.path).toEqual(['n0', 'n4', 'n3', 'n2']);
    expect(result.after.totalDistance).toBe(12);

    expect(result.delta).toEqual({ beforeDistance: 11, afterDistance: 12, distanceDelta: 1 });

    // the ORIGINAL graph is unchanged
    expect(g.edgeCount).toBe(5);
    expect(g.neighborsOf('n1').some((e) => e.to === 'n2')).toBe(true);
  });

  it('blocking an edge NOT on the route leaves the route (and the delta) unchanged', () => {
    const g = ringGraph();
    const result = simulateBlockedRoute(g, 'n0', 'n2', [{ from: 'n3', to: 'n4' }]);
    expect(result.before.status).toBe('ok');
    expect(result.after.status).toBe('ok');
    if (result.before.status !== 'ok' || result.after.status !== 'ok') {
      throw new Error('unreachable test branch');
    }
    expect(result.after.path).toEqual(result.before.path);
    expect(result.delta).toEqual({ beforeDistance: 11, afterDistance: 11, distanceDelta: 0 });
  });

  it('reports "after" as unreachable when the block destroys the only route', () => {
    const g = lineGraph();
    const result = simulateBlockedRoute(g, 'a', 'd', [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
    ]);
    expect(result.before.status).toBe('ok');
    if (result.before.status !== 'ok') throw new Error('unreachable test branch');
    expect(result.before.totalDistance).toBe(6);
    expect(result.after.status).toBe('unreachable');
    if (result.after.status !== 'unreachable') throw new Error('unreachable test branch');
    expect(result.delta).toBeNull();
    expect(result.after.trace[result.after.trace.length - 1]).toEqual({
      type: 'abort',
      reason: 'unreachable',
    });
    // original graph still intact
    expect(g.edgeCount).toBe(3);
  });

  it('supports multiple blocked edges at once (both sides of the ring)', () => {
    const g = ringGraph();
    const result = simulateBlockedRoute(g, 'n0', 'n2', [
      { from: 'n0', to: 'n1' },
      { from: 'n4', to: 'n0' },
    ]);
    // n0 is isolated on the view
    expect(result.before.status).toBe('ok');
    expect(result.after.status).toBe('unreachable');
    expect(result.delta).toBeNull();
    expect(result.blockedEdges).toEqual([
      { from: 'n0', to: 'n1' },
      { from: 'n0', to: 'n4' },
    ]);
  });

  it('deduplicates blocks given in both directions', () => {
    const g = ringGraph();
    const result = simulateBlockedRoute(g, 'n0', 'n2', [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n1' },
    ]);
    expect(result.blockedEdges).toEqual([{ from: 'n1', to: 'n2' }]);
    expect(result.after.status).toBe('ok');
  });

  it('throws on invalid block specs (fail fast with the exact edge named)', () => {
    const g = ringGraph();
    expect(() => simulateBlockedRoute(g, 'n0', 'n2', [])).toThrow(GraphError);
    expect(() => simulateBlockedRoute(g, 'n0', 'n2', [{ from: 'n1', to: 'n1' }])).toThrow(/self-loop/);
    expect(() => simulateBlockedRoute(g, 'n0', 'n2', [{ from: 'n1', to: 'ghost' }])).toThrow(
      /unknown vertex/,
    );
    expect(() => simulateBlockedRoute(g, 'n0', 'n2', [{ from: 'n0', to: 'n3' }])).toThrow(
      /does not exist in the graph/,
    );
  });

  it('works with A* and BFS as the routing algorithm too', () => {
    const g = ringGraph();
    const astar = simulateBlockedRoute(g, 'n0', 'n2', [{ from: 'n1', to: 'n2' }], 'astar');
    expect(astar.after.status).toBe('ok');
    if (astar.after.status === 'ok') expect(astar.after.totalDistance).toBe(12);

    const bfs = simulateBlockedRoute(g, 'n0', 'n2', [{ from: 'n1', to: 'n2' }], 'bfs');
    expect(bfs.after.status).toBe('ok');
    if (bfs.after.status === 'ok') {
      expect(bfs.after.totalDistance).toBe(3); // hops: n0 -> n4 -> n3 -> n2
    }
  });
});
