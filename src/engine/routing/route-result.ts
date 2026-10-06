import type { Vertex } from '../graph/vertex';
import type { TraceEvent } from '../trace/step-trace';

/**
 * Work counters for one algorithm run.
 *
 * `nodesExpanded` is the classic efficiency metric that makes the
 * Dijkstra-vs-A* comparison panel (Phase 2/4) meaningful: A* should expand
 * strictly fewer vertices than Dijkstra on the same start/destination pair.
 */
export interface RouteStats {
  /** Vertices popped from the priority queue and finalized. */
  nodesExpanded: number;
  /** Edge relaxations attempted (improving or not). */
  relaxations: number;
}

/**
 * The engine's answer to "route me from A to B".
 *
 * A discriminated union so callers handle failure explicitly:
 *   - status 'ok'          -> path / vertices / totalDistance are present
 *   - status 'unreachable' -> no route exists; the trace ends in 'abort'
 *
 * The full execution trace is always included so the UI can replay exactly
 * what the algorithm did, in the order it did it.
 */
export type RouteResult =
  | (RouteStats & {
      status: 'ok';
      source: Vertex;
      target: Vertex;
      /** Vertex ids in walking order, source first, target last. */
      path: string[];
      /** Same ordering as `path`, resolved to full vertex objects. */
      vertices: Vertex[];
      /**
       * Optimal cost in the selected algorithm's cost model:
       * metres for 'dijkstra' and 'astar'; fewest HOPS for 'bfs'.
       */
      totalDistance: number;
      trace: readonly TraceEvent[];
    })
  | (RouteStats & {
      status: 'unreachable';
      source: Vertex;
      target: Vertex;
      trace: readonly TraceEvent[];
    });
