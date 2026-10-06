import { aStar } from '../algorithms/a-star';
import { bfs } from '../algorithms/bfs';
import { dijkstra } from '../algorithms/dijkstra';
import { GraphError } from '../graph/graph';
import type { WeightedGraph } from '../graph/graph';
import { reconstructPath } from './path-reconstruct';
import type { RouteResult } from './route-result';
import type { TraceEvent } from '../trace/step-trace';

/**
 * The shared routing entry point used by findRoute() and by the higher-level
 * routing utilities (comparison, alternatives, blocked-path simulation).
 *
 * Every routing algorithm runs to completion, emits the SAME TraceEvent log
 * and exposes the same (parent, nodesExpanded, relaxations, trace) shape, so
 * one `assemble()` step converts any of them into a RouteResult.
 *
 * (This lives in its own module — rather than inside the engine.ts barrel —
 * so the utilities above can import it without import cycles.)
 */

/** Routing algorithms exposed through findRoute.
 * DFS is deliberately NOT here: it is a traversal/validation tool, not a
 * cost-minimizing routing algorithm. */
export type AlgorithmId = 'dijkstra' | 'astar' | 'bfs';

/** Structural shape every routing run exposes (all three algorithms satisfy it). */
interface RouteRun {
  parent: ReadonlyMap<string, string | null>;
  nodesExpanded: number;
  relaxations: number;
  trace: readonly TraceEvent[];
}

/**
 * Route from sourceId to targetId using the requested algorithm.
 *
 * Runs the algorithm synchronously (campus-scale graphs solve in
 * microseconds) and returns a RouteResult carrying the ordered path, the
 * optimal cost, work counters, and the full execution trace for later
 * animation. Unreachable targets yield status 'unreachable' — never a thrown
 * exception.
 *
 * Cost semantics of `totalDistance`:
 *   - 'dijkstra' / 'astar': optimal metres
 *   - 'bfs':                fewest HOPS (BFS ignores edge weights by design)
 *
 * Complexity: O((V + E) log V) for dijkstra/astar; O(V + E) for bfs.
 *
 * @throws GraphError if either id is not a vertex of `graph`.
 */
export function findRoute(
  graph: WeightedGraph,
  sourceId: string,
  targetId: string,
  algorithm: AlgorithmId = 'dijkstra',
): RouteResult {
  // Each algorithm validates both ids and throws GraphError on unknown ones.
  if (algorithm === 'dijkstra') {
    return assemble(graph, sourceId, targetId, dijkstra(graph, sourceId, { targetId }));
  }
  if (algorithm === 'astar') {
    return assemble(graph, sourceId, targetId, aStar(graph, sourceId, { targetId }));
  }
  if (algorithm === 'bfs') {
    const run = bfs(graph, sourceId, { targetId });
    return assemble(graph, sourceId, targetId, {
      parent: run.parent,
      nodesExpanded: run.nodesExpanded,
      relaxations: run.relaxations,
      trace: run.trace,
    });
  }
  throw new GraphError(`unsupported algorithm "${algorithm}"`); // exhaustive: unreachable
}

/** Convert an algorithm run into a RouteResult (identical for all algorithms). */
function assemble(graph: WeightedGraph, sourceId: string, targetId: string, run: RouteRun): RouteResult {
  // dijkstra/aStar/bfs already validated both ids, so these lookups are safe.
  const source = graph.getVertex(sourceId)!;
  const target = graph.getVertex(targetId)!;

  const terminal = run.trace[run.trace.length - 1];
  if (terminal !== undefined && terminal.type === 'finalize') {
    const path = reconstructPath(run.parent, sourceId, targetId);
    if (path === null) {
      // Unreachable in practice: finalize is only emitted for finalized targets.
      throw new GraphError('internal error: target finalized but path reconstruction failed');
    }
    return {
      status: 'ok',
      source,
      target,
      path,
      vertices: path.map((id) => graph.getVertex(id)!),
      totalDistance: terminal.totalDistance,
      nodesExpanded: run.nodesExpanded,
      relaxations: run.relaxations,
      trace: run.trace,
    };
  }

  return {
    status: 'unreachable',
    source,
    target,
    nodesExpanded: run.nodesExpanded,
    relaxations: run.relaxations,
    trace: run.trace,
  };
}
