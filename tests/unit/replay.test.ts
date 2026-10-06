/**
 * Unit tests for the Phase 4 TraceReplayer (pure driver — no three.js).
 *
 * The replayer must deliver a finished engine trace exactly once, in order,
 * at the configured speed, with correct play/pause/reset semantics and a
 * single onDone.
 */

import { describe, expect, it } from 'vitest';
import type { TraceEvent } from '../../src/engine/engine';
import { TraceReplayer, describeTraceEvent } from '../../src/viz/replay';

const trace: TraceEvent[] = [
  { type: 'start', sourceId: 'a' },
  { type: 'visit', vertexId: 'a', bestDistance: 0 },
  { type: 'relax', fromId: 'a', toId: 'b', oldDistance: null, newDistance: 5, improved: true },
  { type: 'visit', vertexId: 'b', bestDistance: 5 },
  { type: 'finalize', targetId: 'b', totalDistance: 5 },
];

function harness(eventsPerSecond = 1000) {
  const seen: Array<string> = [];
  let done = 0;
  let progress = 0;
  const replayer = new TraceReplayer(trace, {
    onEvent: (ev, i) => {
      seen.push(`${ev.type}:${i}`);
    },
    onDone: () => {
      done += 1;
    },
    onProgress: () => {
      progress += 1;
    },
  });
  replayer.setSpeed(eventsPerSecond);
  return { replayer, seen, state: () => done, progress: () => progress };
}

describe('TraceReplayer', () => {
  it('delivers every event exactly once, in order, and fires onDone once', () => {
    const { replayer, seen, state, progress } = harness();
    replayer.play();
    replayer.tick(1); // 1000 ev/s → everything fits
    expect(seen).toEqual(['start:0', 'visit:1', 'relax:2', 'visit:3', 'finalize:4']);
    expect(state()).toBe(1);
    expect(progress()).toBe(5);
    expect(replayer.state).toBe('done');
  });

  it('pacing: slower speeds spread events over more frames', () => {
    const { replayer, seen } = harness(2); // 2 events per second
    replayer.play();
    replayer.tick(0.5); // 1 event
    expect(seen).toEqual(['start:0']);
    expect(replayer.state).toBe('playing');
    replayer.tick(0.5); // 1 more event
    expect(seen).toEqual(['start:0', 'visit:1']);
    expect(replayer.currentIndex).toBe(2);
  });

  it('pause freezes playback until play() again', () => {
    const { replayer, seen } = harness(10);
    replayer.play();
    replayer.tick(0.3); // 3 events
    replayer.pause();
    expect(replayer.state).toBe('paused');
    const snapshot = [...seen];
    replayer.tick(5);
    expect(seen).toEqual(snapshot);
    replayer.play();
    expect(replayer.isPlaying).toBe(true);
    replayer.tick(5);
    expect(seen).toHaveLength(trace.length);
  });

  it('reset returns to the start and allows replaying the same trace', () => {
    const { replayer, seen, state } = harness();
    replayer.play();
    replayer.tick(1);
    replayer.reset();
    expect(replayer.state).toBe('idle');
    expect(replayer.currentIndex).toBe(0);
    replayer.play();
    replayer.tick(1);
    expect(seen).toEqual([
      'start:0', 'visit:1', 'relax:2', 'visit:3', 'finalize:4',
      'start:0', 'visit:1', 'relax:2', 'visit:3', 'finalize:4',
    ]);
    expect(state()).toBe(2);
  });

  it('an empty trace ends immediately on play', () => {
    let done = 0;
    const r = new TraceReplayer([], {
      onEvent: () => undefined,
      onDone: () => {
        done += 1;
      },
    });
    r.play();
    expect(r.state).toBe('done');
    expect(done).toBe(1);
  });

  it('speed is clamped to a sane range', () => {
    const { replayer } = harness();
    replayer.setSpeed(1_000_000);
    expect(replayer.speed).toBe(120);
    replayer.setSpeed(0);
    expect(replayer.speed).toBe(0.5);
  });
});

describe('describeTraceEvent', () => {
  const nameOf = (id: string): string => `Name-${id}`;

  it('maps start to a START description with the source', () => {
    const d = describeTraceEvent({ type: 'start', sourceId: 'gate-main' }, nameOf);
    expect(d.kind).toBe('START');
    expect(d.detail).toBe('Source: Name-gate-main');
    expect(d.sub).toBeUndefined();
  });

  it('maps visit to VISIT with node name and best distance in the given unit', () => {
    const d = describeTraceEvent({ type: 'visit', vertexId: 'pav-germany', bestDistance: 320.4 }, nameOf);
    expect(d.kind).toBe('VISIT');
    expect(d.detail).toBe('Node: Name-pav-germany');
    expect(d.sub).toBe('best distance 320 m');
    // unit is caller-controlled (metres vs hops)
    const dHops = describeTraceEvent({ type: 'visit', vertexId: 'pav-germany', bestDistance: 4 }, nameOf, 'hops');
    expect(dHops.sub).toBe('best distance 4 hops');
  });

  it('maps an improving relax to RELAX with edge and new distance', () => {
    const d = describeTraceEvent(
      { type: 'relax', fromId: 'a', toId: 'b', oldDistance: 10, newDistance: 4, improved: true },
      nameOf,
    );
    expect(d.kind).toBe('RELAX');
    expect(d.detail).toBe('Edge: Name-a → Name-b');
    expect(d.sub).toBe('improved to 4 m');
  });

  it('maps a non-improving relax (oldDistance null) to RELAX with the current best', () => {
    const d = describeTraceEvent(
      { type: 'relax', fromId: 'a', toId: 'b', oldDistance: null, newDistance: 7, improved: false },
      nameOf,
    );
    expect(d.kind).toBe('RELAX');
    expect(d.detail).toBe('Edge: Name-a → Name-b');
    expect(d.sub).toBe('no improvement (best stays 7 m)');
  });

  it('maps finalize to FINALIZE with destination and optimal cost', () => {
    const d = describeTraceEvent({ type: 'finalize', targetId: 'pav-france', totalDistance: 512.9 }, nameOf);
    expect(d.kind).toBe('FINALIZE');
    expect(d.detail).toBe('Destination: Name-pav-france');
    expect(d.sub).toBe('optimal cost 513 m');
  });

  it('maps abort to ABORT with an unreachable message and no sub', () => {
    const d = describeTraceEvent({ type: 'abort', reason: 'unreachable' }, nameOf);
    expect(d.kind).toBe('ABORT');
    expect(d.detail).toBe('Destination unreachable (search exhausted)');
    expect(d.sub).toBeUndefined();
  });

  it('never invents event kinds — the five schema types are exhaustive', () => {
    const kinds = new Set<string>();
    for (const ev of trace) kinds.add(describeTraceEvent(ev, nameOf).kind);
    expect(kinds).toEqual(new Set(['START', 'VISIT', 'RELAX', 'FINALIZE']));
  });
});
