import { GraphError } from '../graph/graph';
import type { WeightedGraph } from '../graph/graph';
import { canonicalEdgeIds } from '../graph/graph';

/**
 * Depth-first search — written from scratch, ITERATIVE (explicit stack).
 *
 * Why DFS exists in this project:
 *   DFS is not a routing algorithm (it has no cost objective, which is why
 *   it is not part of findRoute). It is the project's graph-validation tool:
 *   reachability / orphan detection ("which places can I not reach from the
 *   main gate?") and cycle detection ("is this walk network sane?"). Both
 *   run automatically when a dataset is loaded (Phase 3) and are unit-tested
 *   here.
 *
 * Why iterative rather than recursive:
 *   Recursion depth would grow with the graph and could blow the call stack
 *   on large datasets; the explicit stack keeps worst-case memory at O(V)
 *   heap space with identical traversal semantics.
 *
 * Complexity: O(V + E) time, O(V) space (stack + visited set).
 */

/** Result of a DFS traversal from a start vertex. */
export interface DfsTraversal {
  /** Vertices in the order they were popped — deterministic for a given graph. */
  visitedInOrder: string[];
  /** Every vertex reachable from startId (the connected component, since the graph is undirected). */
  readonly reachable: ReadonlySet<string>;
}

/**
 * Traverse the connected component of `startId` in DFS order.
 * @throws GraphError if startId is not a vertex of `graph`.
 */
export function dfsTraverse(graph: WeightedGraph, startId: string): DfsTraversal {
  if (!graph.hasVertex(startId)) {
    throw new GraphError(`start vertex "${startId}" does not exist in the graph`);
  }
  const visitedInOrder: string[] = [];
  const reachable = new Set<string>();
  const stack: string[] = [startId];

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachable.has(id)) {
      continue; // already visited (a vertex can be pushed by several neighbours)
    }
    reachable.add(id);
    visitedInOrder.push(id);
    for (const { to } of graph.neighborsOf(id)) {
      if (!reachable.has(to)) {
        stack.push(to);
      }
    }
  }

  return { visitedInOrder, reachable };
}

/**
 * Vertices that are UNREACHABLE from `rootId` — the "orphans" of the walk
 * network (a disconnected building, a forgotten bridge, ...).
 *
 * Order: graph vertex insertion order, so the result is deterministic.
 * O(V + E) time (one DFS).
 * @throws GraphError if rootId is not a vertex of `graph`.
 */
export function findUnreachable(graph: WeightedGraph, rootId: string): string[] {
  const { reachable } = dfsTraverse(graph, rootId);
  return graph.vertexIds().filter((id) => !reachable.has(id));
}

/** Result of an undirected cycle detection run. */
export interface CycleDetection {
  hasCycle: boolean;
  /**
   * A canonical edge that CLOSES a cycle ("witness"), or null. Note: this is
   * the back edge found by DFS, not the full cycle — the actual cycle is the
   * witness edge plus the two DFS tree paths back to their common ancestor.
   */
  witnessEdge: { from: string; to: string } | null;
}

/**
 * Detect whether the graph (or one component, if `startId` is given) contains
 * a cycle, using the classic undirected DFS rule:
 *
 *   While DFS-popping vertex u, any neighbour v that is ALREADY visited and
 *   is not joined to u by the DFS tree edge (parent[v] === u or
 *   parent[u] === v) closes a cycle: u -> v plus the two tree paths from u
 *   and v back to their common ancestor.
 *
 * Components are scanned in vertex insertion order, so the first witness
 * edge returned is deterministic.
 *
 * Complexity: O(V + E) time, O(V) space.
 * @throws GraphError if startId (when given) is not a vertex of `graph`.
 */
export function detectCycle(graph: WeightedGraph, startId?: string): CycleDetection {
  if (startId !== undefined && !graph.hasVertex(startId)) {
    throw new GraphError(`start vertex "${startId}" does not exist in the graph`);
  }
  const seen = new Set<string>();
  const parent = new Map<string, string | null>();
  const roots = startId !== undefined ? [startId] : graph.vertexIds();

  for (const start of roots) {
    if (seen.has(start)) {
      continue; // component already covered
    }
    parent.set(start, null);
    const stack: string[] = [start];

    while (stack.length > 0) {
      const u = stack.pop()!;
      if (seen.has(u)) {
        continue;
      }
      seen.add(u);

      for (const { to: v } of graph.neighborsOf(u)) {
        if (parent.get(v) === u || parent.get(u) === v) {
          continue; // the DFS tree edge itself (seen from either side)
        }
        if (seen.has(v) || parent.has(v)) {
          // v is already in the DFS forest (popped or on the stack) and (u, v)
          // is not the tree edge -> cycle closed.
          return { hasCycle: true, witnessEdge: canonicalEdgeIds(u, v) };
        }
        parent.set(v, u);
        stack.push(v);
      }
    }
  }

  return { hasCycle: false, witnessEdge: null };
}
