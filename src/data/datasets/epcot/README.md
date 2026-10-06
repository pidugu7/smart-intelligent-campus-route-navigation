# EPCOT Dataset (Phase 3)

A **real-world, publicly documented** walkable-environment dataset for the
generic DSA engine: Walt Disney World's EPCOT — the World Showcase lagoon
ring (11 pavilions + The Outpost), the World Showcase Bridge, the
International Gateway, and the front-of-park hub (World Celebration, World
Discovery, World Nature).

> Schematic model for a DSA route-navigation **demonstration**. Not survey
> data, not for real-world navigation, and contains no Disney artwork or
> proprietary assets (see `provenance.md` § legal note).

## Contents

| File | Purpose |
| --- | --- |
| `dataset.json` | The dataset in the generic `src/data/schema.ts` format |
| `provenance.md` | What is verified / approximate / unavailable, calibration method, weight method, what is not modeled |

## Stats

- **37 vertices** (2 gates, 1 plaza, 6 areas, 1 bridge, 11 pavilions, 1 outpost plaza, 8 front-of-park attractions/landmarks, 7 pavilion-internal nodes)
- **43 edges** (13 promenade ring, 6 entrance spine, 1 bridge, 2 gateway links, 6 World Discovery, 8 World Nature, 7 pavilion-internal)
- Single connected component, undirected, with cycles (the lagoon ring and branch loops)
- Every spatial value is `confidence: "approximate"`; topology/names are documented (see `provenance.md`)

## Key structural facts (used by the integration tests)

- **The bridge is the only walkable connection** between the front-of-park
  hub and World Showcase. Blocking edge `e-bridge-showcase` isolates the
  entire lagoon ring from the Main Entrance (the International Gateway is a
  *separate external entrance*, intentionally not connected to the hub side).
- The 13 promenade-ring edges sum to **1952 m**, within **+1.1 %** of the
  documented ≈1.2-mile (≈1931 m) lagoon perimeter — the scale
  cross-check.
- The International Gateway links France and UK, so gateway-side routes to
  the ring are short, while main-entrance routes to the same pavilions are
  long — a built-in alternative-route demo.

## Loading it

```ts
import { loadDataset } from '../../loader';
import epcot from './dataset.json';

const { graph, report } = loadDataset(epcot);
// graph: engine WeightedGraph — ready for dijkstra / aStar / bfs / dfs
// report: counts, connectivity, orphans, cycle flag, warnings
```

(Phase 4 will add the 3D visualization over this exact dataset.)
