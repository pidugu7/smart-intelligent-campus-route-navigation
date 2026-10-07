/**
 * Unit tests for timeline scrubbing support in TraceReplayer
 * (viz/replay.ts): eventAt + seekTo.
 *
 * Guarantees:
 *   - seeking never re-fires onEvent (the UI re-derives the prefix itself);
 *   - seeking pauses (or completes) deterministically;
 *   - playback resumes from the seek position;
 *   - onDone fires exactly once, whether by playback or by seeking to the end.
 */

import { describe, expect, it } from 'vitest';
import type { TraceEvent } from '../../src/engine/engine';
import { TraceReplayer } from '../../src/viz/replay';

/** A small fixed trace (8 events) with a recognisable pattern. */
function makeTrace(): TraceEvent[] {
  const trace: TraceEvent[] = [
    { type: 'start', sourceId: 'a' },
    { type: 'visit', vertexId: 'a', bestDistance: 0 },
    { type: 'visit', vertexId: 'b', bestDistance: 10 },
    {
      type: 'relax',
      fromId: 'b',
      toId: 'c',
      oldDistance: null,
      newDistance: 25,
      improved: true,
    },
    { type: 'visit', vertexId: 'c', bestDistance: 25 },
    { type: 'visit', vertexId: 'd', bestDistance: 30 },
    { type: 'finalize', targetId: 'd', totalDistance: 30 },
  ];
  return trace;
}

function makeReplayer(trace: readonly TraceEvent[]) {
  const fired: Array<{ index: number; event: TraceEvent }> = [];
  let progressCalls: Array<[number, number]> = [];
  let doneCount = 0;
  const replayer = new TraceReplayer(trace, {
    onEvent: (event, index) => fired.push({ index, event }),
    onDone: () => {
      doneCount += 1;
    },
    onProgress: (i, n) => progressCalls.push([i, n]),
  });
  return { replayer, get fired() { return fired; }, get progressCalls() { return progressCalls; }, get doneCount() { return doneCount; } };
}

describe('eventAt', () => {
  it('returns the recorded event at an absolute index', () => {
    const trace = makeTrace();
    const r = makeReplayer(trace);
    expect(r.replayer.eventAt(0)).toEqual({ type: 'start', sourceId: 'a' });
    expect(r.replayer.eventAt(6)).toEqual({ type: 'finalize', targetId: 'd', totalDistance: 30 });
  });

  it('clamps to the valid range', () => {
    const trace = makeTrace();
    const r = makeReplayer(trace);
    expect(r.replayer.eventAt(-5)).toEqual(trace[0]);
    expect(r.replayer.eventAt(999)).toEqual(trace[trace.length - 1]);
  });
});

describe('seekTo', () => {
  it('moves to the requested index and pauses', () => {
    const trace = makeTrace();
    const r = makeReplayer(trace);
    r.replayer.seekTo(3);
    expect(r.replayer.currentIndex).toBe(3);
    expect(r.replayer.state).toBe('paused');
    expect(r.replayer.isPlaying).toBe(false);
    expect(r.fired).toHaveLength(0); // nothing re-fired
    expect(r.progressCalls).toEqual([[3, trace.length]]);
  });

  it('does not fire events for the skipped prefix', () => {
    const trace = makeTrace();
    const r = makeReplayer(trace);
    r.replayer.play();
    r.replayer.tick(1000); // play through everything
    const fullCount = r.fired.length;
    expect(fullCount).toBe(trace.length);
    // Fresh replayer: seek far in, then to the middle.
    const r2 = makeReplayer(trace);
    r2.replayer.seekTo(6);
    expect(r2.fired).toHaveLength(0);
    r2.replayer.seekTo(2);
    expect(r2.fired).toHaveLength(0);
    expect(r2.replayer.currentIndex).toBe(2);
    void fullCount;
  });

  it('seeking to the end completes the replay', () => {
    const trace = makeTrace();
    const r = makeReplayer(trace);
    r.replayer.seekTo(trace.length);
    expect(r.replayer.state).toBe('done');
    expect(r.doneCount).toBe(0); // onDone is not re-fired on a pure seek
    expect(r.replayer.currentIndex).toBe(trace.length);
  });

  it('onDone fires exactly once, by playback after a seek', () => {
    const trace = makeTrace();
    const r = makeReplayer(trace);
    r.replayer.seekTo(4);
    r.replayer.play(); // resume from index 4
    r.replayer.tick(1000);
    expect(r.fired.map((f) => f.index)).toEqual([4, 5, 6]); // only the tail
    expect(r.doneCount).toBe(1);
    expect(r.replayer.state).toBe('done');
  });

  it('seeking back rewinds and allows replay from the new position', () => {
    const trace = makeTrace();
    const r = makeReplayer(trace);
    r.replayer.play();
    r.replayer.tick(1000); // done: indices 0..6 fired
    const beforeSeek = r.fired.length;
    expect(beforeSeek).toBe(trace.length);
    r.replayer.seekTo(2);
    expect(r.replayer.state).toBe('paused');
    r.replayer.play();
    r.replayer.tick(1000);
    // only the tail (2..6) fires after the seek
    expect(r.fired.map((f) => f.index).slice(beforeSeek)).toEqual([2, 3, 4, 5, 6]);
    // one completion per full play-through: the initial run + the resumed tail
    expect(r.doneCount).toBe(2);
  });

  it('clamps out-of-range seeks', () => {
    const trace = makeTrace();
    const r = makeReplayer(trace);
    r.replayer.seekTo(-10);
    expect(r.replayer.currentIndex).toBe(0);
    expect(r.replayer.state).toBe('paused');
    r.replayer.seekTo(10 ** 6);
    expect(r.replayer.currentIndex).toBe(trace.length);
    expect(r.replayer.state).toBe('done');
  });

  it('seeking on an empty trace is a no-op that stays complete', () => {
    const r = makeReplayer([]);
    r.replayer.seekTo(0);
    expect(r.replayer.state).toBe('paused'); // empty: nothing to play, no crash
    expect(r.fired).toHaveLength(0);
  });
});

describe('determinism across seek sequences', () => {
  it('the same seek script always lands in the same state', () => {
    const script = [3, 3, 0, 6, 2, 5, 7];
    const run = (): number[] => {
      const r = makeReplayer(makeTrace());
      const seen: number[] = [];
      for (const i of script) {
        r.replayer.seekTo(i);
        seen.push(r.replayer.currentIndex);
      }
      return seen;
    };
    expect(run()).toEqual(run());
    expect(run()).toEqual([3, 3, 0, 6, 2, 5, 7]);
  });
});
