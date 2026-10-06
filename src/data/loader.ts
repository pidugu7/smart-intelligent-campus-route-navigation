/**
 * data/loader.ts
 *
 * Phase 3 — generic dataset loader.
 *
 * `loadDataset` takes a raw (parsed) dataset object, validates it with
 * descriptive, aggregated error reporting, builds the engine's
 * `WeightedGraph` from it, and runs connectivity / reachability / cycle
 * checks using the existing Phase 1/2 graph + DFS infrastructure.
 *
 * The loader contains NO venue-specific logic: the same code loads EPCOT,
 * a campus, an airport or a hospital dataset.
 */

import {
  WeightedGraph,
  GraphError,
  findUnreachable,
  detectCycle,
  dfsTraverse,
  type Vertex as EngineVertex,
} from '../engine/engine';
import type {
  Confidence,
  Dataset,
  DatasetEdge,
  DatasetMeta,
  DatasetVertex,
  WeightSource,
} from './schema';
import { CONFIDENCE_VALUES, WEIGHT_SOURCE_VALUES } from './schema';

/** Thrown when a dataset fails validation; `errors` lists every problem found. */
export class DatasetError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(
      `Invalid dataset (${errors.length} problem${errors.length === 1 ? '' : 's'}): ` +
        errors.map((e) => `- ${e}`).join('\n'),
    );
    this.name = 'DatasetError';
    this.errors = [...errors];
  }
}

/** Result of the loader's structural / reachability audit. */
export interface DatasetReport {
  datasetName: string;
  vertexCount: number;
  edgeCount: number;
  /** Number of weakly connected components over the undirected edge set. */
  connectedComponents: number;
  /**
   * Vertices not reachable from `meta.primaryRootId` (or the first vertex)
   * by the undirected reachability computed by the engine's DFS
   * infrastructure. Empty = the dataset is one reachable piece.
   */
  orphanedVertices: string[];
  /** Whether the undirected edge set contains a cycle. */
  hasCycle: boolean;
  /** Non-fatal observations (e.g. the 'unavailable' confidence count). */
  warnings: string[];
}

export interface LoadedDataset {
  dataset: Dataset;
  graph: WeightedGraph;
  /** Full dataset vertices keyed by id (includes schema fields the engine does not model, e.g. floor/meta). */
  vertices: Map<string, DatasetVertex>;
  /** Full dataset edges keyed by id (the engine Edge drops dataset-level provenance). */
  edges: Map<string, DatasetEdge>;
  report: DatasetReport;
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function asConfidence(value: unknown): Confidence | undefined {
  return (CONFIDENCE_VALUES as readonly string[]).includes(String(value))
    ? (value as Confidence)
    : undefined;
}

function asWeightSource(value: unknown): WeightSource | undefined {
  return (WEIGHT_SOURCE_VALUES as readonly string[]).includes(String(value))
    ? (value as WeightSource)
    : undefined;
}

/** Maps the schema's provenance values onto the engine's Edge weightSource union. */
function toEngineWeightSource(
  source: WeightSource,
): 'measured' | 'digitized-path' | 'straight-line-approx' | 'assumed' {
  switch (source) {
    case 'measured':
      return 'measured';
    case 'digitized-path':
      return 'digitized-path';
    case 'straight-line-approx':
      return 'straight-line-approx';
    case 'documented-distance':
      // A documented published distance is authoritative: the engine's 'measured' bucket.
      return 'measured';
    case 'unavailable':
      throw new Error('weightSource "unavailable" is not routable');
  }
}

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

function validateDataset(raw: unknown, errors: string[]): raw is Dataset {
  if (!isPlainObject(raw)) {
    errors.push('dataset root must be a JSON object');
    return false;
  }
  // All three validators run UNCONDITIONALLY so every problem is reported at
  // once (an invalid meta section must not mask vertex/edge problems).
  const metaOk = validateMeta(raw, errors);
  const verticesOk = validateVertices(raw, errors);
  const edgesOk = validateEdges(raw, errors);
  return metaOk && verticesOk && edgesOk;
}

function validateMeta(raw: Record<string, unknown>, errors: string[]): boolean {
  let ok = true;
  if (!isPlainObject(raw.meta)) {
    errors.push('meta: missing or not an object');
    return false;
  }
  const meta = raw.meta;
  const requireString = (field: string) => {
    if (!isNonEmptyString(meta[field])) {
      errors.push(`meta.${field}: missing or not a non-empty string`);
      ok = false;
    }
  };
  requireString('name');
  requireString('description');
  requireString('coordinateSystem');
  requireString('origin');
  requireString('scaleMethod');
  requireString('precision');
  requireString('referenceDate');

  if (meta.unit !== 'm') {
    errors.push("meta.unit: must be 'm' (the engine works in a single distance unit)");
    ok = false;
  }
  if (typeof meta.fictional !== 'boolean') {
    errors.push('meta.fictional: must be a boolean');
    ok = false;
  }
  if (!Array.isArray(meta.sources)) {
    errors.push('meta.sources: must be an array');
    ok = false;
  } else {
    meta.sources.forEach((s, i) => {
      if (!isPlainObject(s) || !isNonEmptyString(s.label) || !isNonEmptyString(s.usedFor)) {
        errors.push(`meta.sources[${i}]: needs string fields 'label' and 'usedFor'`);
        ok = false;
      }
    });
  }
  if (!Array.isArray(meta.assumptions) || meta.assumptions.some((a) => typeof a !== 'string')) {
    errors.push('meta.assumptions: must be an array of strings');
    ok = false;
  }
  return ok;
}

function validateVertices(raw: Record<string, unknown>, errors: string[]): boolean {
  let ok = true;
  if (!Array.isArray(raw.vertices) || raw.vertices.length === 0) {
    errors.push('vertices: must be a non-empty array');
    return false;
  }
  const seen = new Set<string>();
  raw.vertices.forEach((v, i) => {
    const where = `vertices[${i}]`;
    if (!isPlainObject(v)) {
      errors.push(`${where}: not an object`);
      ok = false;
      return;
    }
    if (!isNonEmptyString(v.id)) {
      errors.push(`${where}: 'id' must be a non-empty string`);
      ok = false;
      if (typeof v.id === 'string') seen.add(v.id);
      return;
    }
    if (seen.has(v.id)) {
      errors.push(`${where}: duplicate vertex id '${v.id}'`);
      ok = false;
    }
    seen.add(v.id);
    if (!isNonEmptyString(v.name)) {
      errors.push(`${where} (${v.id}): 'name' must be a non-empty string`);
      ok = false;
    }
    if (!isNonEmptyString(v.type)) {
      errors.push(`${where} (${v.id}): 'type' must be a non-empty string`);
      ok = false;
    }
    for (const axis of ['x', 'y', 'z'] as const) {
      if (!isFiniteNumber(v[axis])) {
        errors.push(`${where} (${v.id}): '${axis}' must be a finite number`);
        ok = false;
      }
    }
    if (v.floor !== undefined) {
      if (typeof v.floor !== 'number' || !Number.isInteger(v.floor) || v.floor < 0) {
        errors.push(`${where} (${v.id}): 'floor' must be a non-negative integer`);
        ok = false;
      }
    }
    if (asConfidence(v.confidence) === undefined) {
      errors.push(
        `${where} (${v.id}): 'confidence' must be one of ${CONFIDENCE_VALUES.join(', ')}`,
      );
      ok = false;
    }
  });
  return ok;
}

function validateEdges(raw: Record<string, unknown>, errors: string[]): boolean {
  let ok = true;
  if (!Array.isArray(raw.edges) || raw.edges.length === 0) {
    errors.push('edges: must be a non-empty array');
    return false;
  }
  const vertexIds = new Set(
    (raw.vertices as unknown[]).flatMap((v) =>
      isPlainObject(v) && typeof v.id === 'string' ? [v.id] : [],
    ),
  );
  const seenEdgeIds = new Set<string>();
  const seenPairs = new Set<string>();
  raw.edges.forEach((e, i) => {
    const where = `edges[${i}]`;
    if (!isPlainObject(e)) {
      errors.push(`${where}: not an object`);
      ok = false;
      return;
    }
    const label = isNonEmptyString(e.id) ? e.id : `#${i}`;
    if (!isNonEmptyString(e.id)) {
      errors.push(`${where}: 'id' must be a non-empty string`);
      ok = false;
    } else if (seenEdgeIds.has(e.id)) {
      errors.push(`${where}: duplicate edge id '${e.id}'`);
      ok = false;
    }
    seenEdgeIds.add(label);

    const endpoints = [e.from, e.to].map((x) => (typeof x === 'string' ? x : undefined));
    const [from, to] = endpoints;
    if (from === undefined || to === undefined) {
      errors.push(`${where} (${label}): 'from' and 'to' must be strings`);
      ok = false;
      return;
    }
    if (from === to) {
      errors.push(`${where} (${label}): self-loop ('from' equals 'to')`);
      ok = false;
    }
    for (const end of [from, to]) {
      if (!vertexIds.has(end)) {
        errors.push(`${where} (${label}): endpoint '${end}' does not match any vertex id`);
        ok = false;
      }
    }
    const pairKey = [from, to].sort().join('|');
    if (seenPairs.has(pairKey)) {
      errors.push(`${where} (${label}): duplicate undirected pair '${from}' ↔ '${to}'`);
      ok = false;
    }
    seenPairs.add(pairKey);

    if (!isFiniteNumber(e.weight) || e.weight <= 0) {
      errors.push(`${where} (${label}): 'weight' must be a finite number > 0`);
      ok = false;
    }
    const ws = asWeightSource(e.weightSource);
    if (ws === undefined) {
      errors.push(
        `${where} (${label}): 'weightSource' must be one of ${WEIGHT_SOURCE_VALUES.join(', ')}`,
      );
      ok = false;
    } else if (ws === 'unavailable') {
      errors.push(
        `${where} (${label}): weightSource 'unavailable' is not routable — remove the edge or give it a weight`,
      );
      ok = false;
    }
    if (asConfidence(e.confidence) === undefined) {
      errors.push(
        `${where} (${label}): 'confidence' must be one of ${CONFIDENCE_VALUES.join(', ')}`,
      );
      ok = false;
    }
    if (!isNonEmptyString(e.kind)) {
      errors.push(`${where} (${label}): 'kind' must be a non-empty string`);
      ok = false;
    }
  });
  return ok;
}

// ---------------------------------------------------------------------------
// building + reporting
// ---------------------------------------------------------------------------

function buildGraph(dataset: Dataset): WeightedGraph {
  const graph = new WeightedGraph();
  for (const v of dataset.vertices) {
    const engineVertex: EngineVertex = {
      id: v.id,
      name: v.name,
      type: v.type,
      x: v.x,
      y: v.y,
      z: v.z,
      confidence: v.confidence,
    };
    if (v.note !== undefined) engineVertex.note = v.note;
    graph.addVertex(engineVertex);
  }
  for (const e of dataset.edges) {
    graph.addEdge({
      from: e.from,
      to: e.to,
      weight: e.weight,
      kind: e.kind,
      weightSource: toEngineWeightSource(e.weightSource),
    });
  }
  return graph;
}

function countComponents(graph: WeightedGraph): number {
  const seen = new Set<string>();
  let components = 0;
  for (const id of graph.vertexIds()) {
    if (seen.has(id)) continue;
    components += 1;
    for (const reached of dfsTraverse(graph, id).reachable) seen.add(reached);
  }
  return components;
}

function audit(dataset: Dataset, graph: WeightedGraph): DatasetReport {
  const rootId =
    (dataset.meta.primaryRootId !== undefined &&
    graph.getVertex(dataset.meta.primaryRootId) !== undefined
      ? dataset.meta.primaryRootId
      : undefined) ??
    graph.vertexIds()[0] ??
    '';
  const orphans = rootId === '' ? [] : findUnreachable(graph, rootId);
  const unavailableVertices = dataset.vertices.filter((v) => v.confidence === 'unavailable');
  const warnings: string[] = [];
  if (unavailableVertices.length > 0) {
    warnings.push(
      `${unavailableVertices.length} vertex(es) have confidence 'unavailable': ${unavailableVertices
        .map((v) => v.id)
        .join(', ')}`,
    );
  }
  return {
    datasetName: dataset.meta.name,
    vertexCount: graph.vertexCount,
    edgeCount: graph.edgeCount,
    connectedComponents: countComponents(graph),
    orphanedVertices: orphans,
    hasCycle: detectCycle(graph).hasCycle,
    warnings,
  };
}

/**
 * Validate a raw dataset, build the engine graph and audit it.
 * Throws `DatasetError` listing ALL validation problems at once.
 */
export function loadDataset(raw: unknown): LoadedDataset {
  const errors: string[] = [];
  if (!validateDataset(raw, errors)) {
    throw new DatasetError(errors);
  }
  const dataset = raw as Dataset;
  let graph: WeightedGraph;
  try {
    graph = buildGraph(dataset);
  } catch (err) {
    if (err instanceof GraphError) {
      throw new DatasetError([`graph construction failed: ${err.message}`]);
    }
    throw err;
  }
  const vertices = new Map(dataset.vertices.map((v) => [v.id, v]));
  const edges = new Map(dataset.edges.map((e) => [e.id, e]));
  return { dataset, graph, vertices, edges, report: audit(dataset, graph) };
}

/** Convenience wrapper for loading a dataset from JSON text (e.g. a fetched file). */
export function parseDatasetJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new DatasetError([`JSON parse failed: ${err instanceof Error ? err.message : String(err)}`]);
  }
}

export type { Dataset, DatasetEdge, DatasetMeta, DatasetVertex, Confidence, WeightSource };
