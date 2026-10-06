import { describe, expect, it } from 'vitest';
import { findAlternativeRoute } from '../../src/engine/routing/alternative';
import {
  disconnectedGraph,
  diamondGraph,
  lineGraph,
  ringGraph,
  tieGraph,
} from '../fixtures/graphs';

describe('alternative route calculation (edge-removal re-runs)', () => {
  it('finds the distinct second route around a ring, with the correct extra cost', () => {
    const result = findAlternativeRoute(ringGraph(), 'n0', 'n2');
    expect(result.status).toBe('ok');
    expect(result.primary).toEqual({ path: ['n0', 'n1', 'n2'], totalDistance: 11 });
    expect(result.alternative).not.toBeNull();
    if (result.alternative === null) throw new Error('unreachable test branch');
    expect(result.alternative.path).toEqual(['n0', 'n4', 'n3', 'n2']);
    expect(result.alternative.totalDistance).toBe(12);
    // deterministic tie-break: the earliest primary edge wins (both candidates cost 12)
    expect(result.alternative.avoidsEdge).toEqual({ from: 'n0', to: 'n1' });
    expect(result.extraDistance).toBe(1);
  });

  it('returns no alternative when the primary is the ONLY route (a line)', () => {
    const result = findAlternativeRoute(lineGraph(), 'a', 'd');
    expect(result.status).toBe('ok');
    expect(result.primary).toEqual({ path: ['a', 'b', 'c', 'd'], totalDistance: 6 });
    expect(result.alternative).toBeNull();
    expect(result.extraDistance).toBeNull();
  });

  it('reports no-primary-route when the destination is unreachable', () => {
    const result = findAlternativeRoute(disconnectedGraph(), 'a', 'x');
    expect(result.status).toBe('no-primary-route');
    expect(result.primary).toBeNull();
    expect(result.alternative).toBeNull();
    expect(result.extraDistance).toBeNull();
  });

  it('returns the 4 m detour on the diamond (a-c-d around the optimal a-b-d)', () => {
    const result = findAlternativeRoute(diamondGraph(), 'a', 'd');
    expect(result.status).toBe('ok');
    expect(result.primary).toEqual({ path: ['a', 'b', 'd'], totalDistance: 3 });
    expect(result.alternative?.path).toEqual(['a', 'c', 'd']);
    expect(result.alternative?.totalDistance).toBe(7);
    expect(result.extraDistance).toBe(4);
    expect(result.alternative?.avoidsEdge).toEqual({ from: 'a', to: 'b' });
  });

  it('allows a zero extra cost when the alternative is equally priced', () => {
    const result = findAlternativeRoute(tieGraph(), 'a', 'd');
    expect(result.status).toBe('ok');
    expect(result.primary?.path).toEqual(['a', 'b', 'd']);
    expect(result.primary?.totalDistance).toBe(2);
    expect(result.alternative?.path).toEqual(['a', 'c', 'd']);
    expect(result.alternative?.totalDistance).toBe(2);
    expect(result.extraDistance).toBe(0);
    expect(result.alternative?.avoidsEdge).toEqual({ from: 'a', to: 'b' });
  });

  it('is deterministic: two runs give identical results', () => {
    const a = findAlternativeRoute(ringGraph(), 'n0', 'n2');
    const b = findAlternativeRoute(ringGraph(), 'n0', 'n2');
    expect(a).toEqual(b);
  });

  it('never mutates the original graph', () => {
    const g = ringGraph();
    const edgeCountBefore = g.edgeCount;
    const degreeBefore = g.degreeOf('n0');
    findAlternativeRoute(g, 'n0', 'n2');
    expect(g.edgeCount).toBe(edgeCountBefore);
    expect(g.degreeOf('n0')).toBe(degreeBefore);
  });
});
