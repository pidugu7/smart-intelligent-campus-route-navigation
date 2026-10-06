# DSA Engine (Phases 1–2)

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
| `graph/graph.ts` | `WeightedGraph`: undirected weighted graph, adjacency lists, `clone()`, `removeEdge()` | O(V + E) space; O(1) add/lookup |
| `priority-queue/min-heap.ts` | `MinHeap<T>`: hand-written binary min-heap (shared by Dijkstra & A*) | O(log n) push/pop, O(1) peek |
| `trace/step-trace.ts` | `TraceEvent` schema (`start \| visit \| relax \| finalize \| abort`) + `TraceRecorder` | O(1) amortized per event |
| `routing/path-reconstruct.ts` | Predecessor-map backtracking (cycle-safe) | O(path length) |
| `routing/route-result.ts` | `RouteResult` discriminated union | — |
| `routing/find-route.ts` | Public `findRoute()` for all three routing algorithms | see per-algorithm |
| `algorithms/dijkstra.ts` | Dijkstra: greedy SSSP, lazy deletion, early exit | O((V + E) log V) |
| `algorithms/a-star.ts` | A*: f = g + h, Euclidean heuristic (admissible + consistent) | O((V + E) log V) worst case |
| `algorithms/bfs.ts` | BFS: fewest-hop routing, array+head queue | O(V + E) |
| `algorithms/dfs.ts` | DFS: traversal, orphan detection, cycle detection (iterative) | O(V + E) |
| `algorithms/heuristic.ts` | `Heuristic` type + `euclideanHeuristic` (with the admissibility/consistency proof) | O(1) per call |
| `routing/compare.ts` | Dijkstra-vs-A* comparison summaries | 2 × O((V + E) log V) |
| `routing/alternative.ts` | Alternative route via per-edge-removal re-runs | O(\|P\| · (V + E) log V) |
| `routing/metrics.ts` | Estimated walk time at a declared 1.4 m/s | O(1) |
| `simulation/block.ts` | Blocked-path simulation on a cloned graph view | O(V + E) + one extra route |
| `engine.ts` | Public re-export surface (the whole API) | — |

## Public API

```ts
import { WeightedGraph, findRoute, compareAlgorithms, findAlternativeRoute,
         simulateBlockedRoute, estimateWalkTime, findUnreachable, detectCycle }
from './src/engine/engine';

const g = new WeightedGraph();
g.addVertex({ id: 'a', name: 'A', type: 'poi', x: 0, y: 0, z: 0 });
// ...

const result = findRoute(g, 'a', 'd', 'dijkstra' | 'astar' | 'bfs');
const cmp    = compareAlgorithms(g, 'a', 'd');          // Dijkstra vs A*
const alt    = findAlternativeRoute(g, 'a', 'd');       // second-best simple path
const blocked = simulateBlockedRoute(g, 'a', 'd', [{ from: 'a', to: 'b' }]);
const time   = estimateWalkTime(result.totalDistance);  // estimate at 1.4 m/s
const orphans = findUnreachable(g, 'gate-main');        // DFS validation
const cycle  = detectCycle(g);                          // DFS validation
```

## Algorithms — what and why each exists

### Dijkstra (`algorithms/dijkstra.ts`)
Greedy single-source shortest paths for non-negative weights. The
**baseline optimal router**: the reference against which A* is compared.
Min-heap ordered by (distance, id); lazy deletion instead of decrease-key;
early exit when the target is finalized.

- Time: **O((V + E) log V)** · Space: **O(V + E)**

### A* (`algorithms/a-star.ts`)
Dijkstra + heuristic: heap ordered by **f(n) = g(n) + h(n)**. Steers the
search toward the target, so it typically expands far fewer nodes — same
optimal cost (proven, tested). h defaults to Euclidean distance.

Why the heuristic is safe **here** (the viva answer):
1. **Admissible** — our edge weights are `length × factor` with `factor ≥ 1`,
   so the straight-line distance never overestimates the true remaining cost.
2. **Consistent** — triangle inequality + `w(u,v) ≥ |u−v|` give
   `h(u) ≤ w(u,v) + h(v)`, so a finalized vertex is never re-opened.

**A* is NOT unconditionally faster**: with a weak/zero heuristic it
degenerates to Dijkstra (identical trace — tested), and on a uniform grid it
expands exactly as many nodes. The saving depends on h and the graph.

- Time: **O((V + E) log V) worst case**, typically much less · Space: **O(V + E)**

### BFS (`algorithms/bfs.ts`)
Fewest-**hop** routing: every edge costs 1 hop, weights ignored. Different
objective from Dijkstra (edges walked vs metres), so it can return a
different route — e.g. a 10 m direct edge beats a 2 m + 2 m detour for BFS.
Explicit queue (array + head pointer; `Array.shift()` would be O(V²)).

- Time: **O(V + E)** · Space: **O(V)**

### DFS (`algorithms/dfs.ts`)
Not a router (no cost objective) — the **validation tool**:
- `dfsTraverse(g, root)` — reachable component, deterministic order
- `findUnreachable(g, root)` — orphaned places (Phase 3 runs this at load)
- `detectCycle(g, start?)` — undirected back-edge rule; returns a witness edge

Iterative (explicit stack) so large datasets cannot blow the call stack.

- Time: **O(V + E)** · Space: **O(V)**

### Comparison (`routing/compare.ts`)
Runs Dijkstra + A* on the same query, returns per-algorithm summaries
(algorithm, cost, path, nodes expanded, trace steps) plus
`sameOptimalCost` (the A* optimality check) and `nodesExpandedDelta`
(reported as a plain number — may be 0 or negative).

### Alternative route (`routing/alternative.ts`)
For each edge of the primary path: clone the graph, remove that edge,
re-route; keep the cheapest distinct candidate (earliest-edge tie-break →
deterministic). The returned cost is the **true second-best simple-path
cost** (any competing simple path avoids ≥ 1 edge of the primary, and the
re-run with that edge blocked finds exactly that cost). It is *not* a
k-shortest (Yen) algorithm and considers simple paths only.

- Time: **O(|P| · (V + E) log V)** · Space: **O(V + E)** extra

### Blocked-path simulation (`simulation/block.ts`)
Validate blocks → route on the original (`before`) → **clone + remove edges
on the clone only** → route on the view (`after`) → report before/after +
delta (null when a route disappears). The source-of-truth graph is never
mutated — this is what the UI's click-to-block drives in Phase 4.

### Walk time (`routing/metrics.ts`)
`estimateWalkTime(metres)` at the declared **1.4 m/s** assumption (≈ 5 km/h,
standard pedestrian-planning value). Always labelled `isEstimate: true` —
an estimate for display, not a measurement. Dataset-independent.

## Data structures

- **Weighted undirected graph** — adjacency lists on `Map`s: O(V + E) space,
  O(deg v) neighbourhood scans. An adjacency matrix (O(V²)) would be the
  wrong tool for sparse walking networks — a standard viva trade-off answer.
- **Binary min-heap** (from scratch) — the shared priority queue;
  lazy deletion makes stale-entry skipping O(1) on pop.
- **Hash maps/sets** — `distances`, `parent`, `finalized`/`popped`, `visited`.
- **Trace log** — one append-only event schema for all algorithms, which is
  what makes the Phase 4 animation pipeline algorithm-agnostic.

## Viva questions & answers (Phase 2 additions)

**Q: Why is the Euclidean heuristic admissible here?**
A: Edge weights are geometric length × factor with factor ≥ 1, so any real
walk costs at least the straight-line distance. h never overestimates.

**Q: What would break it?**
A: A factor < 1 (e.g. an escalator "shortcut") would let the straight line
overestimate the true cost; A* could then return a suboptimal route. We
either keep factors ≥ 1 or scale the heuristic down.

**Q: Why is A* optimal but not always faster than Dijkstra?**
A: Admissible + consistent h guarantees the same optimal cost. Speed comes
only from h being *informative* for that graph: h = 0 is exactly Dijkstra
(same trace), and on a uniform grid every node is "on the way", so both
expand everything. A* also pays a small h() overhead per relaxation.

**Q: Why can BFS and Dijkstra return different routes?**
A: Different objectives: BFS minimizes the number of edges (hops);
Dijkstra minimizes total metres. A single 10 m edge is 1 hop but costs 10 m;
BFS takes it, Dijkstra walks a cheaper 4 m two-edge detour.

**Q: Why an array + head pointer instead of `shift()` for the BFS queue?**
A: `shift()` is O(n) per dequeue → O(V²) overall. Advancing a pointer is
amortized O(1) → O(V + E).

**Q: Why iterative DFS instead of recursion?**
A: Same O(V + E) time, but worst-case memory stays O(V) heap space instead
of risking a call-stack overflow on a large dataset.

**Q: How does undirected cycle detection work?**
A: During DFS, any edge (u, v) to an already-visited vertex that is *not*
the DFS tree edge joining them closes a cycle: u → v plus the two tree paths
back to their common ancestor. The witness edge is reported, not the full
cycle (that would need the tree paths spliced together).

**Q: What does "alternative route" guarantee — is it the second-shortest path?**
A: Precisely: the returned COST is the minimum cost over all simple paths
distinct from the optimal one (proof: any such path avoids at least one edge
of the primary, and re-running the router with that edge blocked achieves
exactly that cost, never the primary). It is *not* a general k-shortest
(Yen) algorithm and not a list of alternatives — it returns one.

**Q: Why clone the graph for blocked-path simulation?**
A: The original must stay the source of truth for the whole session; a
clone is O(V + E), cheap at campus scale, and makes every simulation
independent and repeatable.

**Q: How do you keep runs reproducible?**
A: Every priority structure is ordered by (priority, vertexId) — a total
order — and all maps are iterated in insertion order, so identical inputs
produce byte-identical traces (asserted in the test suite).

**Q: Where does the walk time come from?**
A: A declared assumption — 1.4 m/s (≈ 5 km/h), the standard pedestrian
planning speed — multiplied by the route length. It is always shown as an
*estimate*; nothing is measured.

## Phased roadmap (this package only grows)

- Phase 1 ✅ engine core: graph, heap, Dijkstra, reconstruction, tracing
- Phase 2 ✅ A*, BFS, DFS, comparison, alternative routes, blocked-path
  simulation, walk-time metrics
- Phase 3: dataset schema, loader + validation (DFS/BFS checks), EPCOT
  dataset (provenance-tracked), integration tests
- Phase 4: Three.js scene, trace replay, search, UI (comparison panel,
  click-to-block, fewest-stops mode)
