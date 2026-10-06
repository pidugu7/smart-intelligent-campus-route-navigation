# Smart Intelligent Campus Route Navigation System

> A DSA-driven 3D navigation and intelligent route-analysis system.

This project uses a **real, publicly documented environment (EPCOT, Walt
Disney World)** as its graph and demonstrates how classical **data
structures and algorithms** — adjacency lists, a hand-written binary
min-heap, Dijkstra, A\*, BFS and DFS — find, compare, visualize and
dynamically re-route walking paths, with every algorithmic step
**replayable in 3D**.

The DSA engine is the core of the project. Three.js is only the
visualization layer: it never computes a route.

---

## Overview

The system models a real-world environment as a **weighted undirected
graph** and applies classical graph algorithms to it:

| Real world | Graph model |
| --- | --- |
| A location (pavilion, gate, plaza, attraction) | **Vertex** |
| A walkway connecting two locations | **Edge** |
| The walkable length of that connection (metres) | **Edge weight** |

Everything then flows through one pipeline:

```
Dataset (JSON, provenance-tracked)
   → Graph   (validated WeightedGraph: adjacency lists + weights)
   → Algorithm (Dijkstra / A* / BFS)
   → Trace + RouteResult (deterministic step log + optimal path)
   → 3D Visualization (Three.js: scene, route, exploration replay)
   → Result (distance, walk time, work counters, comparison, reroute)
```

Because every algorithm run emits the **same** step-trace schema
(`start / visit / relax / finalize / abort`), one single replay pipeline
can animate Dijkstra, A\* or BFS exactly as it ran — you watch the
priority queue work, node by node, instead of seeing a pre-drawn line.

## Features

- **Dijkstra shortest path** — weighted optimal route, binary min-heap,
  lazy deletion, early exit, full step trace.
- **A\* intelligent shortest path** — `f = g + h` with an admissible,
  consistent Euclidean heuristic; same optimality guarantee, usually fewer
  node expansions.
- **BFS fewest-hop traversal** — unweighted baseline; minimizes edge
  *count*, not metres (deliberately shown next to Dijkstra to make the
  difference visible).
- **DFS traversal** — iterative, explicit stack; used for reachability /
  orphan detection and cycle detection at dataset load (not a routing
  algorithm, and documented as such).
- **Alternative route** — the best cost among **all simple paths distinct
  from the primary** (edge-removal enumeration; *not* Yen's k-shortest
  algorithm, and never advertised as one).
- **Blocked-path simulation** — click a walkway to block it; routing
  re-runs automatically on a **cloned** graph view; the original graph is
  never mutated.
- **Algorithm comparison** — Dijkstra vs A\* side by side: same optimal
  cost check plus honestly measured node-expansion deltas (A\* is *not*
  claimed to always win).
- **Trace replay** — play / pause / reset / speed control over the
  engine's exact event log, with a live "current event" readout.
- **Interactive 3D visualization** — orbit / zoom / pan; zoom-aware
  labels; route emphasis that dims (never removes) the rest of the graph.
- **Searchable locations** — keyboard-accessible typeahead for start and
  destination.
- **Estimated walking time** — at a declared 1.4 m/s (≈ 5 km/h), always
  labelled as an estimate, never a measurement.
- **Data provenance** — every spatial value carries a confidence
  (`verified / approximate / unavailable`); the full record ships with the
  dataset.
- **Demo mode** — one button loads the showcase query (Germany → Morocco,
  Dijkstra) without bypassing the algorithm.

## Architecture

```
src/
├── engine/                    # pure TypeScript DSA engine (no DOM, no Three.js)
│   ├── graph/                 #   WeightedGraph (adjacency lists), Vertex, Edge
│   ├── priority-queue/        #   hand-written binary MinHeap
│   ├── algorithms/            #   dijkstra, a-star (+ euclidean heuristic), bfs, dfs
│   ├── routing/               #   findRoute, path reconstruction, comparison,
│   │                          #   alternative routes, walk-time metrics
│   ├── simulation/            #   blocked-edge simulation (clone-then-mutate)
│   ├── trace/                 #   deterministic step trace (TraceEvent, TraceRecorder)
│   └── engine.ts              #   public barrel
│
├── data/                      # data-driven dataset layer (venue facts live ONLY here)
│   ├── schema.ts              #   generic dataset schema (no venue logic)
│   ├── loader.ts              #   validate → WeightedGraph + audit report
│   └── datasets/
│       ├── epcot/             #   the real-world dataset + provenance docs
│       └── _template/         #   schema-complete example for new datasets
│
├── viz/                       # Three.js visualization (consumes engine output only)
│   ├── layout.ts              #   dataset → scene geometry (pure math)
│   ├── campus-mesh.ts         #   procedural scene: ground, walkways, buildings, labels
│   ├── scene.ts               #   renderer, camera, orbit controls, framing
│   ├── route-layer.ts         #   markers, route tubes, emphasis, hover, blocks
│   ├── replay.ts              #   TraceReplayer (pure, unit-tested)
│   └── label-policy.ts        #   zoom-aware label visibility (pure, unit-tested)
│
├── app/                       # UI wiring
│   ├── main.ts                #   entry point: dataset → graph → engine → viz
│   ├── style.css              #   calm dark UI
│   └── ui/                    #   controls (sidebar), readout (result panels), search
│
└── tests/                     # 211 tests: unit (engine/viz pure layers) + integration
```

**Dependency direction (strict, one way):**

```
DATA  →  GRAPH  →  ALGORITHMS  →  TRACE / ROUTE RESULTS  →  VISUALIZATION  →  UI
```

- The **engine does not depend on the DOM, Three.js, or any venue**. It
  runs identically in Node (tests) and in the browser.
- The **visualization consumes engine results and TraceEvents** — it
  contains no pathfinding logic of any kind.
- Swapping the dataset (e.g. a real university campus) requires **zero
  engine changes** — see [`src/data/ADDING_A_DATASET.md`](src/data/ADDING_A_DATASET.md).

More detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Algorithms

### Dijkstra — weighted shortest path
- **Objective:** minimize total distance (metres).
- **Data structure:** hand-written binary min-heap of `(distance, vertexId)`
  candidates, with lazy deletion (stale entries skipped on pop).
- **Complexity:** O((V + E) log V) time, O(V + E) space.
- Non-negative weights are enforced by the graph itself.

### A\* — goal-directed weighted shortest path
- **Objective:** same as Dijkstra — provably optimal.
- **Formula:** `f(n) = g(n) + h(n)`, where `g` is the actual cost from the
  source and `h` is the **Euclidean straight-line distance to the target**.
- **Why the heuristic is safe:** every edge weight in this dataset is
  *geometric length × factor (factor ≥ 1)*, so `h` never overestimates
  (admissible) and satisfies the triangle-inequality consistency — a
  finalized vertex is never re-opened.
- **Complexity:** O((V + E) log V) worst case (identical to Dijkstra);
  typically far fewer expansions. **Not** unconditionally faster — the
  comparison panel reports the measured difference per query.

### BFS — fewest hops
- **Objective:** minimize the **number of edges**, not distance.
- **Data structure:** FIFO queue (array + head pointer — amortized O(1)
  dequeue, avoiding the O(n) of `Array.prototype.shift`).
- **Complexity:** O(V + E) time, O(V) space.
- On this weighted graph its answer is a different (usually longer in
  metres) route — that contrast is intentional and documented in the UI.

### DFS — traversal
- **Objective:** none — a traversal technique, **not** a shortest-path
  algorithm.
- **Data structure:** explicit stack (iterative, O(V) memory).
- **Used for:** reachability / orphan detection and cycle detection at
  dataset load, both shown in the loader's audit report.

### Comparison at a glance

| Algorithm | Objective            | Data structure        | Weighted? | Typical complexity   |
| --------- | -------------------- | --------------------- | --------- | -------------------- |
| Dijkstra  | minimum total cost   | binary min-heap       | yes       | O((V + E) log V)     |
| A\*       | minimum total cost   | min-heap ordered by f | yes       | O((V + E) log V) worst case, usually fewer expansions |
| BFS       | minimum number of hops | FIFO queue          | **no**    | O(V + E)             |
| DFS       | traversal only       | explicit stack        | n/a       | O(V + E)             |

Full analysis: [`docs/COMPLEXITY.md`](docs/COMPLEXITY.md).

## Dataset — EPCOT (provenance-tracked)

| Property | Value |
| --- | --- |
| Vertices | 37 (gates, plazas, areas, pavilions, landmarks, attractions) |
| Edges | 43 walkable connections |
| Coordinate system | local 2-D grid in **metres**, origin at the lagoon centre |
| Geometry | **digitized approximate geometry** |
| Calibration | lagoon promenade perimeter reconstructed at 1952 m vs the documented ≈ 1.2 mi (≈ 1931 m) → **+1.1 %** |

This dataset is an **original, schematic, data-only model** of publicly
documented EPCOT layout facts. Coordinates and edge distances are
**approximate** (±20–50 m / ±10–20 %) and are **not survey-grade**. The
dataset is intended for DSA demonstration, not navigation-grade
positioning. Every value carries a confidence level
(`verified` / `approximate` / `unavailable`); the full record lives in
[`src/data/datasets/epcot/provenance.md`](src/data/datasets/epcot/provenance.md).

### Asset policy

- **No Disney map artwork, logos, or copyrighted map imagery** in this
  repository. Official maps were *viewed as a reference only*; no image
  file is stored here.
- The 3D scene uses **original, programmatically generated geometry**
  (primitives only) — no external proprietary 3D assets.
- Only **factual location names and spatial relationships** are
  represented. "EPCOT" and attraction names remain the property of their
  owners; this project is an independent, non-commercial academic
  demonstration.

## Limitations

Honest, by design:

- **Approximate geometry** — every coordinate and weight is digitized/
  estimated; no coordinate is claimed exact.
- **Static dataset** — no real-time crowds, opening hours, events, or
  construction updates (block simulation is a *simulation*, not live data).
- **No GPS, no indoor navigation, no elevation modeling, no transit.**
- **No survey-grade coordinates** — do not use this for real-world
  navigation.
- **A\* is not guaranteed to expand fewer nodes on every graph or query** —
  its advantage depends on the heuristic and the graph; the comparison
  panel reports what actually happened.
- **BFS optimizes hops, not weighted distance** — its "cost" is edge count.
- **The alternative route is not Yen's algorithm** — it is the best cost
  among all *simple* paths distinct from the primary (a precise,
  documented guarantee).
- **Walk time is an estimate** at a declared 1.4 m/s, not a measurement.

## How to run

Prerequisites: Node.js ≥ 20.19.

```bash
npm install        # install dependencies
npm run dev        # start the dev server (http://localhost:5173)
npm test           # run the full test suite (vitest)
npm run typecheck  # TypeScript strict check (tsc --noEmit)
npm run build      # production build (dist/)
npm run preview    # serve the production build locally
```

A classroom demonstration script (3–5 minutes) is in
[`docs/DEMO.md`](docs/DEMO.md). The in-app **Demo: Germany → Morocco**
button loads the showcase query with one click.

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | layer diagram, dependency rules, data flow, determinism |
| [`docs/COMPLEXITY.md`](docs/COMPLEXITY.md) | time/space analysis for every algorithm and the heap |
| [`docs/DEMO.md`](docs/DEMO.md) | 3–5 minute classroom demo script |
| [`docs/VIVA.md`](docs/VIVA.md) | ~30 viva/oral-exam questions with answers reflecting the actual code |
| [`docs/SCREENSHOTS.md`](docs/SCREENSHOTS.md) | recommended screenshots for reports and slides |
| [`src/engine/README.md`](src/engine/README.md) | engine API reference |
| [`src/data/ADDING_A_DATASET.md`](src/data/ADDING_A_DATASET.md) | how to add a new environment (e.g. a real campus) without engine changes |

## Testing

211 tests, no skips:

- **Unit** — algorithm correctness (optimality, expansion-order
  properties, determinism), heap invariants, trace schema, path
  reconstruction (including cycle guards), alternative-route guarantees,
  blocked-route simulation, loader validation, label policy, replay driver.
- **Integration** — the real EPCOT dataset end-to-end, including
  **known-answer routing values** (e.g. gate-main → pav-morocco = 1010 m
  via Dijkstra; A\* = same cost with 15 vs 31 expansions), the lagoon
  pinch-point block scenario, and the alternative-route guarantee.

## License

MIT — see [`LICENSE`](LICENSE). This is an academic DSA demonstration;
it contains no proprietary assets.
