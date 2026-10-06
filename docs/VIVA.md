# Viva / Oral Examination Guide (~30 Questions)

Every answer below reflects the **actual implementation** in this
repository — file names, data-structure choices and numeric values are
the real ones. Use them to prepare; the numbers are pinned by
integration tests, so they will reproduce in front of an examiner.

## 1. Graph fundamentals

**Q1. What is a graph, and how does this project use one?**
A graph is a set of vertices connected by edges. Here, each walkable
location (gate, plaza, pavilion, landmark, attraction) is a **vertex**
with 2-D local coordinates in metres, and each walkway is an
**undirected edge** whose **weight is the walkable length in metres**.
The whole routing question — "shortest walking route from A to B" —
becomes a classic weighted shortest-path problem on that graph.

**Q2. Why a weighted graph instead of an unweighted one?**
Because walkways have different physical lengths and the user's
objective is total walking distance. An unweighted model (BFS) can only
minimize the *number of edges*, which is usually the wrong objective —
a single 80 m walkway beats a 40 m + 45 m detour in metres. We keep BFS
as the baseline precisely to show this difference.

**Q3. Why an adjacency list and not an adjacency matrix?**
The graph is sparse (43 edges vs 37 vertices, O(V²) cells in a matrix,
most of them empty). Adjacency lists give O(V + E) space, let each
algorithm scan *only the real neighbours* of a vertex, and make adding,
removing and cloning edges straightforward. The implementation is a
`Map<vertexId, {id, x, y, z}>` plus a parallel
`Map<vertexId, Edge[]>` in `WeightedGraph`.

**Q4. How are undirected edges stored, and how do you avoid double
counting?**
`addEdge(a, b)` inserts one directed entry into each endpoint's list.
Duplicate detection and counting use a **canonical edge key** —
`min(id) \u0000 max(id)` — in a `Set`, so (a,b) and (b,a) are the same key.
The stored weight also guards against contradictory weights for the same
edge, and `weight <= 0` is rejected — which is exactly what Dijkstra and
A\* require (non-negative weights).

## 2. Dijkstra

**Q5. Why does Dijkstra need a priority queue?**
It repeatedly takes the *unsettled* vertex with the smallest known
distance and proves that distance final. A plain list would be O(V) per
extraction (O(V²) overall); the min-heap makes every extraction
O(log V).

**Q6. Explain your min-heap.**
It's a hand-written array-backed binary heap: `push` appends and sifts
up (O(log n)), `pop` takes the root, moves the last element in, and
sifts down (O(log n)), `peek` is O(1). Comparison is by value first,
then by `vertexId` — that tie-break is what makes every run and trace
**deterministic**.

**Q7. What is relaxation?**
For an edge (u, v, w) with u just finalized, if `dist[u] + w < dist[v]`
then we found a cheaper way to v: we update `dist[v]`, set
`parent[v] = u`, and push the new candidate `(dist[v], v)` into the
heap. Each relaxation is also recorded as a trace event, which is what
the 3D replay animates.

**Q8. Why can't Dijkstra handle negative edges?**
The algorithm's correctness rests on an exchange argument: once a
vertex is popped with the minimum tentative distance, no future path
can improve it. A negative edge can make a *not-yet-explored* route
cheaper than a finalized one, breaking that monotonicity. So the
invariant is enforced at the graph level: `addEdge` refuses
`weight <= 0`.

**Q9. Why doesn't your implementation use decreaseKey?**
Dijkstra and A\* use **lazy deletion**: when a better candidate appears
we push a *new* heap entry, and `pop()` skips entries whose vertex is
already finalized. That removes all `decreaseKey` book-keeping (finding
the element, updating, re-heapifying) at the cost of at most one stale
entry per relaxation — the asymptotics are unchanged and the code stays
short and readable, which matters for a viva-defensible project.

## 3. A\*

**Q10. Define g(n), h(n) and f(n) for your implementation.**
`g(n)` is the exact cost accumulated from the source to n (grown exactly
like Dijkstra's distances). `h(n)` is the **Euclidean straight-line
distance** from n's coordinates to the target's. `f(n) = g(n) + h(n)`
estimates the total cost of a path through n, and the heap is ordered by
`f` (with the same id tie-break).

**Q11. Why Euclidean? When is it safe?**
It's safe when edge weights are at least as large as the straight-line
distances they cover. In this dataset every weight is *geometric edge
length × factor (factor ≥ 1)*, so `h` never overestimates the true
remaining cost (**admissible**) and, because the triangle inequality
holds in cost space, `h` is **consistent** (monotone). Consequences we
rely on: A\* stays **optimal**, and finalized vertices never need to be
re-opened.

**Q12. Is A\* always faster than Dijkstra?**
No — and the project says so explicitly. The worst-case bound is the
same, O((V + E) log V); with `h ≡ 0` A* *is* Dijkstra. The gain depends
on how informative the heuristic is for the particular graph and query.
Our comparison panel measures it per query: on the showcase query
(gate-main → pav-morocco) Dijkstra expands 31 nodes, A\* expands 15 —
a real saving we can point at, reported as a measurement, not a slogan.
The delta can honestly be 0 or even negative.

**Q13. If a dataset used weights shorter than straight-line distance,
what would break?**
Admissibility. `h` could overestimate, the heap would mis-order
candidates, and A* could finalize the wrong path — losing the
optimality guarantee. That case is documented in `heuristic.ts` as the
explicit reason the factor ≥ 1 property matters.

## 4. BFS

**Q14. What does BFS actually minimize here, and why isn't that the
same as shortest distance?**
BFS assigns cost 1 to every edge and processes vertices level by level,
so the first time it reaches the target it has used the **minimum
number of edges** (hops). On a weighted graph a minimum-hop path is
generally not the minimum-metres path. In the UI, BFS results report
their cost in **edges**, deliberately, so the contrast with Dijkstra's
metres is visible instead of hidden.

**Q15. Why an array with a head pointer for the queue?**
`Array.prototype.shift()` is O(n) — it rewrites the array on every
dequeue, making BFS O(V²). Pushing to the end and advancing a head
index is amortized O(1) per dequeue, giving the true O(V + E).

## 5. DFS

**Q16. Where do you use DFS, given it can't find shortest paths?**
As a traversal utility, not a router. The dataset loader runs DFS to
compute **connected components**, list **orphaned vertices** (present in
the data but unreachable from the primary root), and detect **cycles**
(reporting a canonical witness edge plus the cycle path). All of that
is correctness *validation of the dataset*, shown in the loader's audit
report.

**Q17. Why is DFS a poor fit for weighted shortest paths?**
It has no cost objective — the search order is "go deep first", so it
can reach the target via an arbitrarily long route before the cheap one,
and it has no mechanism (no priority queue, no revisit rule) to repair
that. No optimality guarantee exists, which is exactly why
`findRoute` accepts only `dijkstra | astar | bfs` and DFS is excluded
by the type system.

**Q18. Why iterative DFS with an explicit stack instead of recursion?**
Recursion depth scales with the graph and risks a call-stack overflow on
large inputs; an explicit stack gives identical semantics with a flat,
predictable O(V) memory footprint. Same for the rest of the engine:
everything is iterative.

## 6. Path reconstruction

**Q19. How is the path reconstructed, and why is that cheap?**
Each algorithm maintains only a `parent` map — one pointer per vertex
(O(V) space, versus storing a full path per vertex, which would be
O(V × path)). Reconstruction walks `parent` from target back to source
and reverses: **O(path length)**. The walker carries its own visited set
as a guard, so even a corrupt parent cycle cannot hang it (unit-tested).

## 7. Tracing & visualization

**Q20. What is the TraceEvent system and why does it exist?**
Every algorithm run records an ordered log of exactly five event kinds:
`start`, `visit` (a node expanded), `relax` (an edge improved a
distance, with the improvement amount), `finalize` (target reached, with
total distance) and `abort` (search ended early, with a reason —
`unreachable`, `invalid`, `cycle`). Because all algorithms share the
schema, **one** replay pipeline can animate any algorithm: the
visualization never re-runs or re-derives anything, it only draws the
engine's events. That keeps the demo honest and the engine fully
testable without a browser.

**Q21. Why keep the engine separate from the UI in the first place?**
Four reasons: (1) testability — correctness is proven by Node unit tests
with no DOM/GPU; (2) reusability — the same engine could power a CLI or
server; (3) honesty — the 3D layer can only show what the algorithms
did, it contains zero pathfinding; (4) swappability — venue facts live
only in `src/data/`, so replacing EPCOT with a real campus dataset
changes no engine code.

**Q22. What does Three.js actually do in this project?**
Only the visualization layer: the renderer, camera and orbit controls,
procedurally generated scene geometry (ground disc, lagoon, promenade
ring, walkway tubes, primitive-based "buildings"), sprite labels, the
route tubes and exploration highlights. It performs **no** graph
computation — and the scene even degrades gracefully when WebGL is
unavailable, because the engine never needed the browser to begin with.

**Q23. Why procedural geometry instead of a real 3D model of the park?**
Three reasons: legal (no copyrighted Disney 3D assets or map imagery may
enter the repository — the asset policy is in the README), academic
(the point is the algorithms, and primitives keep the repo light and
dependency-free), and honest (a schematic scene matches the
digitized-approximate nature of the data; a "realistic" model would
falsely imply survey-grade accuracy).

## 8. Data & provenance

**Q24. Are your coordinates exact?**
No — and the project never claims they are. Coordinates and weights are
**digitized approximations** (roughly ±20–50 m / ±10–20 %) derived from
publicly documented EPCOT layout facts, calibrated so the reconstructed
promenade perimeter (1952 m) matches the documented ≈ 1.2 miles (≈ 1931
m) within +1.1 %. Every value carries a confidence level —
`verified / approximate / unavailable` — in the dataset and its
`provenance.md`. It is a DSA demonstration dataset, explicitly
not for real-world navigation.

**Q25. Why EPCOT as the dataset?**
Because the project required a **real, publicly documented environment**
rather than a fictional campus: eleven world pavilions around a lagoon
promenade, four park sections, landmarks and attractions give a rich,
verifiable graph (37 vertices / 43 edges) with one physically
interesting structure — the lagoon bridge is the single crossing, which
makes the blocked-route demo meaningful. Real names are factual data;
the geometry is our original, data-only model.

**Q26. Could this run on a real university campus (e.g. Amrita
Bengaluru)?**
Yes, with **zero engine changes**: add a JSON file following
`src/data/schema.ts` (vertices with metre coordinates, edges with
weights and confidence), and `loadDataset` validates it and reports
components/orphans/cycles. The whole point of the DATA → GRAPH →
ALGORITHM separation is exactly that swappability. (Such a dataset would
also need to be sourced and provenance-documented the same way — no
fabricated coordinates.)

## 9. Simulation & guarantees

**Q27. How does blocked-walkway routing work?**
`simulateBlockedRoute` validates the block list, runs the algorithm on
the **original** graph (the "before"), **clones** the graph, removes the
blocked edges on the clone only, runs again ("after"), and returns both
results plus a delta (`null` when either side is unreachable). Clicking
a walkway in Block mode triggers this per interaction; the route
recomputes automatically.

**Q28. Does blocking mutate the original graph?**
No — clone-then-mutate is the pattern, and a unit test asserts the
original graph is bit-for-bit unchanged after a simulation. That
invariant matters because the UI re-runs the unblocked query repeatedly
and the dataset must stay pristine.

**Q29. What exactly does "alternative route" guarantee?**
The **best cost among all simple paths distinct from the primary** —
computed by edge-removal enumeration (for each of the primary's `k`
edges, solve once on the graph minus that edge, keep the best simple
path that differs). It is exact for simple paths on graphs of this size
(O(k · (V + E) log V)), and it is *deliberately not* called Yen's
k-shortest algorithm. It does not claim "second-shortest overall",
because non-simple walks are outside the guarantee.

## 10. Complexity & testing

**Q30. Summarize the complexity of what you built.**
Min-heap: push/pop O(log n), peek O(1). Dijkstra: O((V + E) log V) time
with the lazy-deletion heap, O(V + E) space, early exit at the target.
A\*: same worst case, typically fewer expansions (measured, not
assumed). BFS and DFS: O(V + E) time, O(V) space. Path reconstruction:
O(path). Alternative route: O(k · (V + E) log V). Blocked simulation:
two solves plus an O(V + E) clone. All in
[`COMPLEXITY.md`](COMPLEXITY.md).

**Q31. How do you know the engine is correct?**
211 tests, no skips: unit tests prove optimality on hand-computed
graphs, determinism (identical inputs → identical traces), heap
invariants, BFS's level property, DFS cycle witnesses, the
alternative-route guarantee, and the no-mutation invariant; integration
tests pin **known answers** on the real EPCOT dataset — e.g.
gate-main → pav-morocco is always 1010 m with 31 Dijkstra expansions
and 70 trace events, A\* is the same 1010 m with 15 expansions, blocking
the lagoon bridge makes the showcase side unreachable, and a front-side
pair shows delta 0. If an examiner re-runs `npm test`, every number in
this viva is reproduced.

**Q32. What are the honest limitations of the system?**
Approximate digitized geometry (not survey-grade); a static dataset
(blocking is a simulation, not live incident data); no GPS, indoor
positioning, elevation, transit, crowds or opening hours; walk time is
an estimate at a declared 1.4 m/s; BFS optimizes hops not metres; A\*
is not guaranteed to expand fewer nodes on every query; the alternative
route is a simple-path guarantee, not Yen's. Each limitation is stated
in the README and, where relevant, in the UI itself.
