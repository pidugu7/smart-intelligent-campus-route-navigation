import { GraphError } from '../graph/graph';
import type { WeightedGraph } from '../graph/graph';
import { TraceRecorder } from '../trace/step-trace';
import type { TraceEvent } from '../trace/step-trace';

export interface BfsOptions {
  /**
   * When set, the search stops the moment this vertex is popped
   * (fewest hops to it are final at that moment).
   */
  targetId?: string;
}

export interface BfsRun {
  /**
   * Fewest-hop distance from the source to each discovered vertex.
   * NOTE: these are HOP COUNTS, not metres — BFS deliberately ignores edge
   * weights (see the cost-model discussion below).
   */
  readonly hopCounts: ReadonlyMap<string, number>;
  /** Predecessor map on the fewest-hop paths (sourceId maps to null). */
  readonly parent: ReadonlyMap<string, string | null>;
  /** Number of vertices popped (expanded). */
  readonly nodesExpanded: number;
  /** Number of edge examinations against not-yet-popped neighbours. */
  readonly relaxations: number;
  /** Full execution trace — same TraceEvent schema as Dijkstra/A*. */
  readonly trace: readonly TraceEvent[];
}

/**
 * Breadth-first search — unweighted, fewest-hop routing, written from
 * scratch (no library queue).
 *
 * Queue implementation: a plain array plus a head pointer. Enqueue is
 * amortized O(1) (push), dequeue is O(1) (advance the pointer) — the
 * classic Array.prototype.shift() is O(n) per dequeue, which would make the
 * whole traversal O(V²). (A standard viva question.)
 *
 * Cost model — and why BFS can disagree with Dijkstra:
 *   BFS treats every edge as costing exactly 1 hop, whatever its weight. It
 *   minimizes the NUMBER OF EDGES walked; Dijkstra minimizes TOTAL METRES.
 *   The two objectives diverge whenever hop count and length disagree: a
 *   single 10 m edge beats a 2 m + 2 m detour for BFS (1 hop vs 2 hops) and
 *   loses it for Dijkstra (10 m vs 4 m) — see the hopsVsDistance fixture.
 *   BFS's answer is always optimal for the hop-count objective: a vertex is
 *   first discovered at its minimum possible depth, because the queue
 *   processes vertices level by level.
 *
 * Complexity: O(V + E) time, O(V) space. Each vertex is enqueued at most
 * once; each directed adjacency is examined at most once.
 *
 * Tracing: same TraceEvent schema as Dijkstra/A*; in `visit.bestDistance`
 * and `relax.*` the distances are hop counts. `visit` depths are
 * non-decreasing (a BFS invariant, asserted in the tests).
 *
 * @throws GraphError if sourceId (or targetId) is not a vertex of `graph`.
 */
export function bfs(graph: WeightedGraph, sourceId: string, options: BfsOptions = {}): BfsRun {
  const { targetId } = options;
  if (!graph.hasVertex(sourceId)) {
    throw new GraphError(`source vertex "${sourceId}" does not exist in the graph`);
  }
  if (targetId !== undefined && !graph.hasVertex(targetId)) {
    throw new GraphError(`target vertex "${targetId}" does not exist in the graph`);
  }

  const recorder = new TraceRecorder();
  const hopCounts = new Map<string, number>([[sourceId, 0]]);
  const parent = new Map<string, string | null>([[sourceId, null]]);
  const popped = new Set<string>();

  // Explicit queue: array + head pointer (amortized O(1) dequeue).
  const queue: string[] = [sourceId];
  let head = 0;

  recorder.emit({ type: 'start', sourceId });

  let nodesExpanded = 0;
  let relaxations = 0;

  while (head < queue.length) {
    const id = queue[head];
    head += 1;
    if (id === undefined) {
      break; // defensive: cannot happen while head < queue.length
    }

    popped.add(id);
    nodesExpanded += 1;
    const depth = hopCounts.get(id)!; // enqueued vertices always have a depth
    recorder.emit({ type: 'visit', vertexId: id, bestDistance: depth });

    if (id === targetId) {
      break; // early exit: fewest hops to the target are final
    }

    for (const { to } of graph.neighborsOf(id)) {
      if (popped.has(to)) {
        continue; // already processed at a no-worse depth
      }
      relaxations += 1;
      const oldDistance = hopCounts.get(to) ?? null;
      const newDistance = depth + 1;
      // BFS property: a neighbour is either undiscovered (improve) or was
      // already discovered at this depth or better (never an improvement).
      const improved = oldDistance === null;
      if (improved) {
        hopCounts.set(to, newDistance);
        parent.set(to, id);
        queue.push(to);
      }
      recorder.emit({ type: 'relax', fromId: id, toId: to, oldDistance, newDistance, improved });
    }
  }

  if (targetId !== undefined) {
    const finalDepth = hopCounts.get(targetId);
    if (popped.has(targetId) && finalDepth !== undefined) {
      recorder.emit({ type: 'finalize', targetId, totalDistance: finalDepth });
    } else {
      recorder.emit({ type: 'abort', reason: 'unreachable' });
    }
  }

  return { hopCounts, parent, nodesExpanded, relaxations, trace: recorder.list() };
}
