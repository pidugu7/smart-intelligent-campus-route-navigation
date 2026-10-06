import { GraphError } from '../graph/graph';
import type { WeightedGraph } from '../graph/graph';
import { MinHeap } from '../priority-queue/min-heap';
import type { Comparator } from '../priority-queue/min-heap';
import { TraceRecorder } from '../trace/step-trace';
import type { TraceEvent } from '../trace/step-trace';

/** Priority-queue entry: (distance, vertexId). */
export interface DijkstraHeapEntry {
  /** Current best known distance from the source. */
  key: number;
  /** Vertex the distance belongs to. */
  id: string;
}

/**
 * Orders heap entries by distance, then by vertex id.
 *
 * The id tie-break makes the expansion order — and therefore the entire
 * trace — fully deterministic: two runs over the same graph produce
 * byte-identical traces, which the demo replay and the unit tests rely on.
 */
export const dijkstraComparator: Comparator<DijkstraHeapEntry> = (a, b) => {
  if (a.key !== b.key) {
    return a.key - b.key;
  }
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
};

export interface DijkstraOptions {
  /**
   * When set, the search stops the moment this vertex is finalized
   * ("early exit"). A single-source run to a nearby target then expands
   * strictly fewer vertices than a full run — visible in the trace and in
   * `nodesExpanded`.
   */
  targetId?: string;
}

export interface DijkstraRun {
  /**
   * Best known distance from the source to each discovered vertex. Values
   * for finalized vertices are optimal. If an early exit was requested this
   * map is only partially complete — expected, documented behaviour.
   */
  readonly distances: ReadonlyMap<string, number>;
  /** Predecessor map feeding path reconstruction (sourceId maps to null). */
  readonly parent: ReadonlyMap<string, string | null>;
  /** Number of vertices popped and finalized. */
  readonly nodesExpanded: number;
  /** Number of edge relaxations attempted (improving or not). */
  readonly relaxations: number;
  /** Full execution trace (see trace/step-trace.ts). */
  readonly trace: readonly TraceEvent[];
}

/**
 * Dijkstra's algorithm — single-source shortest paths on a weighted graph
 * with non-negative edge weights.
 *
 * Method (greedy expansion):
 *   Keep a min-heap of (distance, vertexId) candidates. Repeatedly pop the
 *   smallest candidate; that vertex's distance is now FINAL — the exchange
 *   argument: any alternative path to it would have to pass through a
 *   not-yet-finalized vertex whose distance is already >= this one (weights
 *   are non-negative). Then "relax" every outgoing edge: if reaching the
 *   neighbour through this vertex is cheaper, update the neighbour's
 *   distance and predecessor.
 *
 * Lazy deletion (instead of decrease-key):
 *   When a vertex's distance improves we push a NEW heap entry rather than
 *   reordering the old one. Stale entries are recognized on pop via the
 *   `finalized` set and skipped in O(1). Simpler to implement and to prove
 *   correct; the cost is at most one extra entry per accepted relaxation,
 *   so the heap stays O(V + E) in space.
 *
 * Complexity (V = vertices, E = undirected edges, stored both directions):
 *   Time  O((V + E) log V)
 *         - at most V finalized pops, each O(log(V + E))
 *         - each directed adjacency relaxed at most once
 *         - each accepted relaxation adds one O(log(V + E)) push, of which
 *           there are at most 2E
 *   Space O(V + E)
 *
 * Tracing:
 *   Every meaningful step (start / visit / relax / finalize / abort) is
 *   emitted to a TraceRecorder so the 3D layer can animate the exact work.
 *
 * Precondition: all weights > 0 (enforced by WeightedGraph). Negative
 * weights would break the finality argument — Bellman-Ford would be needed
 * instead, which walking networks never require.
 *
 * @throws GraphError if sourceId (or targetId) is not a vertex of `graph`.
 */
export function dijkstra(graph: WeightedGraph, sourceId: string, options: DijkstraOptions = {}): DijkstraRun {
  const { targetId } = options;
  if (!graph.hasVertex(sourceId)) {
    throw new GraphError(`source vertex "${sourceId}" does not exist in the graph`);
  }
  if (targetId !== undefined && !graph.hasVertex(targetId)) {
    throw new GraphError(`target vertex "${targetId}" does not exist in the graph`);
  }

  const recorder = new TraceRecorder();
  const distances = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const finalized = new Set<string>();
  const heap = new MinHeap<DijkstraHeapEntry>(dijkstraComparator);

  distances.set(sourceId, 0);
  parent.set(sourceId, null);
  heap.push({ key: 0, id: sourceId });
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
      // Lazy deletion: stale entry (vertex already finalized with a better
      // distance). Skipping it is O(1).
      continue;
    }

    finalized.add(id);
    nodesExpanded += 1;
    // Every heap entry was pushed together with a distance, so this is safe.
    const bestDistance = distances.get(id)!;
    recorder.emit({ type: 'visit', vertexId: id, bestDistance });

    if (id === targetId) {
      break; // early exit: this distance is now provably optimal
    }

    for (const { to, weight } of graph.neighborsOf(id)) {
      if (finalized.has(to)) {
        continue; // a finalized vertex can never improve
      }
      relaxations += 1;
      const oldDistance = distances.get(to) ?? null;
      const newDistance = bestDistance + weight;
      const improved = oldDistance === null || newDistance < oldDistance;
      if (improved) {
        distances.set(to, newDistance);
        parent.set(to, id);
        heap.push({ key: newDistance, id: to });
      }
      recorder.emit({ type: 'relax', fromId: id, toId: to, oldDistance, newDistance, improved });
    }
  }

  if (targetId !== undefined) {
    const finalDistance = distances.get(targetId);
    if (finalized.has(targetId) && finalDistance !== undefined) {
      recorder.emit({ type: 'finalize', targetId, totalDistance: finalDistance });
    } else {
      recorder.emit({ type: 'abort', reason: 'unreachable' });
    }
  }

  return { distances, parent, nodesExpanded, relaxations, trace: recorder.list() };
}
