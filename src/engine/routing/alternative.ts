import { canonicalEdgeIds } from '../graph/graph';
import type { WeightedGraph } from '../graph/graph';
import { findRoute, type AlgorithmId } from './find-route';

/**
 * Alternative ("second") route calculation — a simple, deterministic strategy.
 *
 * Algorithm:
 *   1. Compute the primary (optimal) path P.
 *   2. For each edge e of P, in walking order: clone the graph, remove e,
 *      re-run the router. If the result is a valid route whose id sequence
 *      differs from P, keep it as a candidate.
 *   3. Return the candidate with the smallest cost; ties keep the candidate
 *      from the EARLIEST edge of P (strict `<` in walking order), so the
 *      result is fully deterministic.
 *
 * Guarantee (stated precisely, viva-relevant):
 *   The returned cost is the best possible cost among ALL SIMPLE PATHS
 *   distinct from P — the true "second-best simple-path cost". Proof sketch:
 *   any competing simple path Q ≠ P must avoid at least one edge e of P, and
 *   the router on G \ {e} returns exactly cost(Q) or better, and never P
 *   itself. (Any simple path that contained every edge of P would be P with
 *   a detour loop, contradicting simplicity.)
 *   What this is NOT: a general k-shortest algorithm (not Yen's algorithm),
 *   and it only considers simple paths — which is what a walking route
 *   should be anyway. Do not advertise it as "all k alternatives".
 *
 * Complexity: |P| graph clones (O(V + E) each) plus |P| routing runs
 * (O((V + E) log V) each for Dijkstra): O(|P| · (V + E) log V) time and
 * O(V + E) extra space. Trivial at campus scale (|P| is a handful, V ~ 10²).
 *
 * The original graph is never mutated (clones only).
 *
 * @throws GraphError if either id is not a vertex of `graph`.
 */
export function findAlternativeRoute(
  graph: WeightedGraph,
  sourceId: string,
  targetId: string,
  algorithm: AlgorithmId = 'dijkstra',
): AlternativeRouteResult {
  const primaryResult = findRoute(graph, sourceId, targetId, algorithm);
  if (primaryResult.status !== 'ok') {
    return {
      status: 'no-primary-route',
      sourceId,
      targetId,
      primary: null,
      alternative: null,
      extraDistance: null,
    };
  }

  const primaryPath = primaryResult.path;
  let best:
    | { path: string[]; totalDistance: number; avoidsEdge: { from: string; to: string } }
    | null = null;

  for (let i = 0; i + 1 < primaryPath.length; i += 1) {
    const u = primaryPath[i]!;
    const v = primaryPath[i + 1]!;
    const view = graph.clone();
    view.removeEdge(u, v);
    const candidate = findRoute(view, sourceId, targetId, algorithm);
    if (candidate.status !== 'ok') {
      continue; // blocking this edge disconnects the target
    }
    if (samePath(candidate.path, primaryPath)) {
      continue; // the router found the same walk (should not happen — e was on P — but be safe)
    }
    if (best === null || candidate.totalDistance < best.totalDistance) {
      best = {
        path: candidate.path,
        totalDistance: candidate.totalDistance,
        avoidsEdge: canonicalEdgeIds(u, v),
      };
    }
    // Equal-cost candidates keep the earliest edge (strict < above).
  }

  const primary = { path: primaryPath, totalDistance: primaryResult.totalDistance };
  if (best === null) {
    return { status: 'ok', sourceId, targetId, primary, alternative: null, extraDistance: null };
  }
  return {
    status: 'ok',
    sourceId,
    targetId,
    primary,
    alternative: {
      path: best.path,
      totalDistance: best.totalDistance,
      avoidsEdge: best.avoidsEdge,
    },
    extraDistance: best.totalDistance - primaryResult.totalDistance,
  };
}

export interface AlternativeRouteResult {
  status: 'ok' | 'no-primary-route';
  sourceId: string;
  targetId: string;
  /** The optimal route (null when no route exists at all). */
  primary: { path: string[]; totalDistance: number } | null;
  /**
   * A distinct route found by blocking one edge of the primary, or null when
   * no distinct route exists (e.g. the primary is the only route).
   */
  alternative:
    | { path: string[]; totalDistance: number; avoidsEdge: { from: string; to: string } }
    | null;
  /** alternative.totalDistance - primary.totalDistance, or null. */
  extraDistance: number | null;
}

function samePath(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
