/**
 * The uniform execution-trace event schema shared by every routing algorithm
 * (Dijkstra in Phase 1; A*, BFS, ... in Phase 2).
 *
 * Because all algorithms emit the same event types, the 3D layer (Phase 4)
 * can animate ANY algorithm with one single playback pipeline: the algorithm
 * runs to completion in microseconds, then the UI replays this log.
 *
 * A trace is an append-only, ordered log; the array index of an event is
 * its step number.
 */
export type TraceEvent =
  /** First event of every run. */
  | { type: 'start'; sourceId: string }
  /**
   * A vertex was popped from the priority queue and finalized: its best
   * distance is now provably optimal (Dijkstra's invariant).
   */
  | { type: 'visit'; vertexId: string; bestDistance: number }
  /**
   * An edge (fromId -> toId) was relaxed:
   *   - newDistance: the candidate cost (bestDistance(fromId) + weight)
   *   - oldDistance: the previous best for toId, null when it had not been
   *     discovered yet
   *   - improved:    whether the candidate was accepted
   */
  | {
      type: 'relax';
      fromId: string;
      toId: string;
      oldDistance: number | null;
      newDistance: number;
      improved: boolean;
    }
  /** Run succeeded: targetId finalized with this optimal cost. Last event of a successful routed run. */
  | { type: 'finalize'; targetId: string; totalDistance: number }
  /** Run ended without reaching the target (it is in a disconnected component). Last event of an unsuccessful routed run. */
  | { type: 'abort'; reason: 'unreachable' };

/**
 * Minimal, dependency-free, append-only event log.
 *
 * Complexity: emit is O(1) amortized; the log uses O(k) space for k events.
 * Recording is always on by design: for campus-scale graphs the overhead is
 * negligible, and it guarantees every RouteResult is fully animatable.
 */
export class TraceRecorder {
  private readonly events: TraceEvent[] = [];

  /** Number of events recorded so far. O(1). */
  get count(): number {
    return this.events.length;
  }

  /** The log in emission order. */
  list(): readonly TraceEvent[] {
    return this.events;
  }

  /** Append one event. O(1) amortized. */
  emit(event: TraceEvent): void {
    this.events.push(event);
  }
}
