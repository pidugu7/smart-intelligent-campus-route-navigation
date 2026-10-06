import { describe, expect, it } from 'vitest';
import { findRoute, type RouteResult } from '../../src/engine/engine';
import { diamondGraph, disconnectedGraph, tieGraph } from '../fixtures/graphs';

describe('findRoute (public engine API)', () => {
  it('returns a full "ok" result with ordered path, cost, stats and trace', () => {
    const result = findRoute(diamondGraph(), 'a', 'd');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable test branch');

    expect(result.path).toEqual(['a', 'b', 'd']);
    expect(result.totalDistance).toBe(3);
    expect(result.vertices.map((v) => v.id)).toEqual(['a', 'b', 'd']);
    expect(result.vertices[0]).toEqual(result.source);
    expect(result.vertices[result.vertices.length - 1]).toEqual(result.target);
    expect(result.nodesExpanded).toBeGreaterThanOrEqual(3);
    expect(result.relaxations).toBeGreaterThan(0);
    expect(result.trace.length).toBeGreaterThan(0);
    expect(result.trace[0]?.type).toBe('start');
  });

  it('uses dijkstra by default (explicit and implicit)', () => {
    const g = tieGraph();
    const implicit = findRoute(g, 'a', 'd');
    const explicit = findRoute(g, 'a', 'd', 'dijkstra');
    expect(implicit.status).toBe('ok');
    expect(explicit.status).toBe('ok');
    if (implicit.status !== 'ok' || explicit.status !== 'ok') throw new Error('unreachable test branch');
    // deterministic: same algorithm -> identical trace
    expect(JSON.stringify(implicit.trace)).toBe(JSON.stringify(explicit.trace));
  });

  it('returns status "unreachable" for disconnected targets', () => {
    const result: RouteResult = findRoute(disconnectedGraph(), 'a', 'x');
    expect(result.status).toBe('unreachable');
    if (result.status !== 'unreachable') throw new Error('unreachable test branch');
    expect(result.source.id).toBe('a');
    expect(result.target.id).toBe('x');
    const last = result.trace[result.trace.length - 1];
    expect(last).toEqual({ type: 'abort', reason: 'unreachable' });
  });

  it('handles source === target with zero cost', () => {
    const result = findRoute(diamondGraph(), 'a', 'a');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable test branch');
    expect(result.path).toEqual(['a']);
    expect(result.totalDistance).toBe(0);
  });

  it('throws for unknown vertex ids (caller error, not a routing failure)', () => {
    const g = diamondGraph();
    expect(() => findRoute(g, 'ghost', 'd')).toThrow(/source vertex "ghost"/);
    expect(() => findRoute(g, 'a', 'ghost')).toThrow(/target vertex "ghost"/);
  });

  it('path vertex ids match the vertices array id-for-id', () => {
    const result = findRoute(tieGraph(), 'a', 'd');
    if (result.status !== 'ok') throw new Error('unreachable test branch');
    expect(result.path).toEqual(result.vertices.map((v) => v.id));
  });
});
