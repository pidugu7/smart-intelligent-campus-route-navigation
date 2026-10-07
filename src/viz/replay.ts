/**
 * viz/replay.ts
 *
 * TraceReplayer — turns a finished engine run (its TraceEvent log) into a
 * step-by-step, pausable, speed-adjustable playback. The algorithm itself
 * has already run to completion; this class only decides WHEN each recorded
 * event is shown. Pure TypeScript (no three.js, no DOM) so it is unit-testable.
 *
 * Usage:
 *   const replayer = new TraceReplayer(result.trace, {
 *     onEvent: (ev) => routeLayer.applyTraceEvent(ev),
 *     onDone: () => { routeLayer.showRoute(path); },
 *     onProgress: (i, n) => hud.setText(`${i}/${n}`),
 *   });
 *   replayer.setSpeed(14); replayer.play();
 *   // each frame: replayer.tick(dtSeconds)
 */

import type { TraceEvent } from '../engine/engine';

export type ReplayState = 'idle' | 'playing' | 'paused' | 'done';

export interface ReplayCallbacks {
  /** Fired for each event as playback reaches it (index starts at 0). */
  onEvent: (event: TraceEvent, index: number, total: number) => void;
  /** Fired once when the last event has been delivered. */
  onDone: () => void;
  /** Optional progress hook. */
  onProgress?: (index: number, total: number) => void;
}

export interface TraceEventDescription {
  /** Uppercase event kind, exactly matching the TraceEvent schema. */
  kind: 'START' | 'VISIT' | 'RELAX' | 'FINALIZE' | 'ABORT';
  /** Primary human-readable line (node/edge names). */
  detail: string;
  /** Optional secondary line (distance, improvement, cost). */
  sub?: string;
}

/**
 * Human-readable description of one engine TraceEvent, using ONLY the
 * existing event schema (start / visit / relax / finalize / abort).
 * `unit` distinguishes metres (Dijkstra/A*) from hops (BFS).
 */
export function describeTraceEvent(
  ev: TraceEvent,
  nameOf: (id: string) => string,
  unit: string = 'm',
): TraceEventDescription {
  switch (ev.type) {
    case 'start':
      return { kind: 'START', detail: `Source: ${nameOf(ev.sourceId)}` };
    case 'visit':
      return {
        kind: 'VISIT',
        detail: `Node: ${nameOf(ev.vertexId)}`,
        sub: `best distance ${Math.round(ev.bestDistance)} ${unit}`,
      };
    case 'relax':
      return {
        kind: 'RELAX',
        detail: `Edge: ${nameOf(ev.fromId)} → ${nameOf(ev.toId)}`,
        sub: ev.improved
          ? `improved to ${Math.round(ev.newDistance)} ${unit}`
          : `no improvement (best stays ${Math.round(ev.oldDistance ?? ev.newDistance)} ${unit})`,
      };
    case 'finalize':
      return {
        kind: 'FINALIZE',
        detail: `Destination: ${nameOf(ev.targetId)}`,
        sub: `optimal cost ${Math.round(ev.totalDistance)} ${unit}`,
      };
    case 'abort':
      return { kind: 'ABORT', detail: 'Destination unreachable (search exhausted)' };
  }
}

export class TraceReplayer {
  private readonly trace: readonly TraceEvent[];
  private readonly cb: ReplayCallbacks;
  private index = 0;
  private replayState: ReplayState = 'idle';
  private accumulator = 0;
  private eventsPerSecond = 14;
  private doneFired = false;

  constructor(trace: readonly TraceEvent[], callbacks: ReplayCallbacks) {
    this.trace = trace;
    this.cb = callbacks;
  }

  get isPlaying(): boolean {
    return this.replayState === 'playing';
  }

  get state(): ReplayState {
    return this.replayState;
  }

  /** Next event index to be delivered (0-based). */
  get currentIndex(): number {
    return this.index;
  }

  get totalEvents(): number {
    return this.trace.length;
  }

  play(): void {
    if (this.replayState === 'done') return;
    if (this.trace.length === 0) {
      // An empty trace is complete by definition.
      this.replayState = 'done';
      if (!this.doneFired) {
        this.doneFired = true;
        this.cb.onDone();
      }
      return;
    }
    this.replayState = 'playing';
  }

  pause(): void {
    if (this.replayState === 'playing') this.replayState = 'paused';
  }

  /** Back to the start; state becomes 'idle' (call play() to resume). */
  reset(): void {
    this.index = 0;
    this.accumulator = 0;
    this.replayState = 'idle';
    this.doneFired = false;
  }

  /** The recorded event at an absolute index (for scrubbing/re-deriving state). */
  eventAt(index: number): TraceEvent {
    return this.trace[Math.max(0, Math.min(index, this.trace.length - 1))]!;
  }

  /**
   * Jump playback to an absolute event index (timeline scrubbing).
   * No events are re-fired — the consumer re-applies the prefix itself
   * (the scene highlights are cumulative, so the prefix must be re-derived).
   * State becomes 'done' at the end of the trace, otherwise 'paused'.
   */
  seekTo(index: number): void {
    const clamped = Math.max(0, Math.min(index, this.trace.length));
    this.index = clamped;
    this.accumulator = 0;
    this.doneFired = clamped >= this.trace.length && this.trace.length > 0;
    this.replayState = this.doneFired ? 'done' : 'paused';
    if (this.trace.length > 0) this.cb.onProgress?.(clamped, this.trace.length);
  }

  /** Playback speed in events per second. */
  setSpeed(eventsPerSecond: number): void {
    this.eventsPerSecond = Math.max(0.5, Math.min(120, eventsPerSecond));
  }

  get speed(): number {
    return this.eventsPerSecond;
  }

  /** Advance playback by dt seconds. Call once per frame. */
  tick(dt: number): void {
    if (this.replayState !== 'playing' || this.trace.length === 0) return;
    this.accumulator += dt * this.eventsPerSecond;
    while (this.accumulator >= 1 && this.index < this.trace.length) {
      this.accumulator -= 1;
      const event = this.trace[this.index]!;
      this.cb.onEvent(event, this.index, this.trace.length);
      this.cb.onProgress?.(this.index + 1, this.trace.length);
      this.index += 1;
    }
    if (this.index >= this.trace.length && !this.doneFired) {
      this.doneFired = true;
      this.replayState = 'done';
      this.cb.onDone();
    }
  }
}
