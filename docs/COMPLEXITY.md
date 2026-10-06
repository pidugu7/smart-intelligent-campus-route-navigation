# Complexity Analysis

Time and space analysis for every algorithm and the core data structure
in `src/engine/`. All statements refer to the **actual implementation**,
not the textbook ideal.

Notation: `V` = vertices, `E` = edges. This project's graph is a
moderately dense undirected graph — EPCOT: **V = 37, E = 43** — so
asymptotics are demonstrated on a small, fully traceable graph; the
code paths scale with the analysis below.

## Min-heap (the shared data structure)

Hand-written binary min-heap in
[`src/engine/priority-queue/min-heap.ts`](../src/engine/priority-queue/min-heap.ts).

| Operation | Complexity | Notes |
| --- | --- | --- |
| `push(item)` | **O(log n)** | sift-up from the bottom |
| `pop()` | **O(log n)** | sift-down from the root |
| `peek()` | **O(1)** | inspect the root |
| space | **O(n)** | array-backed |

Items are compared by value first, then by `vertexId` — this is what
makes all traces **deterministic** (equal distances never tie-break
arbitrarily).

**Lazy deletion.** Dijkstra and A\* never decrease a key inside the
heap. Instead, when a better candidate for a vertex appears, a *new*
entry is pushed; stale entries are skipped on `pop()` via a finalized
set. This keeps the heap simple (no `decreaseKey`, no re-heapify book-
keeping) at the cost of at most one stale entry per relaxation — the
practical worst case is O(E) heap entries, each pushed/popped once →
the O((V + E) log V) bound below.

## Dijkstra

```
while heap not empty:
    (d, u) ← pop()                    O(log n)
    if u already finalized: continue   O(1)
    for each edge (u, v, w):           scan adj[u]
        if d + w < dist[v]:            O(1)
            dist[v] ← d + w; parent[v] ← u; push(d + w, v)  O(log n)
return path reconstructed via parent[] O(path length)
```

| | |
| --- | --- |
| **Time** | **O((V + E) log V)** — every vertex/edge enters the heap at most once per relaxation; each heap op is O(log V). |
| **Space** | **O(V + E)** — the graph (adjacency lists), plus `dist`, `parent`, `finalized` (O(V)) and up to O(E) heap entries. |
| Early exit | Stops as soon as the target is finalized — typically far less than a full run. |

Requires **non-negative** weights: the graph constructor rejects
`weight <= 0`, so the invariant is enforced, not assumed.

## A\*

Same loop as Dijkstra, but the heap is ordered by
`f(n) = g(n) + h(n)`:

- `g(n)` — exact cost from the source (grown exactly like Dijkstra's
  `dist`);
- `h(n)` — **Euclidean straight-line distance** from `n` to the target
  (coordinate-based, O(1) per call).

| | |
| --- | --- |
| **Time (worst case)** | **O((V + E) log V)** — identical to Dijkstra (when `h ≡ 0`, A* *is* Dijkstra). |
| **Space** | **O(V + E)** — same as Dijkstra. |
| **Time (typical case)** | often substantially fewer node expansions, because the heap orders candidates by *estimated total cost*, not just distance-so-far. |

### Why the Euclidean heuristic is admissible (and consistent)

Every edge weight in this dataset is

```
weight = 3D geometric length of the edge × factor,   factor ≥ 1
```

so the true cost of any path is **at least** the straight-line distance
of its endpoints:

```
cost(u → v path) ≥ length(u, v)      →      h(u) ≤ true remaining cost   (admissible)
```

and because weights are ≥ Euclidean length, the triangle inequality holds
in cost space, so `h` is **consistent** (monotone). Consequences the
implementation relies on:

1. A\* is **provably optimal** (same guarantee as Dijkstra);
2. a vertex is never re-opened after finalization — the finalized set is
   sufficient, no negative re-expansions needed;
3. `g` values still obey the usual decrease rule.

The caveat (documented in `heuristic.ts`): if a dataset ever used
`factor < 1` (weights shorter than straight-line distance — physically
impossible for walking, but possible in abstract graphs), admissibility
would break and A* could stop being optimal.

### Is A* always faster than Dijkstra?

**No.** Same worst-case bound; the typical-case gain depends on how
informative `h` is relative to the graph shape. On the EPCOT showcase
query (gate-main → pav-morocco) the measured values are **31 expansions
(Dijkstra) vs 15 (A\*)** — a real, but query-specific, difference.
`compareAlgorithms` reports the actual delta per query and can honestly
report 0 (or a negative delta). That is by design: the demo shows a
*measurement*, not a slogan.

## BFS

Unweighted shortest path — every edge costs **one hop**.

| | |
| --- | --- |
| **Time** | **O(V + E)** — every vertex and edge is processed once. |
| **Space** | **O(V)** — hop count per vertex, parent map, FIFO queue. |
| Implementation | array + head pointer; dequeue is an index bump, amortized **O(1)**. (`Array.prototype.shift()` would be O(n) per dequeue → O(V²) total.) |

First discovery of a vertex is at minimum hop depth, because the queue
processes vertices level by level. **BFS does not minimize metres**: on
this weighted dataset its `totalDistance` is the hop count, deliberately
reported in the UI as "edges" next to Dijkstra's metres, so the
difference between the two objectives is visible, not hidden.

## DFS (traversal utilities)

**Iterative, explicit stack** (no recursion — no stack-overflow risk on
deep graphs; O(V) memory instead of call frames).

| | |
| --- | --- |
| **Time** | **O(V + E)** — edge scan per adjacency visit. |
| **Space** | **O(V)** — explicit stack + visited set. |

Used for (all O(V + E)):

- `dfsTraverse` — plain traversal with step recording (drives the
  loader's report and the DFS demo panel);
- `findUnreachable` — vertices not reached from the root (orphans);
- `detectCycle` — reports a **canonical witness edge** (the first
  non-tree edge found) plus the cycle path through the traversal stack.

DFS is deliberately **not** in `AlgorithmId`: `findRoute` accepts
`dijkstra | astar | bfs` only.

## Path reconstruction

After any search, the path is recovered by walking the `parent` map from
target back to source, then reversing: **O(path length)** time, O(path)
extra space. One parent pointer per vertex (O(V)) instead of storing a
full path per vertex (O(V × path)) — the standard space saving. The
walker carries its own visited guard, so a corrupt parent cycle cannot
hang it.

## Alternative route (edge-removal enumeration)

For a primary simple path of `k` edges:

```
for each edge e of the primary:          k times
    clone the graph, remove e            O(V + E) each
    run Dijkstra (early exit)            O((V + E) log V) each
    keep the best simple path ≠ primary
```

| | |
| --- | --- |
| **Time** | **O(k · (V + E) log V)** — exact, and fine for the small k here (k = 10 → ~10 solves). |
| **Space** | **O(V + E)** per clone; the original graph is never touched. |
| **Guarantee** | best cost among **all simple paths distinct from the primary** — precise, documented wording. This is *not* Yen's k-shortest algorithm and is not advertised as one. |

## Blocked-route simulation

`simulateBlockedRoute(graph, from, to, blocks, algo)`:

```
validate every block (both endpoints exist)      O(b)
route on original graph (before)                 one full run
clone graph, remove blocks on the CLONE          O(V + E)
route on the clone (after)                       one full run
delta = before.totalDistance − after.totalDistance (null if either unreachable)
```

| | |
| --- | --- |
| **Time** | two algorithm runs + one O(V + E) clone. |
| **Correctness invariant** | the **original graph is never mutated** (a unit test asserts this). |

## Summary table

| Routine | Time | Space |
| --- | --- | --- |
| MinHeap push / pop | O(log n) | O(n) total |
| MinHeap peek | O(1) | — |
| Dijkstra | O((V + E) log V) | O(V + E) |
| A\* | O((V + E) log V) worst; typically fewer expansions | O(V + E) |
| BFS | O(V + E) | O(V) |
| DFS (all variants) | O(V + E) | O(V) |
| Path reconstruction | O(path) | O(path) |
| Alternative route | O(k · (V + E) log V) | O(V + E) |
| Blocked-route simulation | 2 × algo + O(V + E) | O(V + E) |
| Graph clone | O(V + E) | O(V + E) |
