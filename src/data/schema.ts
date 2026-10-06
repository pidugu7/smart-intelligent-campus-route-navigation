/**
 * data/schema.ts
 *
 * Phase 3 — generic, reusable dataset schema.
 *
 * A "dataset" is an external, data-driven description of a real-world
 * walkable environment (a theme park, campus, airport, hospital, …) that the
 * generic Phase 1/2 engine can be loaded with. The schema is deliberately
 * domain-agnostic: nothing in this file mentions any particular venue.
 *
 * Honesty rules (enforced by the loader, documented here):
 *  - Every spatial value (vertex x/y/z, edge weight) carries a `confidence`:
 *      'verified'     — taken from an authoritative published measurement
 *                       (e.g. an official documented distance).
 *      'approximate'  — digitized from / estimated against a published map,
 *                       or otherwise derived (straight-line, scaled, …).
 *      'unavailable'  — the value is not known; used only to document
 *                       vertices whose position could not be established.
 *  - An edge's `weightSource` records HOW the weight was obtained so a
 *    verified value can never be silently confused with an approximation.
 *  - `meta` records the coordinate system, origin, scale method, precision,
 *    reference date and sources for the whole dataset.
 */

/** Honesty tag for every spatial value. */
export type Confidence = 'verified' | 'approximate' | 'unavailable';

export const CONFIDENCE_VALUES: readonly Confidence[] = [
  'verified',
  'approximate',
  'unavailable',
] as const;

/** How an edge weight was obtained. */
export type WeightSource =
  /** Authoritative on-the-ground measurement (e.g. survey, published metric distance). */
  | 'measured'
  /** Traced along a visible path on a published map, at the dataset's documented scale. */
  | 'digitized-path'
  /** Euclidean straight line between two endpoints; always an upper bound on the true path. */
  | 'straight-line-approx'
  /** Quoted from a documented published distance (maps to the engine's 'measured' bucket). */
  | 'documented-distance'
  /** The weight is not known. Valid only for documented non-walkable edges; the loader
   *  rejects it on routable edges. */
  | 'unavailable';

export const WEIGHT_SOURCE_VALUES: readonly WeightSource[] = [
  'measured',
  'digitized-path',
  'straight-line-approx',
  'documented-distance',
  'unavailable',
] as const;

/** Open-ended structural role of a vertex (door, gate, hall, plaza, room, pavilion, …). */
export type VertexType = string;

/** Open-ended role of an edge (walkway, path, bridge, elevator, stairs, indoor corridor, …). */
export type EdgeKind = string;

export interface DatasetVertex {
  id: string;
  name: string;
  type: VertexType;
  /** Position in dataset units (metres by convention) in the dataset's coordinate system. */
  x: number;
  y: number;
  /** Elevation; 0 for flat datasets. */
  z: number;
  /** Optional floor/level index for multi-storey datasets (0 = ground). */
  floor?: number;
  confidence: Confidence;
  /** Short human-readable provenance note for this vertex's spatial values. */
  source?: string;
  /** Optional extra note (e.g. "name documented by official guide; position estimated"). */
  note?: string;
}

export interface DatasetEdge {
  id: string;
  from: string;
  to: string;
  /** Walk length in dataset units (metres by convention). Must be finite and > 0. */
  weight: number;
  weightSource: WeightSource;
  kind: EdgeKind;
  confidence: Confidence;
  note?: string;
  /** Optional free-form metadata (openness hours, accessibility notes, …). */
  meta?: Record<string, unknown>;
}

export interface DatasetSource {
  /** What the source is (e.g. "Official 2026 park map (image, used as reference only)"). */
  label: string;
  /** Optional URL of the source. */
  url?: string;
  /** Which parts of the dataset this source supports. */
  usedFor: string;
}

export interface DatasetMeta {
  name: string;
  description: string;
  /** Unit of all x/y/z and weight values. */
  unit: 'm';
  /** Full description of the coordinate system (origin, axis directions, units). */
  coordinateSystem: string;
  /** Where (0,0,0) is, in plain words. */
  origin: string;
  /** How the scale was established (the calibration method). */
  scaleMethod: string;
  /** Estimated precision of coordinates and weights. */
  precision: string;
  /** Edition/date of the primary reference (e.g. "2026"). */
  referenceDate: string;
  /** Datasets for real environments must be `false`; fiction may be `true` (the
   *  template dataset uses this). */
  fictional: boolean;
  sources: DatasetSource[];
  assumptions: string[];
  /** Vertex to run reachability/orphan checks from (defaults to the first vertex). */
  primaryRootId?: string;
}

export interface Dataset {
  meta: DatasetMeta;
  vertices: DatasetVertex[];
  edges: DatasetEdge[];
}
