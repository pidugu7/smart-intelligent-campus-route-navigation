/**
 * Provenance tags used across the whole project (the "confidence system").
 *
 * Every real-world dataset loaded into the engine must tag its locations and
 * weights with one of these values so the UI (Phase 4) can show how
 * trustworthy each number is. The engine itself does not interpret them —
 * it only carries them through to the result.
 */
export type Confidence = 'verified' | 'approximate' | 'unavailable';

/**
 * A single walkable location (node) in the routing graph.
 *
 * Coordinates are expressed in metres inside the dataset's own local
 * coordinate system (no GPS, no real-world datum). The 3D layer (Phase 4)
 * consumes the same numbers directly, with `y` as the up axis.
 */
export interface Vertex {
  /** Stable unique identifier used by every algorithm, e.g. "gate-main". */
  id: string;
  /** Human-readable label shown in the UI, e.g. "Germany Pavilion". */
  name: string;
  /**
   * Free-form category: 'gate' | 'building' | 'poi' | 'intersection' | ...
   * Intentionally a plain string so datasets can use their own vocabulary
   * without changing the engine.
   */
  type: string;
  /** X coordinate in metres (dataset-local system). */
  x: number;
  /** Y coordinate in metres (dataset-local system). */
  y: number;
  /** Elevation in metres; 0 for a flat site. */
  z: number;
  /** How this location's data was established (see Confidence). */
  confidence?: Confidence;
  /** Optional free-text note, e.g. the source document the data came from. */
  note?: string;
}
