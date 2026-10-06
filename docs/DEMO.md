# Classroom Demo Script (3–5 minutes)

The demo route is **Germany Pavilion → Morocco Pavilion**. Start the app
with `npm run dev` and open the printed URL in a browser. Keep the
browser at 100% zoom — the UI is designed to be comfortable there.

> One-liner for the start: *"This is a DSA engine with a 3D
> visualization attached — the algorithms live in pure TypeScript, and
> Three.js only draws what the engine says it did."*

---

## Step 1 — Orient (10 s)

Show the 3D scene: the lagoon ring with the eleven World Showcase
pavilions, the front park on the other side of the lagoon, and the
entrance gate.

> *"Every location is a vertex, every walkway is an edge, and each
> walkway's length in metres is the edge weight. The dataset is
> EPCOT — a real, publicly documented environment — with
> digitized-approximate geometry, not survey-grade coordinates."*

## Step 2 — The dataset card (20 s)

Open the **Data provenance** card (ⓘ button). Point out:

- 37 vertices / 43 edges, local metre coordinate system;
- every value carries a confidence level (`verified / approximate /
  unavailable`);
- the promenade perimeter is calibrated to the documented ≈ 1.2 miles
  (reconstructed 1952 m vs ≈ 1931 m → +1.1%).

> *"We never fabricated data: anything we couldn't verify is labelled
> approximate or unavailable."*

## Step 3 — Demo button (5 s)

Click **Demo: Germany → Morocco**. (Mention: it just fills the start,
destination and algorithm fields — the real algorithm runs next.)

## Step 4 — Run Dijkstra (15 s)

Click **Find route**. The route tube appears over the promenade ring.

Point at the result card:

- **total distance** (1010 m);
- **estimated walk time** at 1.4 m/s (labelled an estimate);
- **work counters**: nodes expanded (31) and edge relaxations (37).

> *"This is the weighted optimal path — the min-heap always expanded the
> closest unsettled location first."*

## Step 5 — Watch the algorithm work (40 s)

Press **Play** on the trace replay.

> *"This is the engine's own event log, replayed — not a re-run. Green
> nodes are visited (popped from the heap), the yellow flashes are
> relaxations, and the pulse cursor sits on the current vertex. Pause
> anywhere; the speed slider goes 0.5× to 120×."*

Pause mid-replay on a relaxation and explain: *"Dijkstra just proved
this vertex's distance is final — that's the early-exit that saves work
when the target is near."*

## Step 6 — Compare Dijkstra vs A\* (30 s)

Click **Compare Dijkstra vs A\***.

> *"A\* orders the heap by f = g + h — actual cost plus straight-line
> distance to the target. The heuristic is admissible here because every
> walkway weight is at least its straight-line length. Look at the
> measured result: same 1010 m, but 15 expansions instead of 31 — a
> 16-expansion saving **on this query**. We deliberately show the
> measured delta, because A\* is not guaranteed to win on every graph
> or query."*

## Step 7 — Show BFS's different objective (30 s)

Change the algorithm to **BFS — fewest hops**, click **Find route**.

> *"BFS treats every walkway as cost 1. It finds the route with the
> fewest edges — 10 — and its 'cost' is hops, not metres. Put it next to
> Dijkstra and you can see what 'shortest' means depends on your
> objective. BFS is the unweighted baseline that motivates the whole
> weighted-algorithm family."*

## Step 8 — Alternative route (30 s)

Switch back to Dijkstra, click **Find route**, then
**Find alternative route**.

> *"This asks: what is the best cost among all simple paths that are
> different from the primary? The answer here is 1024 m — 14 m longer,
> leaving via the International Gateway instead of the direct ring edge.
> This is an exact guarantee over simple paths — we are honest that it
> is not Yen's k-shortest algorithm."*

The orange route tube appears next to the cyan one.

## Step 9 — Blocked walkway (40 s)

Turn on **Block mode** (toggle), then click the **lagoon bridge** walkway
(the one crossing the water to the showcase side).

The simulation panel appears automatically:

- **Before:** 874 m gate-main → France (or whatever pair is active);
- **After:** **unreachable** — the bridge is the only crossing of the
  lagoon, so the whole showcase side is isolated;
- **Delta:** — (reported as null because the after side is unreachable).

Now block a walkway *on the front side* (e.g. between the plaza and the
fountain area) with a front-side pair: the panel shows **delta 0** —
that walkway wasn't on the route.

> *"Blocking runs on a clone — the original graph is never mutated; a
> unit test asserts that. Real deployments would use live incident data;
> here we simulate it by clicking."*

Turn off Block mode; the route returns.

## Step 10 — Zoom-aware labels & camera (20 s)

Zoom out: labels fade from major (pavilions, gates) to minor (areas,
attractions) by distance — no clutter, no overlap explosion. Click
**Reset camera** for the deterministic bounds-based framing. Mention:
*"Labels control visibility only — the geometry is identical."*

## Step 11 — Honest closing (30 s)

> *"What this is: a real weighted graph from a real environment, four
> classic algorithms implemented by hand — including the min-heap — with
> every step recorded and replayable, and a 3D layer that can only draw
> what the engine proved. What it is not: GPS navigation. Coordinates
> are digitized approximations, there's no crowds/hours/elevation, BFS
> counts hops not metres, and A\* is measured, never assumed. Swap the
> EPCOT dataset for a real campus JSON and none of the engine changes."*

---

## Tips

- **Determinism:** every number in this script is pinned by integration
  tests (e.g. 1010 m / 31 expansions / 70 trace events) — the demo
  always shows the same values.
- **If WebGL is unavailable** (headless machine), the app still loads
  the engine and shows the result cards; the 3D panel degrades to a
  message.
- **Time pressure?** Steps 4–6 are the core (45 s); everything else is
  trimmable.
- **Screenshot set** for the report: see
  [`SCREENSHOTS.md`](SCREENSHOTS.md).
