import { describe, expect, it } from 'vitest';
import { aStar } from '../../src/engine/algorithms/a-star';
import { bfs } from '../../src/engine/algorithms/bfs';
import { dijkstra } from '../../src/engine/algorithms/dijkstra';
import { TraceRecorder, type TraceEvent } from '../../src/engine/trace/step-trace';
import { diamondGraph, disconnectedGraph, gridGraph, hopsVsDistanceGraph } from '../fixtures/graphs';

const ALLOWED_TYPES: ReadonlySet<string> = new Set(['start', 'visit', 'relax', 'finalize', 'abort']);

describe('TraceRecorder', () => {
  it('starts empty', () => {
    const rec = new TraceRecorder();
    expect(rec.count).toBe(0);
    expect(rec.list()).toEqual([]);
  });

  it('records events in emission order', () => {
    const rec = new TraceRecorder();
    rec.emit({ type: 'start', sourceId: 'a' });
    rec.emit({ type: 'visit', vertexId: 'a', bestDistance: 0 });
    rec.emit({ type: 'finalize', targetId: 'a', totalDistance: 0 });
    expect(rec.count).toBe(3);
    expect(rec.list().map((e) => e.type)).toEqual(['start', 'visit', 'finalize']);
  });
});

describe('TraceEvent schema (runtime conformance of real runs)', () => {
  it('every event of a successful run has a valid type and payload', () => {
    const run = dijkstra(diamondGraph(), 'a', { targetId: 'd' });
    expect(run.trace.length).toBeGreaterThan(0);
    for (const e of run.trace) {
      expect(ALLOWED_TYPES.has(e.type)).toBe(true);
      switch (e.type) {
        case 'start':
          expect(typeof e.sourceId).toBe('string');
          break;
        case 'visit':
          expect(typeof e.vertexId).toBe('string');
          expect(Number.isFinite(e.bestDistance)).toBe(true);
          break;
        case 'relax':
          expect(typeof e.fromId).toBe('string');
          expect(typeof e.toId).toBe('string');
          expect(Number.isFinite(e.newDistance)).toBe(true);
          expect(e.oldDistance === null || Number.isFinite(e.oldDistance)).toBe(true);
          expect(typeof e.improved).toBe('boolean');
          break;
        case 'finalize':
          expect(typeof e.targetId).toBe('string');
          expect(Number.isFinite(e.totalDistance)).toBe(true);
          break;
        case 'abort':
          expect(e.reason).toBe('unreachable');
          break;
      }
    }
  });

  it('routed runs always end with exactly one terminal event', () => {
    const ok = dijkstra(diamondGraph(), 'a', { targetId: 'd' });
    const okLast = ok.trace[ok.trace.length - 1];
    expect(okLast?.type).toBe('finalize');

    const bad = dijkstra(disconnectedGraph(), 'a', { targetId: 'x' });
    const badLast = bad.trace[bad.trace.length - 1];
    expect(badLast).toEqual({ type: 'abort', reason: 'unreachable' });
  });

  it('full single-source runs (no target) have no terminal event', () => {
    const run = dijkstra(diamondGraph(), 'a');
    const types = run.trace.map((e: TraceEvent) => e.type);
    expect(types).not.toContain('finalize');
    expect(types).not.toContain('abort');
  });
});

describe('TraceEvent schema conformance: A* and BFS', () => {
  it('A* runs use the same event schema (g-value semantics)', () => {
    const run = aStar(gridGraph(), 'v0-0', { targetId: 'v3-3' });
    expect(run.trace[0]).toEqual({ type: 'start', sourceId: 'v0-0' });
    for (const e of run.trace) {
      expect(ALLOWED_TYPES.has(e.type)).toBe(true);
      if (e.type === 'relax') {
        expect(Number.isFinite(e.newDistance)).toBe(true);
        expect(e.oldDistance === null || Number.isFinite(e.oldDistance)).toBe(true);
      }
    }
    expect(run.trace[run.trace.length - 1]).toEqual({
      type: 'finalize',
      targetId: 'v3-3',
      totalDistance: 60,
    });
  });

  it('BFS runs use the same event schema (hop-count semantics)', () => {
    const run = bfs(hopsVsDistanceGraph(), 'a', { targetId: 'b' });
    expect(run.trace[0]).toEqual({ type: 'start', sourceId: 'a' });
    const visits = run.trace.filter((e) => e.type === 'visit');
    expect(visits.map((e) => (e.type === 'visit' ? e.bestDistance : NaN))).toEqual([0, 1]);
    expect(run.trace[run.trace.length - 1]).toEqual({
      type: 'finalize',
      targetId: 'b',
      totalDistance: 1, // one HOP, not metres
    });
  });

  it('BFS unreachable runs end with the same abort event as Dijkstra', () => {
    const run = bfs(disconnectedGraph(), 'a', { targetId: 'x' });
    expect(run.trace[run.trace.length - 1]).toEqual({ type: 'abort', reason: 'unreachable' });
  });
});
