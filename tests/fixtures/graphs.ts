import { WeightedGraph } from '../../src/engine/graph/graph';
import type { Vertex } from '../../src/engine/graph/vertex';

/** Small helper: a vertex whose name equals its id, on the flat plane. */
export function makeVertex(id: string, type = 'poi'): Vertex {
  return { id, name: id, type, x: 0, y: 0, z: 0 };
}

/**
 * A line:  a —1— b —2— c —3— d
 */
export function lineGraph(): WeightedGraph {
  const g = new WeightedGraph();
  for (const id of ['a', 'b', 'c', 'd']) g.addVertex(makeVertex(id));
  g.addEdge({ from: 'a', to: 'b', weight: 1, kind: 'path' });
  g.addEdge({ from: 'b', to: 'c', weight: 2, kind: 'path' });
  g.addEdge({ from: 'c', to: 'd', weight: 3, kind: 'path' });
  return g;
}

/**
 * A diamond:
 *
 *        a —2— b —1— d
 *        |         ^
 *        5         2
 *        c ————————————
 *
 * Shortest a→d: a-b-d = 3 (the equal-hop path a-c-d costs 7).
 */
export function diamondGraph(): WeightedGraph {
  const g = new WeightedGraph();
  for (const id of ['a', 'b', 'c', 'd']) g.addVertex(makeVertex(id));
  g.addEdge({ from: 'a', to: 'b', weight: 2, kind: 'path' });
  g.addEdge({ from: 'a', to: 'c', weight: 5, kind: 'path' });
  g.addEdge({ from: 'b', to: 'd', weight: 1, kind: 'path' });
  g.addEdge({ from: 'c', to: 'd', weight: 2, kind: 'path' });
  return g;
}

/**
 * Fewer hops but longer:
 *
 *        a —10— b
 *        |      ^
 *        1      1
 *        c ——————
 *
 * Dijkstra must prefer a-c-b (2) over the direct edge (10).
 */
export function hopsVsDistanceGraph(): WeightedGraph {
  const g = new WeightedGraph();
  for (const id of ['a', 'b', 'c']) g.addVertex(makeVertex(id));
  g.addEdge({ from: 'a', to: 'b', weight: 10, kind: 'path' });
  g.addEdge({ from: 'a', to: 'c', weight: 1, kind: 'path' });
  g.addEdge({ from: 'c', to: 'b', weight: 1, kind: 'path' });
  return g;
}

/**
 * A 5-cycle with asymmetric weights:
 *
 *   n0 —1— n1 —10— n2 —1— n3 —1— n4 —10— n0
 *
 * n0→n2: via n1 = 11 (beats 12 via n4/n3)
 * n0→n3: via n4 = 11 (beats 12 via n1/n2)
 */
export function ringGraph(): WeightedGraph {
  const g = new WeightedGraph();
  for (const id of ['n0', 'n1', 'n2', 'n3', 'n4']) g.addVertex(makeVertex(id));
  g.addEdge({ from: 'n0', to: 'n1', weight: 1, kind: 'path' });
  g.addEdge({ from: 'n1', to: 'n2', weight: 10, kind: 'path' });
  g.addEdge({ from: 'n2', to: 'n3', weight: 1, kind: 'path' });
  g.addEdge({ from: 'n3', to: 'n4', weight: 1, kind: 'path' });
  g.addEdge({ from: 'n4', to: 'n0', weight: 10, kind: 'path' });
  return g;
}

/** Two disconnected components: (a, b) and (x, y). */
export function disconnectedGraph(): WeightedGraph {
  const g = new WeightedGraph();
  for (const id of ['a', 'b', 'x', 'y']) g.addVertex(makeVertex(id));
  g.addEdge({ from: 'a', to: 'b', weight: 1, kind: 'path' });
  g.addEdge({ from: 'x', to: 'y', weight: 4, kind: 'path' });
  return g;
}

/**
 * A tie: two paths of exactly equal cost (a-b-d and a-c-d, both 2).
 * Determinism (heap id tie-break) must make the chosen path stable: a-b-d.
 */
export function tieGraph(): WeightedGraph {
  const g = new WeightedGraph();
  for (const id of ['a', 'b', 'c', 'd']) g.addVertex(makeVertex(id));
  g.addEdge({ from: 'a', to: 'b', weight: 1, kind: 'path' });
  g.addEdge({ from: 'a', to: 'c', weight: 1, kind: 'path' });
  g.addEdge({ from: 'b', to: 'd', weight: 1, kind: 'path' });
  g.addEdge({ from: 'c', to: 'd', weight: 1, kind: 'path' });
  return g;
}

/**
 * SPATIAL grid (the Phase 2 default for A* tests).
 *
 * cols × rows intersections, `spacing` metres apart, orthogonal edges whose
 * weight EXACTLY equals the geometric length (surface factor 1.0). The
 * Euclidean heuristic is therefore admissible AND consistent here.
 *
 * Corner to corner: optimal cost = (cols + rows - 2) × spacing.
 */
export function gridGraph(cols = 4, rows = 4, spacing = 10): WeightedGraph {
  const g = new WeightedGraph();
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      g.addVertex({
        id: `v${r}-${c}`,
        name: `grid ${r}-${c}`,
        type: 'intersection',
        x: c * spacing,
        y: r * spacing,
        z: 0,
      });
    }
  }
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (c + 1 < cols) {
        g.addEdge({ from: `v${r}-${c}`, to: `v${r}-${c + 1}`, weight: spacing, kind: 'path' });
      }
      if (r + 1 < rows) {
        g.addEdge({ from: `v${r}-${c}`, to: `v${r + 1}-${c}`, weight: spacing, kind: 'path' });
      }
    }
  }
  return g;
}

/**
 * SPATIAL "cheap wrong-way tail" graph — the A* showcase fixture.
 *
 *   Source s at (0,0). Target t at (50,0).
 *   - East corridor: s —10— p1 —10— p2 —10— p3 —10— p4 —10— t  (optimal: 50 m)
 *   - West tail: 30 nodes 1 m apart going the WRONG way, each edge 1 m
 *     (factor 1.0, so the heuristic stays admissible). Cheap in cost (1 m
 *     each) but far from the target in straight-line distance.
 *
 * Expected: Dijkstra (g-ordered) walks the entire cheap tail before reaching
 * the target (36 expansions); A* (f-ordered) never pops a tail node, because
 * every tail node has f = 50 + 2k >= 52 > f(target) = 50 (6 expansions).
 * Same optimal cost (50) either way — the classic A* advantage.
 */
export function longCheapTailGraph(): WeightedGraph {
  const g = new WeightedGraph();
  g.addVertex({ id: 's', name: 'Source', type: 'gate', x: 0, y: 0, z: 0 });
  g.addVertex({ id: 't', name: 'Target', type: 'poi', x: 50, y: 0, z: 0 });
  for (let k = 1; k <= 4; k += 1) {
    g.addVertex({ id: `p${k}`, name: `Corridor ${k}`, type: 'intersection', x: 10 * k, y: 0, z: 0 });
  }
  for (let k = 1; k <= 30; k += 1) {
    g.addVertex({ id: `w${k}`, name: `West tail ${k}`, type: 'intersection', x: -k, y: 0, z: 0 });
  }
  g.addEdge({ from: 's', to: 'p1', weight: 10, kind: 'path' });
  for (let k = 1; k <= 3; k += 1) {
    g.addEdge({ from: `p${k}`, to: `p${k + 1}`, weight: 10, kind: 'path' });
  }
  g.addEdge({ from: 'p4', to: 't', weight: 10, kind: 'path' });
  g.addEdge({ from: 's', to: 'w1', weight: 1, kind: 'path' });
  for (let k = 1; k <= 29; k += 1) {
    g.addEdge({ from: `w${k}`, to: `w${k + 1}`, weight: 1, kind: 'path' });
  }
  return g;
}
