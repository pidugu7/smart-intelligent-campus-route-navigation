/**
 * viz/layout.ts
 *
 * Pure (dependency-free) layout math: turns a dataset into the geometry the
 * Three.js layer draws. No three.js, no DOM — so it is unit-testable in Node
 * and keeps every visual decision auditable in one place.
 *
 * Coordinate mapping (dataset → three.js):
 *   dataset (x = east, y = north, z = elevation)
 *   three   (x = east, z = -north, y = up)
 * so the map reads like a normal map: north is "up the screen" when viewed
 * from the south.
 */

import type { Dataset, DatasetVertex } from '../data/schema';

export interface LayoutVertex {
  id: string;
  name: string;
  type: string;
  /** Dataset coordinates (metres). */
  x: number;
  y: number;
  z: number;
  /** Labeled with a prominent tag (pavilions, gates, areas, major attractions). */
  major: boolean;
}

export interface LayoutEdge {
  id: string;
  fromId: string;
  toId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  kind: string;
  /** 1 = promenade-class (wide), 0 = regular path, -1 = indoor/narrow. */
  widthClass: number;
  /** True for the walkable bridge (drawn as a deck, not a tube). */
  isBridge: boolean;
}

export interface CampusLayout {
  vertices: LayoutVertex[];
  edges: LayoutEdge[];
  vertexById: Map<string, LayoutVertex>;
  /** World bounds over all vertices (metres, dataset axes). */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  /** Mean radius of the ring vertices (promenade circle), 0 when not detectable. */
  ringRadius: number;
  /** Suggested water radius for the central lake (dataset axes). */
  lagoonRadius: number;
  /** Scene centre (dataset axes) — a good orbit target. */
  center: { x: number; y: number };
}

/** Types that get a prominent label. */
const MAJOR_TYPES = new Set(['pavilion', 'gate', 'bridge', 'area']);
/** Landmark/attraction ids are major only when they are front-of-park landmarks (not pavilion-internal rooms). */
const MINOR_BY_PREFIX = new Set(['land-pyramid', 'land-stavechurch', 'land-eiffel', 'attr-granfiesta', 'attr-frozen', 'attr-adv', 'attr-ratatouille']);

export function isMajorVertex(v: DatasetVertex): boolean {
  if (MAJOR_TYPES.has(v.type)) return true;
  if (v.type === 'plaza') return v.id === 'outpost' || v.id === 'gate-plaza';
  if (v.type === 'landmark' || v.type === 'attraction') return !MINOR_BY_PREFIX.has(v.id);
  return false;
}

function widthClassOf(kind: string): number {
  if (kind === 'bridge') return 1;
  if (kind === 'indoor') return -1;
  return 0;
}

/**
 * Build the layout from any dataset that follows the project schema.
 * Nothing here is venue-specific: the "ring"/lagoon derivation works for any
 * dataset whose vertices contain a rough circle around the origin (EPCOT's
 * promenade does; a campus layout would simply yield ringRadius 0 and the
 * lagoon is skipped).
 */
export function buildCampusLayout(dataset: Dataset): CampusLayout {
  const vertexById = new Map<string, LayoutVertex>();
  const vertices: LayoutVertex[] = dataset.vertices.map((v) => {
    const lv: LayoutVertex = {
      id: v.id,
      name: v.name,
      type: v.type,
      x: v.x,
      y: v.y,
      z: v.z,
      major: isMajorVertex(v),
    };
    vertexById.set(v.id, lv);
    return lv;
  });

  const edges: LayoutEdge[] = [];
  for (const e of dataset.edges) {
    const a = vertexById.get(e.from);
    const b = vertexById.get(e.to);
    if (!a || !b) continue; // the loader guarantees endpoints exist; be defensive anyway
    edges.push({
      id: e.id,
      fromId: a.id,
      toId: b.id,
      fromX: a.x,
      fromY: a.y,
      toX: b.x,
      toY: b.y,
      kind: e.kind,
      widthClass: widthClassOf(e.kind),
      isBridge: e.kind === 'bridge',
    });
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }

  // Ring detection: vertices that lie at a consistent radius from the origin.
  const radii: number[] = [];
  for (const v of vertices) {
    const r = Math.hypot(v.x, v.y);
    if (v.type === 'pavilion' || v.type === 'plaza' || v.type === 'area') {
      if (r > 250 && r < 420) radii.push(r);
    }
  }
  let ringRadius = 0;
  if (radii.length >= 4) {
    const mean = radii.reduce((s, r) => s + r, 0) / radii.length;
    // Only accept a tight cluster (±15 %), otherwise there is no "ring".
    const spread = radii.every((r) => Math.abs(r - mean) / mean < 0.15);
    if (spread) ringRadius = mean;
  }

  // Promenade class: edges whose BOTH endpoints sit on the ring circle are
  // the wide lakeside promenade (EPCOT's lagoon walk). Generic: a dataset
  // without such a ring simply has none. Tolerance is 5 %: every true ring
  // segment endpoint sits within ~2.5 % of the fitted radius, while the
  // International Gateway (a separate external entrance ~7 % off the circle)
  // is correctly excluded.
  if (ringRadius > 0) {
    for (const e of edges) {
      const ra = Math.hypot(e.fromX, e.fromY);
      const rb = Math.hypot(e.toX, e.toY);
      if (Math.abs(ra - ringRadius) < ringRadius * 0.05 && Math.abs(rb - ringRadius) < ringRadius * 0.05) {
        e.widthClass = 1;
      }
    }
  }

  return {
    vertices,
    edges,
    vertexById,
    bounds: { minX, maxX, minY, maxY },
    ringRadius,
    lagoonRadius: ringRadius > 0 ? ringRadius * 0.94 : 0,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  };
}
