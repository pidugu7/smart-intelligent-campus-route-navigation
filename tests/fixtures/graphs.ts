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
