import { describe, expect, it } from 'vitest';
import { detectCycle, dfsTraverse, findUnreachable } from '../../src/engine/algorithms/dfs';
import { GraphError, WeightedGraph } from '../../src/engine/graph/graph';
import { disconnectedGraph, lineGraph, makeVertex, ringGraph, tieGraph } from '../fixtures/graphs';

describe('DFS (traversal & reachability validation)', () => {
  it('traverses the connected component in a deterministic order', () => {
    const { visitedInOrder, reachable } = dfsTraverse(ringGraph(), 'n0');
    // stack: [n0] -> pop n0, push n1, n4 -> pop n4, push n3 -> pop n3, push n2
    //       -> pop n2 (n1 already queued) -> pop n1 -> duplicate n1 skipped
    expect(visitedInOrder).toEqual(['n0', 'n4', 'n3', 'n2', 'n1']);
    expect(reachable.size).toBe(5);
  });

  it('is deterministic across runs', () => {
    const g = tieGraph();
    const first = dfsTraverse(g, 'a');
    const second = dfsTraverse(g, 'a');
    expect(first.visitedInOrder).toEqual(second.visitedInOrder);
  });

  it('finds unreachable (orphaned) vertices relative to a root', () => {
    const g = disconnectedGraph();
    expect(findUnreachable(g, 'a')).toEqual(['x', 'y']);
    expect(findUnreachable(g, 'x')).toEqual(['a', 'b']);
  });

  it('reports no orphans on a fully connected graph', () => {
    expect(findUnreachable(ringGraph(), 'n0')).toEqual([]);
  });

  it('throws GraphError for an unknown root', () => {
    expect(() => dfsTraverse(lineGraph(), 'ghost')).toThrow(GraphError);
    expect(() => findUnreachable(lineGraph(), 'ghost')).toThrow(GraphError);
  });

  it('is generic: works on any WeightedGraph (here, a hand-built one)', () => {
    const g = new WeightedGraph();
    for (const id of ['a', 'b']) g.addVertex(makeVertex(id));
    g.addEdge({ from: 'a', to: 'b', weight: 1, kind: 'path' });
    expect(findUnreachable(g, 'a')).toEqual([]);
    const t = dfsTraverse(g, 'a');
    expect(t.visitedInOrder).toEqual(['a', 'b']);
  });
});

describe('DFS cycle detection (undirected)', () => {
  it('a tree (line graph) has no cycle', () => {
    const result = detectCycle(lineGraph());
    expect(result.hasCycle).toBe(false);
    expect(result.witnessEdge).toBeNull();
  });

  it('detects the 4-cycle in the diamond', () => {
    const g = tieGraph(); // a-b-d-c-a is a cycle
    const result = detectCycle(g);
    expect(result.hasCycle).toBe(true);
    expect(result.witnessEdge).not.toBeNull();
    // the witness must be a real, non-tree edge of the graph
    if (result.witnessEdge !== null) {
      expect(g.neighborsOf(result.witnessEdge.from).some((e) => e.to === result.witnessEdge!.to)).toBe(true);
    }
  });

  it('detects the ring cycle', () => {
    expect(detectCycle(ringGraph()).hasCycle).toBe(true);
  });

  it('scans ALL components when no start is given (cycle in the second component)', () => {
    const g = new WeightedGraph();
    for (const id of ['a', 'b', 'x', 'y', 'z']) g.addVertex(makeVertex(id));
    g.addEdge({ from: 'a', to: 'b', weight: 1, kind: 'path' }); // tree component
    g.addEdge({ from: 'x', to: 'y', weight: 1, kind: 'path' }); // cycle component
    g.addEdge({ from: 'y', to: 'z', weight: 1, kind: 'path' });
    g.addEdge({ from: 'z', to: 'x', weight: 1, kind: 'path' });
    expect(detectCycle(g).hasCycle).toBe(true);
  });

  it('can restrict detection to a single component', () => {
    const g = new WeightedGraph();
    for (const id of ['a', 'b', 'x', 'y', 'z']) g.addVertex(makeVertex(id));
    g.addEdge({ from: 'a', to: 'b', weight: 1, kind: 'path' });
    g.addEdge({ from: 'x', to: 'y', weight: 1, kind: 'path' });
    g.addEdge({ from: 'y', to: 'z', weight: 1, kind: 'path' });
    g.addEdge({ from: 'z', to: 'x', weight: 1, kind: 'path' });
    expect(detectCycle(g, 'a').hasCycle).toBe(false); // a's component is a tree
    expect(detectCycle(g, 'x').hasCycle).toBe(true); // x's component is a triangle
  });

  it('reports a deterministic first witness across runs', () => {
    const first = detectCycle(tieGraph());
    const second = detectCycle(tieGraph());
    expect(first).toEqual(second);
  });
});
