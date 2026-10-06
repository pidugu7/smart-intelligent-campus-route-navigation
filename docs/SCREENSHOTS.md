# Recommended Screenshots (Report & Slides)

Capture these **from the running app** (`npm run dev`) at a comfortable
zoom. All screenshots must come from this project's own UI —
**no EPCOT map imagery, Disney logos, or any third-party map pictures**
belong in the report or repository (asset policy: see README).

| # | Screenshot | How to capture | Why it matters |
| --- | --- | --- | --- |
| 1 | **Initial 3D scene** | Fresh load, default camera (Germany → France selected but not run). Let the intro framing settle. | Shows the modeled environment: lagoon ring, 11 pavilions, front park, entrance. First impression of the graph-to-3D mapping. |
| 2 | **Dijkstra result — Germany → Morocco** | Click *Demo: Germany → Morocco*, then *Find route*. | The headline result: cyan route tube over the promenade ring; result card with 1010 m, estimated walk time, work counters (31 expansions / 37 relaxations). |
| 3 | **Trace replay mid-flight** | Press *Play* on the route, pause at ~50 %. Green visited nodes, yellow relaxation highlights, pulse cursor on the current vertex, event readout visible. | The core differentiator: the viewer sees the *algorithm working*, node by node, from the engine's event log — not a pre-drawn line. |
| 4 | **Dijkstra vs A\* comparison** | Run Dijkstra, then click *Compare Dijkstra vs A\*. | Side-by-side card: same 1010 m, 31 vs 15 expansions, Δ16 — the honest "measured, not assumed" story in one frame. |
| 5 | **Blocked walkway simulation** | Turn on *Block mode*, click the lagoon bridge walkway (front ↔ showcase crossing). | Before 874 m / **after unreachable** for a showcase-side destination; proves the clone-then-simulate design and the single-pinchof-the-lagoon structure. Optionally a second frame with a non-route block showing **Δ 0 m**. |
| 6 | **Alternative route** | After the Dijkstra run, click *Find alternative route*. | Orange alternate tube (via International Gateway) next to the primary; card shows +14 m and the exact guarantee wording. |

## Optional extras (if space allows)

- **BFS vs Dijkstra** — same query, algorithm switched to BFS; the
  result card reports cost in *edges* (10) next to Dijkstra's 1010 m.
- **Provenance card** — the ⓘ panel with confidence levels; supports the
  "no fabricated data" claim.
- **Test run** — `npm test` terminal output (211 passed, no skips);
  supports every numeric claim in the viva.
- **Unreachable case** — any query the blocked state makes impossible;
  the honest "unreachable — abort(unreachable)" result card with replay.

## Capture tips

- Keep the browser at **100% zoom** (the UI is designed for it).
- Use the same window size across all shots for a consistent look.
- Screenshot the **full window** (sidebar + 3D) so the UI result cards
  are included — they carry the numbers the screenshots are about.
- Name files `01-initial-scene.png` … `06-alternative-route.png`.
- Do **not** crop in official EPCOT maps or any imagery from the web.
