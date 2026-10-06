# Architecture

How the Smart Intelligent Campus Route Navigation System is structured,
and why the layers are separated the way they are.

> The historical [`architecture.md`](architecture.md) is a Phase-3
> snapshot and is kept for reference; **this file describes the current
> architecture.**

## The core idea: one pipeline, one direction

```
┌────────────┐    ┌────────────┐    ┌───────────────┐    ┌───────────────────┐    ┌────────────┐
│   DATA     │ →  │   GRAPH    │ →  │  ALGORITHMS   │ →  │ TRACE + ROUTE     │ →  │   VISUAL-  │
│ (dataset   │    │(Weighted-  │    │ Dijkstra      │    │ RESULTS           │    │  IZATION   │
│  JSON)     │    │ Graph, adj │    │ A* / BFS      │    │ (deterministic    │    │ (Three.js) │
│            │    │  lists)    │    │ DFS (traversal│    │  step log)        │    │            │
│            │    │            │    │  utilities)   │    │                   │    │            │
└────────────┘    └────────────┘    └───────────────┘    └───────────────────┘    └────────────┘
                                                                                         │
                          ┌────────────────────────────────────────────────────────────────┘
                          ↓
                    ┌────────────┐
                    │     UI     │  ← user controls in, results + replay out
                    └────────────┘
```

**Rules that make the diagram honest:**

1. **The engine depends on nothing outside TypeScript.** No DOM, no
   Three.js, no venue facts. The engine is unit-tested in Node and could
   be reused in a CLI, a server, or another visualization unchanged.
2. **The visualization contains no pathfinding.** Three.js code consumes
   `RouteResult`s and `TraceEvent`s and draws them. Every pixel of
   "work" shown in the scene comes from the engine's event log.
3. **Venue facts live only in `src/data/`.** The schema, loader, engine,
   and scene code all treat the environment as an opaque vertex/edge
   list with metres. Swapping EPCOT for a real university campus is a
   dataset change, not a code change (see
   [`src/data/ADDING_A_DATASET.md`](../src/data/ADDING_A_DATASET.md)).

## Layers in `src/`

```
src/
├── engine/                  # ── DSA core (pure TS) ─────────────────────────
│   ├── graph/graph.ts       #    WeightedGraph: Map<vertexId, {id, x, y, z}>,
│   │                        #    adjacency lists, positive-weight guard,
│   │                        #    O(V+E) clone(), canonical edge keys
│   ├── priority-queue/      #    hand-written binary MinHeap:
│   │                        #    push/pop O(log n), peek O(1)
│   ├── algorithms/
│   │   ├── dijkstra.ts      #    early exit at target; lazy deletion via
│   │   │                    #    finalized set; (distance, id) ordering
│   │   ├── a-star.ts        #    f = g + h; euclideanHeuristic(target);
│   │   │                    #    admissibility documented in heuristic.ts
│   │   ├── bfs.ts           #    array + head-pointer queue; hop counts
│   │   └── dfs.ts           #    ITERATIVE explicit stack: traverse,
│   │                        #    findUnreachable, detectCycle (witness edge)
│   ├── routing/
│   │   ├── find-route.ts    #    AlgorithmId = dijkstra | astar | bfs (DFS
│   │   │                    #    deliberately excluded from routing)
│   │   ├── path-reconstruct.ts  # parent-pointer walk + reverse, O(path),
│   │   │                    #    cycle-guarded
│   │   ├── compare-algorithms.ts #  Dijkstra vs A*: same-optimal-cost check
│   │   │                    #    + measured nodesExpandedDelta
│   │   ├── find-alternative-route.ts # best cost among ALL SIMPLE paths
│   │   │                    #    distinct from the primary (edge-removal
│   │   │                    #    enumeration — NOT Yen's k-shortest)
│   │   └── metrics.ts       #    estimateWalkTime @ declared 1.4 m/s
│   ├── simulation/block.ts  #    simulateBlockedRoute: validate → before on
│   │                        #    original → clone → remove edges on clone →
│   │                        #    after → delta (null when either side
│   │                        #    unreachable); original never mutated
│   ├── trace/               #    TraceEvent union (start/visit/relax/
│   │                        #    finalize/abort) + TraceRecorder
│   └── engine.ts            #    public barrel
│
├── data/                    # ── data-driven dataset layer ─────────────────
│   ├── schema.ts            #    VenueDataset: vertices (id, label, kind,
│   │                        #    x/y/z in metres), edges (from, to,
│   │                        #    weight, kind, confidence)
│   ├── loader.ts            #    loadDataset: validate schema → build
│   │                        #    WeightedGraph → audit report
│   │                        #    (DFS connectedComponents, orphanedVertices,
│   │                        #    hasCycle)
│   └── datasets/epcot/      #    37 vertices / 43 edges + provenance.md
│
├── viz/                     # ── Three.js visualization ────────────────────
│   ├── layout.ts            #    pure: dataset → scene-space geometry
│   │                        #    (verified by tests without WebGL)
│   ├── campus-mesh.ts       #    procedural scene: ground disc, lagoon,
│   │                        #    promenade ring, walkway tubes, buildings,
│   │                        #    sprite labels
│   ├── scene.ts             #    renderer, camera, OrbitControls,
│   │                        #    deterministic bounds-based framing
│   ├── route-layer.ts       #    start/target markers, route tubes, pulse
│   │                        #    cursor, visited/relaxation highlights,
│   │                        #    edge hover, block markers, emphasis
│   ├── replay.ts            #    TraceReplayer: pure tick(dt) over the
│   │                        #    engine event log (unit-tested); speed
│   │                        #    clamp [0.5, 120]
│   └── label-policy.ts      #    zoom-aware label tiers, exclusive-bounds
│                            #    intersection culling (pure, unit-tested)
│
├── app/                     # ── UI wiring ─────────────────────────────────
│   ├── main.ts              #    entry: dataset → graph → engine calls →
│   │                        #    viz sync; all button wiring
│   ├── style.css            #    calm dark UI (grid/flex/minmax, no zoom
│   │                        #    hacks; comfortable at 100% zoom)
│   └── ui/
│       ├── controls.ts      #    sidebar: search selects, algorithm,
│       │                    #    buttons (find/demo/compare/alternative/
│       │                    #    reset/camera), block mode, labels, provenance
│       ├── readout.ts       #    result cards: route, comparison,
│       │                    #    alternative, blocked simulation; trace
│       │                    #    event readout
│       └── search.ts        #    typeahead with keyboard support +
│                            #    combobox/listbox a11y, graceful empty state
│
└── tests/                   # 211 tests (unit + integration), no skips
```

## Data flow for one click

```
user clicks "Find route"
   │  (state: startId, targetId, algorithmId)
   ▼
engine.findRoute(graph, start, target, algo)
   │  runs the algorithm, records TraceEvents,
   │  returns RouteResult { status, path, totalDistance,
   │      nodesExpanded, relaxations, trace, alternative? }
   ▼
UI readout panels render the result (distance, hop count,
estimated walk time, work counters)
   ▼
viz.routeLayer.showRoute(result)          → route tube + markers + emphasis
viz.replayer.load(result.trace) + play()  → animates the exact engine events
```

If `status === 'unreachable'`, the result card says so with the abort
reason and the replay still animates the full search that proved it.

## Why separate the layers? (the viva answer)

- **Testability** — engine correctness is proved by Node unit tests
  (optimality, determinism, invariants) with no browser or GPU involved.
- **Reusability** — the same engine would power a CLI, a server API, or a
  different front-end.
- **Honesty** — the demo always shows what the *algorithms* did, because
  the visualization cannot "cheat": it only draws the engine's output.
- **Swappability** — the dataset is data, not code; a new environment is
  a JSON file + loader validation.

## Determinism

The engine produces **identical results for identical inputs**, on every
run:

- heap ordering is `(value, vertexId)` — stable under equal distances;
- adjacency lists preserve dataset edge order;
- TraceEvents are therefore byte-for-byte reproducible.

The integration tests pin this: e.g. gate-main → pav-morocco is always
1010 m with 31 Dijkstra expansions and 70 trace events.
