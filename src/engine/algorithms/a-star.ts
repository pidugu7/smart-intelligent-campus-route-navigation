import { GraphError } from '../graph/graph';
import type { WeightedGraph } from '../graph/graph';
import { MinHeap } from '../priority-queue/min-heap';
import type { Comparator } from '../priority-queue/min-heap';
import { TraceRecorder } from '../trace/step-trace';
import type { TraceEvent } from '../trace/step-trace';
import { euclideanHeuristic, type Heuristic } from './heuristic';

/** Priority-queue entry for A*: f(n) = g(n) + h(n), plus g for the trace. */
export interface AStarHeapEntry {
  /** f(n) = g(n) + h(n) — the priority. */
  f: number;
  /** g(n) — actual cost from the source. */
  g: number;
  id: string;
}

/**
 * Orders heap entries by f, then by vertex id. Same (priority, id)
 * discipline as Dijkstra, which keeps every A* trace fully deterministic.
 */
export const aStarComparator: Comparator<AStarHeapEntry> = (a, b) => {
  if (a.f !== b.f) {
    return a.f - b.f;
  }
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
};

export interface AStarOptions {
  /** Goal vertex. A* is goal-directed, so a target is required. */
  targetId: string;
  /** h(n). Defaults to the Euclidean distance to the target (see heuristic.ts). */
  heuristic?: Heuristic;
}

export interface AStarRun {
  /**
   * g-values: best known ACTUAL cost from the source to each discovered
   * vertex (not f). Values for finalized vertices are optimal. With early
   * exit this map is only partially complete — expected, documented
   * behaviour.
   */
  readonly distances: ReadonlyMap<string, number>;
  /** Predecessor map feeding path reconstruction (sourceId maps to null). */
  readonly parent: ReadonlyMap<string, string | null>;
  /** Number of vertices popped and finalized. */
  readonly nodesExpanded: number;
  /** Number of edge relaxations attempted (improving or not). */
  readonly relaxations: number;
  /** Full execution trace — same TraceEvent schema as Dijkstra. */
  readonly trace: readonly TraceEvent[];
}

/**
 * A* search — Dijkstra with an informed heuristic.
 *
 * Method:
 *   f(n) = g(n) + h(n). g(n) is the actual cost from the source (grown
 *   exactly as in Dijkstra); h(n) estimates the remaining cost to the
 *   target. The min-heap orders candidates by f instead of by g, which
 *   steers the search toward the target.
 *
 * Why the Euclidean heuristic is safe here (the full argument):
 *   - ADMISSIBLE: our edge-weight model is length × factor with factor >= 1,
 *     so h (straight-line distance) never overestimates the true remaining
 *     cost.
 *   - CONSISTENT: h(u) <= w(u,v) + h(v) by the triangle inequality plus
 *     w(u,v) >= |u-v|. Hence a vertex's g-value is final the moment it is
 *     popped — no re-opening, no second visit.
 *   With an admissible + consistent h, A* returns the same optimal cost as
 *   Dijkstra; with h = 0 it degenerates to plain Dijkstra (same
 *   expansions, same trace — see the test suite).
 *
 * A* is NOT unconditionally faster than Dijkstra. With a weak or zero
 * heuristic it expands the same number of vertices, and it pays a small
 * constant overhead for the h() work. Its advantage grows with how close h
 * is to the true remaining cost on the specific graph — the comparison
 * utilities (routing/compare.ts) measure this per query.
 *
 * Complexity:
 *   Time  O((V + E) log V) worst case (identical to Dijkstra); typically far
 *         fewer expansions when h is informative.
 *   Space O(V + E).
 *
 * Tracing & determinism:
 *   Same TraceEvent schema as Dijkstra — `visit.bestDistance` and the
 *   `relax.*` distances are g-values (actual cost), and the (f, id)
 *   comparator makes the expansion order, and hence the whole trace,
 *   reproducible.
 *
 * @throws GraphError if sourceId or targetId is not a vertex of `graph`.
 */
export function aStar(graph: WeightedGraph, sourceId: string, options: AStarOptions): AStarRun {
  const { targetId } = options;
  if (!graph.hasVertex(sourceId)) {
    throw new GraphError(`source vertex "${sourceId}" does not exist in the graph`);
  }
  if (!graph.hasVertex(targetId)) {
    throw new GraphError(`target vertex "${targetId}" does not exist in the graph`);
  }

  const targetVertex = graph.getVertex(targetId)!;
  const heuristic = options.heuristic ?? euclideanHeuristic(targetVertex);
  const sourceVertex = graph.getVertex(sourceId)!;

  const recorder = new TraceRecorder();
  const distances = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const finalized = new Set<string>();
  const heap = new MinHeap<AStarHeapEntry>(aStarComparator);

  const hSource = heuristic(sourceVertex, targetVertex);
  distances.set(sourceId, 0);
  parent.set(sourceId, null);
  heap.push({ f: hSource, g: 0, id: sourceId });
  recorder.emit({ type: 'start', sourceId });

  let nodesExpanded = 0;
  let relaxations = 0;

  for (;;) {
    const entry = heap.pop();
    if (entry === undefined) {
      break; // no more reachable vertices
    }

    const id = entry.id;
    if (finalized.has(id)) {
      // Lazy deletion: stale entry (vertex already finalized with a better g).
      continue;
    }

    finalized.add(id);
    nodesExpanded += 1;
    // Every heap entry was pushed together with a g-value, so this is safe.
    const g = distances.get(id)!;
    recorder.emit({ type: 'visit', vertexId: id, bestDistance: g });

    if (id === targetId) {
      break; // early exit: g is provably optimal (consistent heuristic)
    }

    for (const { to, weight } of graph.neighborsOf(id)) {
      if (finalized.has(to)) {
        continue; // a finalized vertex can never improve
      }
      relaxations += 1;
      const oldDistance = distances.get(to) ?? null;
      const newDistance = g + weight;
      const improved = oldDistance === null || newDistance < oldDistance;
      if (improved) {
        distances.set(to, newDistance);
        parent.set(to, id);
        const newF = newDistance + heuristic(graph.getVertex(to)!, targetVertex);
        heap.push({ f: newF, g: newDistance, id: to });
      }
      recorder.emit({ type: 'relax', fromId: id, toId: to, oldDistance, newDistance, improved });
    }
  }

  const finalDistance = distances.get(targetId);
  if (finalized.has(targetId) && finalDistance !== undefined) {
    recorder.emit({ type: 'finalize', targetId, totalDistance: finalDistance });
  } else {
    recorder.emit({ type: 'abort', reason: 'unreachable' });
  }

  return { distances, parent, nodesExpanded, relaxations, trace: recorder.list() };
}
