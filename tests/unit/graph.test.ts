import { describe, expect, it } from 'vitest';
import { GraphError, WeightedGraph } from '../../src/engine/graph/graph';
import { makeVertex } from '../fixtures/graphs';

describe('WeightedGraph (adjacency-list representation)', () => {
  it('stores and retrieves vertices', () => {
    const g = new WeightedGraph();
    expect(g.vertexCount).toBe(0);
    g.addVertex(makeVertex('a'));
    g.addVertex(makeVertex('b', 'gate'));
    expect(g.vertexCount).toBe(2);
    expect(g.hasVertex('a')).toBe(true);
    expect(g.hasVertex('nope')).toBe(false);
    expect(g.getVertex('b')).toEqual({ id: 'b', name: 'b', type: 'gate', x: 0, y: 0, z: 0 });
    expect(g.getVertex('nope')).toBeUndefined();
  });

  it('rejects duplicate vertex ids', () => {
    const g = new WeightedGraph();
    g.addVertex(makeVertex('a'));
    expect(() => g.addVertex(makeVertex('a'))).toThrow(GraphError);
    expect(() => g.addVertex(makeVertex('a'))).toThrow(/duplicate vertex id "a"/);
  });

  it('rejects vertices with non-finite coordinates', () => {
    const g = new WeightedGraph();
    expect(() => g.addVertex({ id: 'x', name: 'x', type: 'poi', x: Number.NaN, y: 0, z: 0 })).toThrow(
      /non-finite coordinate x/,
    );
    expect(() => g.addVertex({ id: 'y', name: 'y', type: 'poi', x: 0, y: Infinity, z: 0 })).toThrow(
      /non-finite coordinate y/,
    );
  });

  it('stores undirected edges in both directions', () => {
    const g = new WeightedGraph();
    g.addVertex(makeVertex('a'));
    g.addVertex(makeVertex('b'));
    g.addEdge({ from: 'a', to: 'b', weight: 7, kind: 'path' });

    const fromA = g.neighborsOf('a');
    const fromB = g.neighborsOf('b');
    expect(fromA).toHaveLength(1);
    expect(fromA[0]).toEqual({ to: 'b', weight: 7, kind: 'path' });
    expect(fromB).toHaveLength(1);
    expect(fromB[0]).toEqual({ to: 'a', weight: 7, kind: 'path' });
    expect(g.degreeOf('a')).toBe(1);
  });

  it('counts each undirected edge once and lists it in canonical order', () => {
    const g = new WeightedGraph();
    for (const id of ['a', 'b', 'c']) g.addVertex(makeVertex(id));
    g.addEdge({ from: 'b', to: 'a', weight: 1, kind: 'path' }); // added in "wrong" order
    g.addEdge({ from: 'a', to: 'c', weight: 2, kind: 'path' });

    expect(g.edgeCount).toBe(2);
    expect(g.edges()).toEqual([
      { from: 'a', to: 'b', weight: 1, kind: 'path' },
      { from: 'a', to: 'c', weight: 2, kind: 'path' },
    ]);
  });

  it('rejects edges with unknown endpoints', () => {
    const g = new WeightedGraph();
    g.addVertex(makeVertex('a'));
    expect(() => g.addEdge({ from: 'a', to: 'missing', weight: 1, kind: 'path' })).toThrow(
      /unknown vertex "missing"/,
    );
    expect(() => g.addEdge({ from: 'missing', to: 'a', weight: 1, kind: 'path' })).toThrow(
      /unknown vertex "missing"/,
    );
  });

  it('rejects self-loops', () => {
    const g = new WeightedGraph();
    g.addVertex(makeVertex('a'));
    expect(() => g.addEdge({ from: 'a', to: 'a', weight: 1, kind: 'path' })).toThrow(/self-loop/);
  });

  it('rejects non-positive and non-finite weights (Dijkstra precondition)', () => {
    const g = new WeightedGraph();
    g.addVertex(makeVertex('a'));
    g.addVertex(makeVertex('b'));
    for (const weight of [0, -3, Number.NaN, Infinity]) {
      expect(() => g.addEdge({ from: 'a', to: 'b', weight, kind: 'path' }), `weight=${String(weight)}`).toThrow(
        /finite, positive weight/,
      );
    }
  });

  it('rejects duplicate edges in either direction', () => {
    const g = new WeightedGraph();
    g.addVertex(makeVertex('a'));
    g.addVertex(makeVertex('b'));
    g.addEdge({ from: 'a', to: 'b', weight: 1, kind: 'path' });
    expect(() => g.addEdge({ from: 'a', to: 'b', weight: 2, kind: 'path' })).toThrow(/duplicate edge/);
    expect(() => g.addEdge({ from: 'b', to: 'a', weight: 3, kind: 'path' })).toThrow(/duplicate edge/);
  });

  it('returns an empty list for unknown ids instead of throwing', () => {
    const g = new WeightedGraph();
    expect(g.neighborsOf('ghost')).toEqual([]);
    expect(g.degreeOf('ghost')).toBe(0);
  });

  it('returns a defensive copy of the adjacency list', () => {
    const g = new WeightedGraph();
    g.addVertex(makeVertex('a'));
    g.addVertex(makeVertex('b'));
    g.addEdge({ from: 'a', to: 'b', weight: 1, kind: 'path' });
    // Cast away the readonly modifier to prove the array is a private copy.
    const list = g.neighborsOf('a') as unknown as { to: string; weight: number; kind: string }[];
    list.push({ to: 'forged', weight: 1, kind: 'path' });
    expect(g.degreeOf('a')).toBe(1); // graph unchanged
  });

  it('passes through provenance metadata (confidence + weightSource)', () => {
    const g = new WeightedGraph();
    g.addVertex({
      id: 'a',
      name: 'A',
      type: 'poi',
      x: 0,
      y: 0,
      z: 0,
      confidence: 'approximate',
      note: 'digitized from official 2026 map',
    });
    g.addVertex(makeVertex('b'));
    g.addEdge({ from: 'a', to: 'b', weight: 42, kind: 'path', weightSource: 'digitized-path' });

    expect(g.getVertex('a')?.confidence).toBe('approximate');
    expect(g.getVertex('a')?.note).toBe('digitized from official 2026 map');
    expect(g.neighborsOf('a')[0]?.weightSource).toBe('digitized-path');
    expect(g.edges()[0]?.weightSource).toBe('digitized-path');
  });

  it('keeps vertex insertion order stable (determinism for demos)', () => {
    const g = new WeightedGraph();
    for (const id of ['d', 'b', 'a', 'c']) g.addVertex(makeVertex(id));
    expect(g.vertexIds()).toEqual(['d', 'b', 'a', 'c']);
  });
});
