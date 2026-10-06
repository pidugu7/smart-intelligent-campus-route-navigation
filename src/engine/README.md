# DSA Engine (Phase 1)

The pure-TypeScript core of the Smart Intelligent Campus Route Navigation
System. **Zero DOM, zero Three.js, zero dataset knowledge** — this package
routes whatever `WeightedGraph` it is handed, which is what lets a later
dataset (EPCOT today, Amrita Bengaluru tomorrow) be swapped in without
touching any algorithm code.

## Modules

| File | Responsibility | Key complexity |
| --- | --- | --- |
| `graph/vertex.ts` | Vertex model + `Confidence` provenance tags | — |
| `graph/edge.ts` | Edge model + `WeightSource` provenance tags | — |
| `graph/graph.ts` | `WeightedGraph`: undirected weighted graph, adjacency lists | O(V + E) space; O(1) add/lookup |
| `priority-queue/min-heap.ts` | `MinHeap<T>`: hand-written binary min-heap | O(log n) push/pop, O(1) peek |
| `trace/step-trace.ts` | `TraceEvent` schema + `TraceRecorder` log | O(1) amortized per event |
| `routing/path-reconstruct.ts` | Predecessor-map backtracking | O(path length) |
| `routing/route-result.ts` | `RouteResult` discriminated union | — |
| `algorithms/dijkstra.ts` | Dijkstra with lazy deletion + tracing | O((V + E) log V) time |
| `engine.ts` | Public API: `findRoute()` + re-exports | — |

## Public API

```ts
import { WeightedGraph, findRoute } from './src/engine/engine';

const g = new WeightedGraph();
g.addVertex({ id: 'a', name: 'A', type: 'poi', x: 0, y: 0, z: 0 });
// ... more vertices/edges ...

const result = findRoute(g, 'a', 'd', 'dijkstra');
if (result.status === 'ok') {
  console.log(result.path, result.totalDistance, result.nodesExpanded);
  // result.trace is the full execution log (start / visit / relax / finalize)
}
```

## Design notes (viva-ready)

- **Adjacency list vs adjacency matrix** — walking networks are sparse
  (deg ≪ V), so O(V + E) lists beat O(V²) matrices in both space and
  neighbourhood-scan time. See the comment on `WeightedGraph`.
- **Lazy deletion vs decrease-key** — Dijkstra pushes a new heap entry when
  a distance improves and skips stale entries on pop. Simpler code, same
  O((V + E) log V) bound, heap at most O(V + E) entries.
- **Determinism** — the heap comparator orders by (distance, id), so two
  runs over the same graph produce identical traces; demos and tests rely
  on this.
- **Confidence system** — `Vertex.confidence` and `Edge.weightSource` are
  pass-through provenance tags (`verified` / `approximate` / `unavailable`);
  the engine carries them, the UI displays them.
- **Precondition** — weights must be finite and > 0 (enforced by
  `WeightedGraph.addEdge`). Negative weights would require Bellman-Ford,
  which walking networks never need.

## Phased roadmap (this package only grows)

- Phase 2: A*, BFS, DFS, Dijkstra-vs-A* comparison, alternative routes,
  blocked-path simulation — same types, no API changes.
- Phase 3: dataset schema, loader + validation, EPCOT dataset (provenance
  tracked), integration tests.
- Phase 4: Three.js scene, trace replay, search, UI.
