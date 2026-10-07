/**
 * app/narrator.ts
 *
 * Plain-English narration for replay events (Guest mode). Pure function —
 * no DOM, no three.js — so it is unit-testable.
 *
 * Honesty rules:
 *   - every sentence is generated ONLY from the TraceEvent schema +
 *     dataset location names (nothing invented);
 *   - Guest mode never sees developer wording (no "RELAX", "FINALIZE",
 *     "TRACE_EVENT", no event-kind constants);
 *   - Engineer mode gets the technical event kind separately, next to the
 *     same human sentence.
 */

import type { AlgorithmId, TraceEvent } from '../engine/engine';

/** One-line description of what the algorithm is doing (tour/HUD context). */
export const ALGO_PLAIN_DESCRIPTION: Record<AlgorithmId, string> = {
  dijkstra: 'Selecting the closest unexplored location.',
  astar: 'Choosing the location with the lowest estimated total cost.',
  bfs: 'Exploring locations level by level.',
};

/** DFS is a traversal utility, not a routing algorithm — plain wording for docs/tour. */
export const DFS_PLAIN_DESCRIPTION = 'Following this branch before backtracking.';

/** Technical event kind, exactly matching the TraceEvent schema (Engineer mode). */
export function technicalEventKind(ev: TraceEvent): string {
  switch (ev.type) {
    case 'start':
      return 'START';
    case 'visit':
      return 'VISIT';
    case 'relax':
      return 'RELAX';
    case 'finalize':
      return 'FINALIZE';
    case 'abort':
      return 'ABORT';
  }
}

function fmtMeters(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} km`;
}

/**
 * Human-readable caption for one replay event.
 * @param ev     the recorded engine event
 * @param nameOf vertex id → display name (dataset names)
 * @param algo   which algorithm produced the trace (phrasing adapts)
 */
export function narrateEvent(ev: TraceEvent, nameOf: (id: string) => string, algo: AlgorithmId): string {
  switch (ev.type) {
    case 'start':
      return `Starting from ${nameOf(ev.sourceId)}.`;
    case 'visit':
      if (algo === 'bfs') {
        return `Exploring ${nameOf(ev.vertexId)} — ${ev.bestDistance} stop${ev.bestDistance === 1 ? '' : 's'} from the start.`;
      }
      if (algo === 'astar') {
        return `Locking in ${nameOf(ev.vertexId)} — running total ${fmtMeters(ev.bestDistance)}.`;
      }
      return `Confirming the shortest known way to ${nameOf(ev.vertexId)}: ${fmtMeters(ev.bestDistance)}.`;
    case 'relax': {
      const to = nameOf(ev.toId);
      if (ev.oldDistance === null) {
        return `Noted the first route to ${to}.`;
      }
      if (ev.improved) {
        return `Found a shorter path to ${to}.`;
      }
      return `Checking ${nameOf(ev.fromId)} → ${to}: the known route is still better.`;
    }
    case 'finalize':
      if (algo === 'bfs') {
        return `Fewest-stop route found — ${ev.totalDistance} stops.`;
      }
      return `Final route found: ${fmtMeters(ev.totalDistance)}.`;
    case 'abort':
      return 'No route found — the destination cannot be reached from here.';
  }
}
