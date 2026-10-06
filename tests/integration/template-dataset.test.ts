/**
 * Integration test — the generic template dataset.
 *
 * The template must stay schema-valid (it is what new datasets are copied
 * from) and must demonstrate the loader's honesty audit: the deliberately
 * 'unavailable' + disconnected vertex 'loc-d' is reported, not dropped.
 */

import { describe, expect, it } from 'vitest';
import template from '../../src/data/datasets/_template/dataset.json';
import { loadDataset } from '../../src/data/loader';

describe('template dataset', () => {
  it('remains schema-valid and loads into a graph', () => {
    const loaded = loadDataset(template);
    expect(loaded.report.vertexCount).toBe(4);
    expect(loaded.report.edgeCount).toBe(3);
    expect(loaded.report.hasCycle).toBe(true);
    expect(loaded.graph.hasVertex('loc-a')).toBe(true);
  });

  it('demonstrates the honesty audit for an unavailable vertex', () => {
    const loaded = loadDataset(template);
    // 'loc-d' is deliberately unavailable and disconnected:
    expect(loaded.report.connectedComponents).toBe(2);
    expect(loaded.report.orphanedVertices).toEqual(['loc-d']);
    expect(loaded.report.warnings.some((w) => w.includes('unavailable'))).toBe(true);
    expect(loaded.vertices.get('loc-d')?.confidence).toBe('unavailable');
  });
});
