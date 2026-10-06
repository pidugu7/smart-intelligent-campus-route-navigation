import type { Vertex } from '../graph/vertex';

/**
 * Heuristic h(n): an estimate of the remaining cost from `vertex` to the
 * target. A* requires h to be admissible (never overestimate), and — for the
 * single-finalization guarantee — consistent (monotone).
 */
export type Heuristic = (vertex: Vertex, target: Vertex) => number;

/**
 * Euclidean distance in the dataset's (x, y, z) space, in metres.
 *
 * Why this is ADMISSIBLE for this project's weight model:
 *   Edge weights are geometric length × surface factor with factor >= 1
 *   (flat path 1.0, slope ~1.2, stairs ~1.3 — declared in dataset
 *   provenance). Any real walk from u to the target therefore costs at
 *   least the straight-line distance, so h(u) = |u - target| never
 *   overestimates the true remaining cost.
 *
 * Why this is CONSISTENT (monotone):
 *   By the triangle inequality |u - target| <= |u - v| + |v - target|, and
 *   w(u, v) >= |u - v|, hence h(u) <= w(u, v) + h(v). Consequence: when A*
 *   finalizes a vertex, its g-value is already optimal and the vertex never
 *   needs to be re-opened — exactly Dijkstra's finality, for free.
 *
 * Caveat (documented, viva-relevant):
 *   If a dataset ever used factor < 1 (e.g. an escalator "shortcut"),
 *   admissibility would break and A* could return suboptimal routes. Such
 *   weights must stay >= 1, or the heuristic must be scaled down.
 *
 * O(1) per evaluation.
 */
export function euclideanHeuristic(target: Vertex): Heuristic {
  return (vertex) => Math.hypot(vertex.x - target.x, vertex.y - target.y, vertex.z - target.z);
}
