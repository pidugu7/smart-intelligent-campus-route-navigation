/**
 * Public entry point of the DSA engine.
 *
 * This file is the whole API surface used by the 3D frontend (Phase 4) and
 * by the tests. The engine is pure TypeScript — no DOM, no Three.js, no
 * dataset-specific knowledge: it routes whatever WeightedGraph it is handed
 * one. That is what allows the EPCOT demonstration dataset (Phase 3) to be
 * swapped for another real map later (e.g. Amrita Bengaluru) with zero
 * changes to the algorithm code.
 */

import { dijkstra } from './algorithms/dijkstra';
import { GraphError } from './graph/graph';
import type { WeightedGraph } from './graph/graph';
import { reconstructPath } from './routing/path-reconstruct';
import type { RouteResult } from './routing/route-result';

/** Algorithms supported by findRoute. Phase 2 adds 'astar' and 'bfs'. */
export type AlgorithmId = 'dijkstra';

/**
 * Route from sourceId to targetId using the requested algorithm.
 *
 * Runs the algorithm synchronously (campus-scale graphs solve in
 * microseconds) and returns a RouteResult carrying the ordered path, the
 * optimal cost in metres, work counters, and the full execution trace for
 * later animation. Unreachable targets yield status 'unreachable' — never a
 * thrown exception.
 *
 * Complexity: see algorithms/dijkstra.ts — O((V + E) log V) time.
 *
 * @throws GraphError if either id is not a vertex of `graph`.
 */
export function findRoute(
  graph: WeightedGraph,
  sourceId: string,
  targetId: string,
  algorithm: AlgorithmId = 'dijkstra',
): RouteResult {
  if (algorithm !== 'dijkstra') {
    throw new GraphError(`unsupported algorithm "${algorithm}"`);
  }

  const run = dijkstra(graph, sourceId, { targetId });
  // dijkstra() validated both ids, so these lookups cannot fail.
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

// ── Re-exported public surface ─────────────────────────────────────────────
export { MinHeap, numericComparator } from './priority-queue/min-heap';
export type { Comparator } from './priority-queue/min-heap';
export { WeightedGraph, GraphError } from './graph/graph';
export type { AdjacencyEntry } from './graph/graph';
export type { Vertex, Confidence } from './graph/vertex';
export type { Edge, WeightSource } from './graph/edge';
export { dijkstra, dijkstraComparator } from './algorithms/dijkstra';
export type { DijkstraOptions, DijkstraRun, DijkstraHeapEntry } from './algorithms/dijkstra';
export { reconstructPath } from './routing/path-reconstruct';
export type { RouteResult, RouteStats } from './routing/route-result';
export { TraceRecorder } from './trace/step-trace';
export type { TraceEvent } from './trace/step-trace';
