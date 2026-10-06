# Architecture

> ⚠️ **Historical snapshot (Phase 3).** This document describes the
> project as of Phase 3 and is kept for reference. The current
> architecture — including the Three.js visualization layer, the UI,
> and the full test setup — is documented in
> **[ARCHITECTURE.md](ARCHITECTURE.md)**.

> Phase 3 snapshot. The project stays a static site (no backend): a **pure
> TypeScript graph engine** + a **data-driven dataset layer** now, a Three.js
> visualization and UI in Phase 4.

## Layering

```
┌──────────────────────────────────────────────────────────────────┐
│ Phase 4 (later):  src/viz/*  (Three.js scene, route layer,       │
│                   trace replay)  +  src/app/*  (UI controls)     │
├──────────────────────────────────────────────────────────────────┤
│ Data layer (Phase 3)                                             │
│   src/data/schema.ts    generic dataset schema (no venue logic)  │
│   src/data/loader.ts    validate → build WeightedGraph → audit   │
│   src/data/datasets/*   one folder per environment               │
│       epcot/            real-world dataset + provenance docs     │
│       _template/        schema-complete fictional example        │
├──────────────────────────────────────────────────────────────────┤
│ Engine (Phases 1–2) — pure TS, zero DOM/browser/Three.js deps    │
│   graph/          WeightedGraph, Vertex, Edge, GraphError        │
│   priority-queue/ hand-written MinHeap (dijkstra + a-star use it)│
│   algorithms/     dijkstra, a-star (+euclidean heuristic), bfs,  │
│                   dfs (traverse / findUnreachable / detectCycle) │
│   routing/        findRoute, path reconstruction, algorithm      │
│                   comparison, alternative routes, walk metrics   │
│   simulation/     blocked-edge simulation                        │
│   trace/          deterministic step trace (for Phase 4 replay)  │
│   engine.ts       public barrel                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Key invariants

- **Engine is generic and data-driven.** It knows vertices, edges, weights —
  nothing about EPCOT, campuses, or any venue. The Phase 4 UI will swap
  datasets without engine changes.
- **Dataset ≠ engine.** `src/data/` is the only place venue facts live. The
  loader (`src/data/loader.ts`) is the single boundary: raw JSON → validated
  → `WeightedGraph` + audit `DatasetReport`.
- **Honesty in data, not in UI.** Every spatial value carries `confidence`
  (`verified | approximate | unavailable`) and every edge a `weightSource`.
  The loader validates these; `provenance.md` next to each dataset explains
  them. Approximate values are never silently upgraded.
- **Deterministic traces.** Every algorithm run returns a full step trace
  (pushes/pops/settled/relaxations); Phase 4 replays it at human speed.

## Data flow (Phase 3)

```
dataset.json ──parse/validate──▶ LoadedDataset
  (schema.ts)     (loader.ts)      ├─ dataset   (original, typed)
                                   ├─ vertices/edges Maps (full schema fields)
                                   ├─ graph: WeightedGraph  ──▶ dijkstra / aStar / bfs / dfs
                                   └─ report: { counts, connectedComponents,
                                                orphanedVertices, hasCycle, warnings }
```

## Testing strategy

- **Unit** (`tests/unit/`): engine behaviour on small synthetic graphs —
  optimality, expansion-order properties, heap invariants, trace determinism,
  validation rules of the **loader** (duplicate ids, bad confidence, missing
  endpoints, self-loops, duplicate pairs, `unavailable` edges, …).
- **Integration** (`tests/integration/`): the **real dataset** end-to-end —
  it loads, it builds, key documented locations exist, it is reachable, and
  all five algorithms behave on it (including blocked-edge and
  alternative-route scenarios). Numeric assertions are limited to what the
  dataset's provenance supports (e.g. EPCOT's documented lagoon perimeter).

## Complexity notes (viva-relevant)

| Algorithm | Time (V vertices, E edges, H = binary heap) | Space |
| --- | --- | --- |
| Dijkstra (MinHeap, early exit) | O((V + E) log V) | O(V + E) |
| A* (MinHeap, admissible heuristic) | O((V + E) log V) worst case; fewer expansions in practice when the heuristic is informative (depends on graph + heuristic — never "always faster") | O(V + E) |
| BFS | O(V + E) | O(V + E) |
| DFS | O(V + E) | O(V + E) |
| MinHeap push/pop | O(log n) | O(n) |

A* optimality requires an **admissible** heuristic (never overestimates the
true remaining cost); `euclideanHeuristic` on metric data is admissible
because every edge weight here is ≥ the straight-line distance between its
endpoints (straight-line weights are exact chords; the rest are `ceil` of
the chord or digitized along it).
