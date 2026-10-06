import { describe, expect, it } from 'vitest';
import { dijkstra } from '../../src/engine/algorithms/dijkstra';
import { GraphError, WeightedGraph } from '../../src/engine/graph/graph';
import { reconstructPath } from '../../src/engine/routing/path-reconstruct';
import type { TraceEvent } from '../../src/engine/trace/step-trace';
import {
  diamondGraph,
  disconnectedGraph,
  hopsVsDistanceGraph,
  lineGraph,
  makeVertex,
  ringGraph,
  tieGraph,
} from '../fixtures/graphs';

type VisitEvent = Extract<TraceEvent, { type: 'visit' }>;
type RelaxEvent = Extract<TraceEvent, { type: 'relax' }>;

function visits(trace: readonly TraceEvent[]): VisitEvent[] {
  return trace.filter((e): e is VisitEvent => e.type === 'visit');
}

function relaxations(trace: readonly TraceEvent[]): RelaxEvent[] {
  return trace.filter((e): e is RelaxEvent => e.type === 'relax');
}

describe('Dijkstra', () => {
  it('computes exact single-source distances on a line graph', () => {
    const run = dijkstra(lineGraph(), 'a');
    expect(run.distances.get('a')).toBe(0);
    expect(run.distances.get('b')).toBe(1);
    expect(run.distances.get('c')).toBe(3);
    expect(run.distances.get('d')).toBe(6);
    expect(run.parent.get('a')).toBeNull();
    expect(run.parent.get('b')).toBe('a');
    expect(run.parent.get('c')).toBe('b');
    expect(run.parent.get('d')).toBe('c');
    expect(run.nodesExpanded).toBe(4);
  });

  it('chooses the cheaper two-edge path over the longer one (diamond)', () => {
    const run = dijkstra(diamondGraph(), 'a', { targetId: 'd' });
    expect(run.distances.get('d')).toBe(3);
    expect(run.parent.get('d')).toBe('b');
    expect(run.parent.get('b')).toBe('a');
    expect(reconstructPath(run.parent, 'a', 'd')).toEqual(['a', 'b', 'd']);
  });

  it('prefers total distance over hop count (hops-vs-distance)', () => {
    const run = dijkstra(hopsVsDistanceGraph(), 'a', { targetId: 'b' });
    expect(run.distances.get('b')).toBe(2);
    expect(run.parent.get('b')).toBe('c');
    expect(reconstructPath(run.parent, 'a', 'b')).toEqual(['a', 'c', 'b']);
  });

  it('resolves both directions around a weighted ring correctly', () => {
    const toN2 = dijkstra(ringGraph(), 'n0', { targetId: 'n2' });
    expect(toN2.distances.get('n2')).toBe(11);
    expect(reconstructPath(toN2.parent, 'n0', 'n2')).toEqual(['n0', 'n1', 'n2']);

    const toN3 = dijkstra(ringGraph(), 'n0', { targetId: 'n3' });
    expect(toN3.distances.get('n3')).toBe(11);
    expect(reconstructPath(toN3.parent, 'n0', 'n3')).toEqual(['n0', 'n4', 'n3']);
  });

  it('early exit expands strictly fewer vertices than a full run', () => {
    const ring = ringGraph();
    const early = dijkstra(ring, 'n0', { targetId: 'n2' });
    const full = dijkstra(ring, 'n0');
    // n0, then n1 (1), then n4 (10 < 11), then n2 (11) -> stops before n3.
    expect(early.nodesExpanded).toBe(4);
    expect(full.nodesExpanded).toBe(5);
    expect(early.nodesExpanded).toBeLessThan(full.nodesExpanded);
  });

  it('early exit leaves undiscovered vertices out of the distance map', () => {
    const line = lineGraph();
    const early = dijkstra(line, 'a', { targetId: 'b' });
    expect(early.nodesExpanded).toBe(2); // a, b
    expect(early.distances.get('a')).toBe(0);
    expect(early.distances.get('b')).toBe(1);
    // c and d were never relaxed, so the map is (documentedly) partial:
    expect(early.distances.has('c')).toBe(false);
    expect(early.distances.has('d')).toBe(false);
    const full = dijkstra(line, 'a');
    expect(full.distances.get('d')).toBe(6);
  });

  it('reports unreachable targets via the trace (no exception)', () => {
    const run = dijkstra(disconnectedGraph(), 'a', { targetId: 'x' });
    const last = run.trace[run.trace.length - 1];
    expect(last).toEqual({ type: 'abort', reason: 'unreachable' });
    expect(run.distances.has('x')).toBe(false);
    expect(reconstructPath(run.parent, 'a', 'x')).toBeNull();
  });

  it('handles source === target', () => {
    const run = dijkstra(lineGraph(), 'a', { targetId: 'a' });
    expect(run.distances.get('a')).toBe(0);
    expect(run.nodesExpanded).toBe(1);
    expect(run.trace[run.trace.length - 1]).toEqual({ type: 'finalize', targetId: 'a', totalDistance: 0 });
    expect(reconstructPath(run.parent, 'a', 'a')).toEqual(['a']);
  });

  it('throws GraphError for unknown source or target ids', () => {
    const g = lineGraph();
    expect(() => dijkstra(g, 'ghost')).toThrow(GraphError);
    expect(() => dijkstra(g, 'ghost')).toThrow(/source vertex "ghost"/);
    expect(() => dijkstra(g, 'a', { targetId: 'ghost' })).toThrow(/target vertex "ghost"/);
  });

  it('skips stale heap entries via lazy deletion (triangle: a-b=5, a-c=1, c-b=1)', () => {
    const g = new WeightedGraph();
    for (const id of ['a', 'b', 'c']) g.addVertex(makeVertex(id));
    g.addEdge({ from: 'a', to: 'b', weight: 5, kind: 'path' });
    g.addEdge({ from: 'a', to: 'c', weight: 1, kind: 'path' });
    g.addEdge({ from: 'c', to: 'b', weight: 1, kind: 'path' });

    const run = dijkstra(g, 'a', { targetId: 'b' });
    // b was first pushed with cost 5, then improved to 2 via c; the stale
    // entry must have been skipped and the parent updated.
    expect(run.distances.get('b')).toBe(2);
    expect(run.parent.get('b')).toBe('c');
    expect(run.nodesExpanded).toBe(3); // a, c, b
    expect(reconstructPath(run.parent, 'a', 'b')).toEqual(['a', 'c', 'b']);
  });

  it('is deterministic: two identical runs produce identical traces', () => {
    const g = diamondGraph();
    const first = dijkstra(g, 'a', { targetId: 'd' });
    const second = dijkstra(g, 'a', { targetId: 'd' });
    expect(JSON.stringify(first.trace)).toBe(JSON.stringify(second.trace));
    expect(first.distances).toEqual(second.distances);
    expect(first.parent).toEqual(second.parent);
  });

  it('breaks equal-cost ties deterministically (id order) and stays stable', () => {
    const g = tieGraph();
    const path1 = reconstructPath(dijkstra(g, 'a', { targetId: 'd' }).parent, 'a', 'd');
    const path2 = reconstructPath(dijkstra(g, 'a', { targetId: 'd' }).parent, 'a', 'd');
    expect(path1).toEqual(['a', 'b', 'd']);
    expect(path2).toEqual(['a', 'b', 'd']);
  });

  describe('trace invariants', () => {
    const run = dijkstra(diamondGraph(), 'a', { targetId: 'd' });

    it('starts with a start event and ends with finalize (routed run)', () => {
      expect(run.trace[0]).toEqual({ type: 'start', sourceId: 'a' });
      expect(run.trace[run.trace.length - 1]).toEqual({ type: 'finalize', targetId: 'd', totalDistance: 3 });
    });

    it('visit distances are non-decreasing (Dijkstra finality invariant)', () => {
      const v = visits(run.trace);
      expect(v.length).toBe(run.nodesExpanded);
      for (let i = 1; i < v.length; i += 1) {
        expect(v[i]!.bestDistance).toBeGreaterThanOrEqual(v[i - 1]!.bestDistance);
      }
    });

    it('relax events are consistent with their improved flag', () => {
      const r = relaxations(run.trace);
      expect(r.length).toBe(run.relaxations);
      for (const e of r) {
        if (e.improved) {
          expect(e.oldDistance === null || e.newDistance < e.oldDistance).toBe(true);
        } else {
          expect(e.oldDistance).not.toBeNull();
          expect(e.newDistance).toBeGreaterThanOrEqual(e.oldDistance!);
        }
      }
    });

    it('the finalize distance equals the recorded best distance of the target', () => {
      expect(run.distances.get('d')).toBe(3);
    });
  });
});
