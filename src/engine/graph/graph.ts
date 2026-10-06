import type { Edge } from './edge';
import type { WeightSource } from './edge';
import type { Vertex } from './vertex';

/** One stored direction of an undirected edge: an adjacency-list entry. */
export interface AdjacencyEntry {
  /** Id of the vertex this entry points to. */
  to: string;
  /** Travelling cost in metres. */
  weight: number;
  /** Surface category of the connection. */
  kind: string;
  /** Provenance of the weight (if known). */
  weightSource?: WeightSource;
}

/** Thrown for any invalid graph mutation (bad ids, weights, duplicates). */
export class GraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphError';
  }
}

/** Separator that cannot appear in vertex ids — keeps canonical keys collision-free. */
const SEP = '\u0000';

function canonicalEdgeKey(a: string, b: string): string {
  return a < b ? `${a}${SEP}${b}` : `${b}${SEP}${a}`;
}

/**
 * The canonical (from < to) orientation of an undirected edge. Used by the
 * simulation/routing layers to identify and report edges direction-independently.
 */
export function canonicalEdgeIds(from: string, to: string): { from: string; to: string } {
  return from < to ? { from, to } : { from: to, to: from };
}

/** Empty list returned for unknown ids (shared, never mutated). */
const EMPTY_NEIGHBORS: readonly AdjacencyEntry[] = [];

/**
 * Generic weighted undirected graph using adjacency lists.
 *
 * Representation and complexity:
 *   - vertices : Map<id, Vertex>            — O(1) lookup by id
 *   - adjacency: Map<id, AdjacencyEntry[]>  — the adjacency list itself
 *   - edgeKeys : Set<canonical edge key>    — O(1) duplicate detection and an
 *                exact undirected edge count (each pair counted once)
 *
 * Operations:
 *   addVertex   O(1)
 *   addEdge     O(1) average (hash map + set)
 *   neighborsOf O(1) to obtain, O(deg(v)) to consume
 *   edges       O(V + E)
 *
 * Space: O(V + E).
 *
 * Why an adjacency list and not an adjacency matrix? Walking networks are
 * sparse: every vertex has a handful of connections (deg ≪ V), so a list
 * uses O(V + E) space and scans only the real neighbours, while a matrix
 * would use O(V²) and scan V dead entries per neighbourhood. (This trade-off
 * is one of the standard viva questions — see docs, Phase 5.)
 *
 * The class is a pure data structure: no DOM, no Three.js, no dataset
 * knowledge.
 */
export class WeightedGraph {
  private readonly vertices = new Map<string, Vertex>();
  private readonly adjacency = new Map<string, AdjacencyEntry[]>();
  private readonly edgeKeys = new Set<string>();

  /** Number of vertices. O(1). */
  get vertexCount(): number {
    return this.vertices.size;
  }

  /** Number of undirected edges (each pair counted exactly once). O(1). */
  get edgeCount(): number {
    return this.edgeKeys.size;
  }

  /**
   * Add a vertex.
   * @throws GraphError on duplicate ids or non-finite coordinates.
   */
  addVertex(vertex: Vertex): void {
    if (this.vertices.has(vertex.id)) {
      throw new GraphError(`duplicate vertex id "${vertex.id}"`);
    }
    for (const axis of ['x', 'y', 'z'] as const) {
      if (!Number.isFinite(vertex[axis])) {
        throw new GraphError(
          `vertex "${vertex.id}" has non-finite coordinate ${axis}=${String(vertex[axis])}`,
        );
      }
    }
    this.vertices.set(vertex.id, vertex);
    this.adjacency.set(vertex.id, []);
  }

  /** Whether a vertex with this id exists. O(1). */
  hasVertex(id: string): boolean {
    return this.vertices.has(id);
  }

  /** The vertex with this id, or undefined. O(1). */
  getVertex(id: string): Vertex | undefined {
    return this.vertices.get(id);
  }

  /**
   * All vertex ids in insertion order. Stable across runs, which keeps
   * algorithm traces and the demo fully reproducible. O(V).
   */
  vertexIds(): string[] {
    return [...this.vertices.keys()];
  }

  /**
   * Add an undirected edge, stored as two directed adjacency entries.
   * @throws GraphError on self-loops, unknown endpoints, non-positive or
   *          non-finite weights, or a duplicate edge (either direction).
   */
  addEdge(edge: Edge): void {
    const { from, to } = edge;
    if (from === to) {
      throw new GraphError(`self-loop on "${from}" is not supported`);
    }
    if (!this.vertices.has(from)) {
      throw new GraphError(`edge references unknown vertex "${from}"`);
    }
    if (!this.vertices.has(to)) {
      throw new GraphError(`edge references unknown vertex "${to}"`);
    }
    if (!Number.isFinite(edge.weight) || edge.weight <= 0) {
      throw new GraphError(
        `edge "${from}"<->"${to}" must have a finite, positive weight in metres (got ${String(edge.weight)})`,
      );
    }
    const key = canonicalEdgeKey(from, to);
    if (this.edgeKeys.has(key)) {
      throw new GraphError(`duplicate edge "${from}"<->"${to}"`);
    }

    this.edgeKeys.add(key);
    this.pushEntry(from, to, edge.weight, edge.kind, edge.weightSource);
    this.pushEntry(to, from, edge.weight, edge.kind, edge.weightSource);
  }

  /**
   * Directed adjacency entries for a vertex. Both directions of each
   * undirected edge appear, so an a<->b edge is visible from both sides.
   * O(deg(v)) to consume. Unknown ids yield an empty list — callers that
   * must fail on unknown ids should check hasVertex() first.
   *
   * Returns a shallow copy: mutating the array does not corrupt the graph
   * (the entry objects themselves are shared and should be treated as read-only).
   */
  neighborsOf(id: string): readonly AdjacencyEntry[] {
    const list = this.adjacency.get(id);
    return list === undefined ? EMPTY_NEIGHBORS : [...list];
  }

  /** Number of walkable connections of a vertex. O(deg(v)). */
  degreeOf(id: string): number {
    return this.neighborsOf(id).length;
  }

  /**
   * Every undirected edge exactly once, in canonical (from < to) order.
   * O(V + E).
   */
  edges(): Edge[] {
    const out: Edge[] = [];
    for (const [id, entries] of this.adjacency) {
      for (const entry of entries) {
        if (id < entry.to) {
          const edge: Edge = { from: id, to: entry.to, weight: entry.weight, kind: entry.kind };
          if (entry.weightSource !== undefined) {
            edge.weightSource = entry.weightSource;
          }
          out.push(edge);
        }
      }
    }
    return out;
  }

  /**
   * Remove an undirected edge from THIS graph (destructive to this instance).
   * For non-destructive "blocking", call clone() first and remove on the
   * clone — see simulation/block.ts. O(deg(from) + deg(to)) time.
   * @throws GraphError on self-loops, unknown vertices, or a missing edge.
   */
  removeEdge(from: string, to: string): void {
    if (from === to) {
      throw new GraphError(`self-loop on "${from}" is not supported`);
    }
    if (!this.vertices.has(from)) {
      throw new GraphError(`edge references unknown vertex "${from}"`);
    }
    if (!this.vertices.has(to)) {
      throw new GraphError(`edge references unknown vertex "${to}"`);
    }
    const key = canonicalEdgeKey(from, to);
    if (!this.edgeKeys.has(key)) {
      throw new GraphError(`edge "${from}"<->"${to}" does not exist in the graph`);
    }
    this.edgeKeys.delete(key);
    this.stripDirection(from, to);
    this.stripDirection(to, from);
  }

  /**
   * A structural copy: same vertices, same edges. O(V + E) time and space.
   * Vertex objects are shared (they are treated as immutable everywhere);
   * the graph structure itself is fully independent, so the clone can be
   * mutated (removeEdge, ...) without affecting the original.
   *
   * Note: the clone's internal adjacency order can differ from the original
   * (edges are re-added in canonical scan order). This never affects costs,
   * optimality, or results — only the ordering of trace events on the clone.
   */
  clone(): WeightedGraph {
    const copy = new WeightedGraph();
    for (const vertex of this.vertices.values()) {
      copy.addVertex(vertex);
    }
    for (const edge of this.edges()) {
      copy.addEdge(edge);
    }
    return copy;
  }

  private stripDirection(from: string, to: string): void {
    const list = this.adjacency.get(from)!;
    const index = list.findIndex((entry) => entry.to === to);
    if (index !== -1) {
      list.splice(index, 1);
    }
  }

  private pushEntry(
    from: string,
    to: string,
    weight: number,
    kind: string,
    weightSource: WeightSource | undefined,
  ): void {
    const entry: AdjacencyEntry = { to, weight, kind };
    if (weightSource !== undefined) {
      entry.weightSource = weightSource;
    }
    // `from` is guaranteed to exist: addEdge validated both endpoints.
    this.adjacency.get(from)!.push(entry);
  }
}
