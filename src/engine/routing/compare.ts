import { aStar } from '../algorithms/a-star';
import type { AStarOptions, AStarRun } from '../algorithms/a-star';
import { dijkstra } from '../algorithms/dijkstra';
import type { DijkstraRun } from '../algorithms/dijkstra';
import type { WeightedGraph } from '../graph/graph';
import type { Heuristic } from '../algorithms/heuristic';
import { reconstructPath } from './path-reconstruct';
import type { TraceEvent } from '../trace/step-trace';

/**
 * Dijkstra vs A* side-by-side — the data behind the comparison panel (Phase 4).
 *
 * What this module is (and is NOT):
 *   - It VERIFYs that A* returns the same optimal cost as Dijkstra whenever
 *     the heuristic's assumptions hold (admissible + consistent — true for
 *     the Euclidean heuristic under this project's weight model).
 *   - It does NOT claim A* is always faster. `nodesExpandedDelta` is
 *     reported as a plain number that can be zero (weak heuristic, e.g. a
 *     uniform grid where every node is on the "way") or even negative in
 *     pathological cases: A*'s advantage depends on how informative h is for
 *     the specific graph, plus a small constant overhead for h() work.
 */

/** One algorithm's summarized answer for a single query. */
export interface AlgorithmSummary {
  algorithm: 'dijkstra' | 'astar';
  status: 'ok' | 'unreachable';
  /** Optimal cost in metres (both algorithms share the same cost model here), or null when unreachable. */
  totalDistance: number | null;
  /** Ordered vertex ids (empty when unreachable). */
  path: string[];
  /** Vertices popped/finalized — the efficiency metric. */
  nodesExpanded: number;
  /** Total events in the execution trace. */
  traceSteps: number;
}

export interface AlgorithmComparison {
  sourceId: string;
  targetId: string;
  dijkstra: AlgorithmSummary;
  astar: AlgorithmSummary;
  /** True when both agree: both ok with equal cost, or both unreachable. */
  sameOptimalCost: boolean;
  /** dijkstra.nodesExpanded - astar.nodesExpanded.
   * May be 0 or negative: A* is NOT unconditionally faster (see module docs). */
  nodesExpandedDelta: number;
}

export interface CompareOptions {
  /** Heuristic used for the A* leg. Defaults to Euclidean (see heuristic.ts). */
  heuristic?: Heuristic;
}

/**
 * Run Dijkstra and A* on the SAME graph for the same query and summarize
 * both. Deterministic: same input → same comparison.
 *
 * Complexity: two full routing runs, O(2 · (V + E) log V) time.
 *
 * @throws GraphError if sourceId or targetId is not a vertex of `graph`.
 */
export function compareAlgorithms(
  graph: WeightedGraph,
  sourceId: string,
  targetId: string,
  options: CompareOptions = {},
): AlgorithmComparison {
  const djRun = dijkstra(graph, sourceId, { targetId });
  const astarOptions: AStarOptions = { targetId };
  if (options.heuristic !== undefined) {
    astarOptions.heuristic = options.heuristic;
  }
  const asRun = aStar(graph, sourceId, astarOptions);

  const dijkstraSummary = summarize('dijkstra', djRun, sourceId, targetId);
  const astarSummary = summarize('astar', asRun, sourceId, targetId);

  const sameOptimalCost =
    dijkstraSummary.status === 'unreachable' && astarSummary.status === 'unreachable'
      ? true
      : dijkstraSummary.status === 'ok' &&
        astarSummary.status === 'ok' &&
        dijkstraSummary.totalDistance === astarSummary.totalDistance;

  return {
    sourceId,
    targetId,
    dijkstra: dijkstraSummary,
    astar: astarSummary,
    sameOptimalCost,
    nodesExpandedDelta: dijkstraSummary.nodesExpanded - astarSummary.nodesExpanded,
  };
}

/** Run shape shared by Dijkstra and A* (both emit identical traces). */
interface ComparableRun {
  distances: ReadonlyMap<string, number>;
  parent: ReadonlyMap<string, string | null>;
  nodesExpanded: number;
  trace: readonly TraceEvent[];
}

function summarize(
  algorithm: 'dijkstra' | 'astar',
  run: DijkstraRun | AStarRun,
  sourceId: string,
  targetId: string,
): AlgorithmSummary {
  const r = run as ComparableRun;
  const terminal = r.trace[r.trace.length - 1];
  const ok = terminal !== undefined && terminal.type === 'finalize';
  const path = ok ? (reconstructPath(r.parent, sourceId, targetId) ?? []) : [];
  return {
    algorithm,
    status: ok ? 'ok' : 'unreachable',
    totalDistance: ok ? (r.distances.get(targetId) ?? null) : null,
    path,
    nodesExpanded: r.nodesExpanded,
    traceSteps: r.trace.length,
  };
}
