/**
 * Unit tests for the generic dataset loader (Phase 3).
 *
 * These use small SYNTHETIC datasets — no venue facts — and exercise every
 * validation rule: meta requirements, vertex rules (ids, names, finite
 * coordinates, confidence, floor), edge rules (ids, endpoints, self-loops,
 * duplicate pairs, weights, weightSource, confidence), error aggregation,
 * graph building, provenance mapping and the connectivity audit.
 */

import { describe, expect, it } from 'vitest';
import { DatasetError, loadDataset, parseDatasetJson } from '../../src/data/loader';
import { WeightedGraph } from '../../src/engine/engine';

/** Raw, unvalidated JSON-like fixture (typed loosely on purpose). */
type Raw = {
  meta: Record<string, unknown>;
  vertices: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
};

const base = (): Raw => ({
  meta: {
    name: 'Mini Test Environment',
    description: 'synthetic fixture for loader tests',
    unit: 'm',
    coordinateSystem: 'local grid: x = east, y = north, z = 0',
    origin: 'vertex a',
    scaleMethod: 'one documented 10 m corridor fixes the scale',
    precision: '±0.5 m',
    referenceDate: '2026',
    fictional: true,
    sources: [{ label: 'test reference', usedFor: 'everything' }],
    assumptions: ['flat terrain'],
  },
  vertices: [
    { id: 'a', name: 'Gate A', type: 'gate', x: 0, y: 0, z: 0, confidence: 'verified' },
    { id: 'b', name: 'Plaza B', type: 'plaza', x: 10, y: 0, z: 0, confidence: 'approximate' },
    { id: 'c', name: 'Room C', type: 'room', x: 10, y: 8, z: 0, confidence: 'unavailable' },
  ],
  edges: [
    { id: 'e-a-b', from: 'a', to: 'b', weight: 10, weightSource: 'measured', kind: 'path', confidence: 'verified' },
    { id: 'e-b-c', from: 'b', to: 'c', weight: 8, weightSource: 'digitized-path', kind: 'indoor', confidence: 'approximate' },
  ],
});

function expectInvalid(raw: Raw, ...fragments: string[]): void {
  let thrown: unknown;
  try {
    loadDataset(raw);
  } catch (err) {
    thrown = err;
  }
  expect(thrown, 'loadDataset should have thrown').toBeInstanceOf(DatasetError);
  const errors = (thrown as DatasetError).errors;
  for (const fragment of fragments) {
    expect(
      errors.some((e) => e.includes(fragment)),
      `expected an error containing "${fragment}", got:\n  ${errors.join('\n  ')}`,
    ).toBe(true);
  }
}

describe('loadDataset — valid datasets', () => {
  it('builds the graph and the full audit report', () => {
    const loaded = loadDataset(base());
    expect(loaded.report.vertexCount).toBe(3);
    expect(loaded.report.edgeCount).toBe(2);
    expect(loaded.report.connectedComponents).toBe(1);
    expect(loaded.report.orphanedVertices).toEqual([]);
    expect(loaded.report.hasCycle).toBe(false);
    expect(loaded.report.datasetName).toBe('Mini Test Environment');
    // the 'unavailable' vertex is honestly reported, not silently dropped
    expect(loaded.report.warnings).toEqual([
      "1 vertex(es) have confidence 'unavailable': c",
    ]);
    expect(loaded.graph).toBeInstanceOf(WeightedGraph);
    expect(loaded.graph.getVertex('b')?.name).toBe('Plaza B');
    expect(loaded.vertices.get('c')?.confidence).toBe('unavailable');
    expect(loaded.edges.get('e-a-b')?.weightSource).toBe('measured');
  });

  it('maps documented-distance onto the engine measured bucket, others 1:1', () => {
    const raw = base();
    raw.edges[0]!.weightSource = 'documented-distance';
    const loaded = loadDataset(raw);
    const engineEdges = new Map<string, string | undefined>();
    for (const e of loaded.graph.edges()) {
      engineEdges.set(`${e.from}|${e.to}`, e.weightSource);
    }
    expect(engineEdges.get('a|b')).toBe('measured');
    expect(engineEdges.get('b|c')).toBe('digitized-path');
  });

  it('falls back to the first vertex when primaryRootId is unknown', () => {
    const raw = base();
    raw.meta.primaryRootId = 'no-such-vertex';
    const loaded = loadDataset(raw); // must not throw
    expect(loaded.report.orphanedVertices).toEqual([]);
  });

  it('reports disconnected components and orphaned vertices', () => {
    const raw = base();
    raw.meta.primaryRootId = 'a';
    raw.vertices.push({ id: 'd', name: 'Island D', type: 'room', x: 99, y: 99, z: 0, confidence: 'approximate' });
    const loaded = loadDataset(raw);
    expect(loaded.report.connectedComponents).toBe(2);
    expect(loaded.report.orphanedVertices).toEqual(['d']);
  });

  it('accepts a valid optional floor value', () => {
    const raw = base();
    raw.vertices[2]!.floor = 1;
    const loaded = loadDataset(raw);
    expect(loaded.vertices.get('c')?.floor).toBe(1);
  });
});

describe('loadDataset — meta validation', () => {
  it('rejects a missing meta object', () => {
    const raw = base();
    raw.meta = {};
    expectInvalid(raw, 'meta.name', 'meta.unit');
  });

  it('rejects a non-metre unit', () => {
    const raw = base();
    raw.meta.unit = 'km';
    expectInvalid(raw, "meta.unit: must be 'm'");
  });

  it('rejects non-string assumptions', () => {
    const raw = base();
    raw.meta.assumptions = [42];
    expectInvalid(raw, 'meta.assumptions');
  });

  it('rejects a source without usedFor', () => {
    const raw = base();
    raw.meta.sources = [{ label: 'x' }];
    expectInvalid(raw, 'meta.sources[0]');
  });
});

describe('loadDataset — vertex validation', () => {
  it('rejects duplicate vertex ids', () => {
    const raw = base();
    raw.vertices[2]!.id = 'a';
    expectInvalid(raw, "duplicate vertex id 'a'");
  });

  it('rejects a missing name', () => {
    const raw = base();
    raw.vertices[1]!.name = '   ';
    expectInvalid(raw, "'name' must be a non-empty string");
  });

  it('rejects non-finite coordinates', () => {
    const raw = base();
    raw.vertices[0]!.y = Number.POSITIVE_INFINITY;
    expectInvalid(raw, "'y' must be a finite number");
  });

  it('rejects string coordinates', () => {
    const raw = base();
    raw.vertices[0]!.x = 'ten';
    expectInvalid(raw, "'x' must be a finite number");
  });

  it('rejects an invalid confidence value', () => {
    const raw = base();
    raw.vertices[1]!.confidence = 'probably-fine';
    expectInvalid(raw, "'confidence' must be one of verified, approximate, unavailable");
  });

  it('rejects a negative floor', () => {
    const raw = base();
    raw.vertices[1]!.floor = -1;
    expectInvalid(raw, "'floor' must be a non-negative integer");
  });

  it('rejects an empty vertex list', () => {
    const raw = base();
    raw.vertices = [];
    expectInvalid(raw, 'vertices: must be a non-empty array');
  });
});

describe('loadDataset — edge validation', () => {
  it('rejects duplicate edge ids', () => {
    const raw = base();
    raw.edges[1]!.id = 'e-a-b';
    expectInvalid(raw, "duplicate edge id 'e-a-b'");
  });

  it('rejects a self-loop', () => {
    const raw = base();
    raw.edges[0]!.to = 'a';
    expectInvalid(raw, 'self-loop');
  });

  it('rejects endpoints that reference unknown vertices', () => {
    const raw = base();
    raw.edges[1]!.to = 'ghost';
    expectInvalid(raw, "endpoint 'ghost' does not match any vertex id");
  });

  it('rejects duplicate undirected pairs', () => {
    const raw = base();
    raw.edges.push({ id: 'e-c-b', from: 'c', to: 'b', weight: 8, weightSource: 'measured', kind: 'path', confidence: 'verified' });
    expectInvalid(raw, "duplicate undirected pair");
  });

  it('rejects zero and negative weights', () => {
    const raw = base();
    raw.edges[0]!.weight = 0;
    expectInvalid(raw, "'weight' must be a finite number > 0");
  });

  it('rejects non-finite weights', () => {
    const raw = base();
    raw.edges[0]!.weight = NaN;
    expectInvalid(raw, "'weight' must be a finite number > 0");
  });

  it('rejects an invalid weightSource', () => {
    const raw = base();
    raw.edges[0]!.weightSource = 'guessed';
    expectInvalid(raw, "'weightSource' must be one of measured, digitized-path, straight-line-approx, documented-distance, unavailable");
  });

  it('rejects weightSource "unavailable" on a routable edge', () => {
    const raw = base();
    raw.edges[0]!.weightSource = 'unavailable';
    expectInvalid(raw, "weightSource 'unavailable' is not routable");
  });

  it('rejects an edge with a bad confidence value', () => {
    const raw = base();
    raw.edges[0]!.confidence = 'unverified-but-true';
    expectInvalid(raw, "'confidence' must be one of verified, approximate, unavailable");
  });
});

describe('loadDataset — error aggregation and robustness', () => {
  it('reports ALL problems in one throw, not just the first', () => {
    const raw = base();
    raw.meta.origin = ''; // missing origin
    raw.vertices[0]!.id = 'a';
    raw.vertices.push({ id: 'a', name: 'Clone', type: 'room', x: 1, y: 1, z: 0, confidence: 'verified' }); // duplicate id
    raw.edges.push({ id: 'e-a-b', from: 'a', to: 'nowhere', weight: -5, weightSource: 'measured', kind: 'path', confidence: 'verified' }); // dup edge id + bad endpoint + bad weight
    expectInvalid(
      raw,
      'meta.origin',
      'duplicate vertex id',
      "duplicate edge id 'e-a-b'",
      "endpoint 'nowhere'",
      "'weight' must be a finite number > 0",
    );
  });

  it('rejects a non-object root', () => {
    expect(() => loadDataset('not an object')).toThrow(DatasetError);
    expect(() => loadDataset(null)).toThrow(DatasetError);
  });
});

describe('parseDatasetJson', () => {
  it('parses valid JSON', () => {
    const parsed = parseDatasetJson('{"a": 1}') as Record<string, unknown>;
    expect(parsed.a).toBe(1);
  });

  it('wraps parse failures in DatasetError', () => {
    expect(() => parseDatasetJson('{oops')).toThrow(DatasetError);
  });
});
