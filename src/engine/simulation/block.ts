import { canonicalEdgeIds } from '../graph/graph';
import { GraphError } from '../graph/graph';
import type { WeightedGraph } from '../graph/graph';
import { findRoute, type AlgorithmId } from '../routing/find-route';
import type { RouteResult } from '../routing/route-result';

/** One edge to simulate as blocked (direction does not matter — the graph is undirected). */
export interface BlockSpec {
  from: string;
  to: string;
}

export interface BlockedRouteResult {
  /** The blocked edges, canonicalized (from < to), in given order, duplicates removed. */
  blockedEdges: Array<{ from: string; to: string }>;
  /** Route on the ORIGINAL graph (which remains unmodified by this call). */
  before: RouteResult;
  /** Route on a cloned "view" of the graph with the blocked edges removed. */
  after: RouteResult;
  /** Cost difference, or null when either route is unreachable. */
  delta:
    | { beforeDistance: number; afterDistance: number; distanceDelta: number }
    | null;
}

/**
 * Blocked-path simulation ("this walkway is under construction — re-route me").
 *
 * How it works — and why the original graph is never touched:
 *   1. Validate that every block references an existing edge (fail fast,
 *      with the exact edge named).
 *   2. Route on the original graph → `before`.
 *   3. Clone the graph (O(V + E)) and remove the blocked edges from the
 *      CLONE only → `view`.
 *   4. Route on the view → `after`.
 *   5. Report before/after plus the delta (null when either side is
 *      unreachable — a blocked route may genuinely not exist).
 *
 * The clone-then-mutate pattern keeps the source of truth intact no matter
 * how many simulations run; Phase 4 drives this from the UI's click-to-block
 * interaction.
 *
 * Complexity: O(V + E) clone + two routing runs (O(2 · (V + E) log V) for
 * Dijkstra/A*).
 *
 * @throws GraphError on self-loop blocks, unknown vertices, or blocks that
 *          reference an edge that does not exist.
 */
export function simulateBlockedRoute(
  graph: WeightedGraph,
  sourceId: string,
  targetId: string,
  blocks: readonly BlockSpec[],
  algorithm: AlgorithmId = 'dijkstra',
): BlockedRouteResult {
  if (blocks.length === 0) {
    throw new GraphError('at least one blocked edge is required');
  }

  const normalized = new Map<string, { from: string; to: string }>();
  for (const block of blocks) {
    if (block.from === block.to) {
      throw new GraphError(`self-loop block on "${block.from}" is not supported`);
    }
    if (!graph.hasVertex(block.from) || !graph.hasVertex(block.to)) {
      throw new GraphError(`block references unknown vertex "${block.from}" or "${block.to}"`);
    }
    const edgeExists = graph.neighborsOf(block.from).some((e) => e.to === block.to);
    if (!edgeExists) {
      throw new GraphError(`edge "${block.from}"<->"${block.to}" does not exist in the graph`);
    }
    const canonical = canonicalEdgeIds(block.from, block.to);
    if (!normalized.has(`${canonical.from}\u0000${canonical.to}`)) {
      normalized.set(`${canonical.from}\u0000${canonical.to}`, canonical);
    }
  }

  const before = findRoute(graph, sourceId, targetId, algorithm);

  const view = graph.clone();
  for (const { from, to } of normalized.values()) {
    view.removeEdge(from, to);
  }
  const after = findRoute(view, sourceId, targetId, algorithm);

  const delta =
    before.status === 'ok' && after.status === 'ok'
      ? {
          beforeDistance: before.totalDistance,
          afterDistance: after.totalDistance,
          distanceDelta: after.totalDistance - before.totalDistance,
        }
      : null;

  return { blockedEdges: [...normalized.values()], before, after, delta };
}
