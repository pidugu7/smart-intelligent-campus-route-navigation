/**
 * How an edge's weight was established. Part of the project-wide
 * confidence/provenance system: the engine treats it as pass-through data,
 * the UI (Phase 4) displays it, and tests assert real datasets carry it.
 */
export type WeightSource =
  /** Physically measured. */
  | 'measured'
  /** Traced from a published map where the path is visible. */
  | 'digitized-path'
  /** Straight-line chord between two points where no path is drawn. */
  | 'straight-line-approx'
  /** Declared assumption (must be documented in the dataset's provenance). */
  | 'assumed';

/**
 * A walkable connection between two vertices.
 *
 * The graph stores each undirected edge once per direction internally; this
 * type is what dataset loaders and callers use to describe an edge.
 */
export interface Edge {
  /** Vertex id at one end. */
  from: string;
  /** Vertex id at the other end. */
  to: string;
  /**
   * Travelling cost in metres. Must be finite and strictly positive
   * (Dijkstra's precondition; the graph rejects anything else).
   */
  weight: number;
  /** Surface category: 'path' | 'stair' | 'slope' | 'indoor' | ... */
  kind: string;
  /** Provenance of the weight (see WeightSource). */
  weightSource?: WeightSource;
}
