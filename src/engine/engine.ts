/**
 * Public entry point of the DSA engine — the complete re-export surface.
 *
 * This file is the whole API used by the 3D frontend (Phase 4) and by the
 * tests. The engine is pure TypeScript — no DOM, no Three.js, no
 * dataset-specific knowledge: it routes whatever WeightedGraph it is handed
 * one. That is what allows the EPCOT demonstration dataset (Phase 3) to be
 * swapped for another real map later (e.g. Amrita Bengaluru) with zero
 * changes to the algorithm code.
 *
 * Layout:
 *   graph/           weighted undirected graph (adjacency lists) + models
 *   priority-queue/  hand-written binary min-heap (shared by Dijkstra & A*)
 *   algorithms/      dijkstra, a-star, bfs, dfs, heuristic
 *   routing/         findRoute, path reconstruction, comparison,
 *                    alternatives, walk-time metrics
 *   simulation/      blocked-path simulation (clone + mutate view)
 *   trace/           the shared execution-trace event schema
 */

// ── Public API ─────────────────────────────────────────────────────────────
export { findRoute } from './routing/find-route';
export type { AlgorithmId } from './routing/find-route';

// ── Algorithms ─────────────────────────────────────────────────────────────
export { dijkstra, dijkstraComparator } from './algorithms/dijkstra';
export type { DijkstraOptions, DijkstraRun, DijkstraHeapEntry } from './algorithms/dijkstra';
export { aStar, aStarComparator } from './algorithms/a-star';
export type { AStarOptions, AStarRun, AStarHeapEntry } from './algorithms/a-star';
export { bfs } from './algorithms/bfs';
export type { BfsOptions, BfsRun } from './algorithms/bfs';
export { dfsTraverse, findUnreachable, detectCycle } from './algorithms/dfs';
export type { DfsTraversal, CycleDetection } from './algorithms/dfs';
export { euclideanHeuristic } from './algorithms/heuristic';
export type { Heuristic } from './algorithms/heuristic';

// ── Routing utilities ──────────────────────────────────────────────────────
export { reconstructPath } from './routing/path-reconstruct';
export type { RouteResult, RouteStats } from './routing/route-result';
export { compareAlgorithms } from './routing/compare';
export type {
  AlgorithmSummary,
  AlgorithmComparison,
  CompareOptions,
} from './routing/compare';
export { findAlternativeRoute } from './routing/alternative';
export type { AlternativeRouteResult } from './routing/alternative';
export { estimateWalkTime, DEFAULT_WALKING_SPEED_M_PER_S } from './routing/metrics';
export type { WalkTimeEstimate } from './routing/metrics';

// ── Simulation ─────────────────────────────────────────────────────────────
export { simulateBlockedRoute } from './simulation/block';
export type { BlockSpec, BlockedRouteResult } from './simulation/block';

// ── Data structures & models ───────────────────────────────────────────────
export { MinHeap, numericComparator } from './priority-queue/min-heap';
export type { Comparator } from './priority-queue/min-heap';
export { WeightedGraph, GraphError, canonicalEdgeIds } from './graph/graph';
export type { AdjacencyEntry } from './graph/graph';
export type { Vertex, Confidence } from './graph/vertex';
export type { Edge, WeightSource } from './graph/edge';

// ── Tracing ────────────────────────────────────────────────────────────────
export { TraceRecorder } from './trace/step-trace';
export type { TraceEvent } from './trace/step-trace';
