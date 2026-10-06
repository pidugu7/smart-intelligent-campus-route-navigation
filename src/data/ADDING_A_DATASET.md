# Adding a Dataset

The engine is **completely data-driven**: any real-world walkable environment
(campus, airport, hospital, theme park, …) is just a JSON file in the generic
schema in `src/data/schema.ts`. To add a new environment you do **not** touch
`src/engine/` or `src/data/loader.ts` at all.

## 1. Copy the template

```
src/data/datasets/_template/dataset.json   →   src/data/datasets/<env>/dataset.json
```

The template is schema-complete and fictional (`meta.fictional: true`); it
documents every field with EXAMPLE values.

## 2. Fill in `meta` (honesty is mandatory)

- `name`, `description` — what the environment is.
- `unit` — must be `"m"`.
- `coordinateSystem` + `origin` — define the grid: origin, axis directions
  (e.g. "x = east, y = north"), units.
- `scaleMethod` — **how you established the metre scale** (e.g. "one documented
  100 m corridor fixed the scale of the digitized floor plan").
- `precision` — state the estimated error (± m / ± %).
- `referenceDate` — edition/date of your primary reference.
- `fictional` — `false` for real places.
- `sources` — every source used, with `usedFor`.
- `assumptions` — every modeling decision that is an approximation.
- `primaryRootId` — the vertex reachability is audited from.

## 3. Add vertices

- Real, documented names only (keep `id` stable and short, `name` human-
  readable). Do not invent buildings/rooms that you cannot place.
- Every vertex carries a **spatial** `confidence`:
  - `verified` — authoritative published measurement of the position;
  - `approximate` — digitized/estimated from a map (the usual case);
  - `unavailable` — no position could be established (the loader allows it;
    such vertices simply sit at your placeholder coordinates and are listed
    in the report warnings).
- Never upgrade `approximate` to `verified` without a new authoritative source.

## 4. Add edges

- `from`/`to` must reference existing vertex ids; undirected pairs must be
  unique; no self-loops.
- `weight` (metres) must be finite and > 0.
- `weightSource` tells the story of the number:
  `measured` (on-site), `digitized-path` (traced along a visible path on a
  published map at the documented scale), `straight-line-approx` (chord —
  an upper bound), `documented-distance` (quoted from a published distance),
  `unavailable` (not routable — the loader rejects it on edges).
- `kind` — walkway, path, bridge, stairs, elevator, indoor, …
- `confidence` — `verified` only for the first two sources above.

## 5. Write `provenance.md` and `README.md` next to the dataset

Follow `src/data/datasets/epcot/provenance.md` as the reference format:
VERIFIED / APPROXIMATE / UNAVAILABLE sections, calibration method, weight
method, and what is deliberately **not** modeled.

## 6. Validate

```ts
import { loadDataset } from '../loader';
import myData from './dataset.json';

const { graph, report } = loadDataset(myData);
// report.connectedComponents === 1  (or you accept the listed components)
// report.orphanedVertices is empty
```

The loader throws a `DatasetError` listing **all** validation problems:
missing meta fields, bad confidence/weightSource values, duplicate ids,
missing endpoints, non-finite or non-positive weights, self-loops, duplicate
undirected pairs, unknown `primaryRootId`.

## 7. Add an integration test

Mirror `tests/integration/epcot-dataset.test.ts`: load, counts, key locations
exist, reachability from `primaryRootId`, Dijkstra/A* run and agree on cost,
BFS/DFS structural properties, a blocked-edge scenario, and any
**documented** numeric cross-checks (like EPCOT's perimeter). Assert
structural and algorithmic properties — never hard-code distances that your
provenance does not support.

## Ground rules (project-wide)

1. No fabricated coordinates, buildings, or distances — mark approximate or
   omit.
2. No venue names in the engine, loader, or schema.
3. Copyrighted artwork/images/logos never enter the repo; maps may be *viewed
   as reference only*.
4. Do not weaken existing tests to make a new dataset pass.
