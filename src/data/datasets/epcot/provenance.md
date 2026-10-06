# EPCOT Dataset — Provenance

This file documents exactly which values in `dataset.json` are **verified**,
which are **approximate**, and which are **unavailable**, how the geometry was
produced, and what is deliberately **not** modeled. Every claim below is
traceable to a public source; nothing in this dataset is invented.

> **Legal note.** This dataset is an original, schematic, data-only model of
> the *layout facts* of EPCOT (publicly documented names, locations and
> ordering of public spaces). It contains **no Disney artwork, map imagery,
> logos, textures, fonts or other proprietary assets**. Official park maps
> were **viewed as a reference only** and no image file is stored in this
> project. "EPCOT", the attraction names and other marks remain the property
> of their owners; this project is an independent, non-commercial academic
> DSA demonstration.

## 1. Reference edition and date

- Primary geometric reference: the **official 2026 EPCOT park map** (publicly
  downloadable; viewed as reference only — see `meta.sources` in
  `dataset.json`). A widely circulated **2023 edition** was used as a second
  reference to corroborate the layout and attraction rosters.
- The pavilion set is the **2024+ configuration**: **Canada replaced Spain**
  (Spain's pavilion was retired and Canada's opened in 2024). If an older map
  (with Spain) is used as a reference, the pavilion list will not match this
  dataset.
- `meta.referenceDate` = "2026 … includes Canada, which replaced Spain in 2024".

## 2. Coordinate system and calibration method

| Property | Value |
| --- | --- |
| Coordinate system | Local 2-D grid in **metres** (one flat layer, `z = 0`) |
| Origin | Centre of **World Showcase Lagoon** = (0, 0, 0) |
| Axes | **x = east**, **y = north** (standard map orientation; main entrance is south, at negative y) |
| Scale (calibration) | The lagoon promenade perimeter is **documented as ≈ 1.2 miles (≈ 1931 m)** (public historical park references). Treating the promenade as a circle gives radius R = 1931 / (2π) ≈ **307 m**; **R = 312 m** is used so the 13 reconstructed ring segments close at ≈ the documented perimeter. |
| Meter conversion | 1 unit = 1 metre; weights are stored as integer metres (`ceil` of the computed value) |
| Estimated precision | Coordinates **±20–50 m** (ring positions ±30 m angular, i.e. ±5–10°); edge weights **±10–20 %** |
| Cross-check | Reconstructed 13-segment promenade perimeter = **1952 m** vs documented **≈ 1931 m** → **+1.1 %** agreement |

**How the coordinates were produced (honestly stated):** the pavilions'
*identity, clockwise order and compass placement* were read from the official
map. Their *angular* positions were then estimated from the map layout
(±5–10°) and placed on the calibrated circle. Front-of-park (teardrop)
distances were estimated from the map's proportions. This is a **topology-
accurate, metrically approximate** reconstruction — a deliberate choice for a
route-planning *demonstration*, not survey data. **No coordinate in this
dataset is claimed to be exact.**

The lagoon is modeled as a circle although the real lake is kidney-shaped
(documented approximation, see `meta.assumptions`).

## 3. VERIFIED values (authoritative / documented)

These are the only values with documentary authority. They are *facts about
the environment*, not *spatial measurements*:

1. **Pavilion identities and names** — the 11 World Showcase pavilions:
   Mexico, Norway, China, Germany, Italy, America, Japan, Morocco, France,
   United Kingdom, Canada. (Official maps and numerous public park guides.)
2. **Clockwise ordering** of the pavilions around the lagoon, from the bridge
   side: **Mexico → Norway → China → Germany → Italy → America → Japan →
   Morocco → France → United Kingdom → Canada**. (Documented in public
   historical park references; confirmed against the official maps.)
3. **Neighborhood structure** — the park's front area (south of the lagoon)
   is divided into **World Celebration** (entrance hub), **World Discovery**
   (west side) and **World Nature** (east side); **World Showcase** is the
   lagoon ring. (Official maps.)
4. **Documented lagoon perimeter ≈ 1.2 miles (≈ 1931 m)** — public historical
   park references. (Used only as the scale calibration; the reconstructed
   ring closes within +1.1 %.)
5. **Entrances** — a **Main Entrance** at the south end of the park and the
   **International Gateway** on the lagoon's east side between the France and
   United Kingdom pavilions; the gateway is a *separate* external entrance
   (not walkable from the main-entrance side except by leaving the park).
6. **Documented major attractions** and their neighborhoods: Spaceship Earth
   & Journey of Water (World Celebration); Test Track, Guardians of the
   Galaxy: Cosmic Rewind, Mission: SPACE (World Discovery); Soarin' Across
   America, The Land, The Seas with Nemo & Friends, Festival of the Lion King
   (World Nature); The American Adventure (America); Frozen Ever After
   (Norway); Remy's Ratatouille Adventure (France); Gran Fiesta Tour
   Starring the Three Caballeros (Mexico, in the pyramid).
7. **The Outpost** — a small, documented market/refreshment area on the
   lagoon's west side between China and Germany (originally a placeholder
   for a full Africa pavilion; the pavilion was never built, the Outpost
   remains).
8. **The World Showcase Bridge** — the single pedestrian bridge joining the
   hub side to the lagoon promenade at its south end, between Canada and
   Mexico.
9. **Canada replaced Spain in 2024.**
10. **Pavilion-internal landmarks**: the Mexico pavilion's pyramid (home of
    Gran Fiesta Tour), Norway's stave church (home of Frozen Ever After),
    the France pavilion's Eiffel Tower replica.

These facts are encoded as vertex/edge **names, ids, topology (connectivity
and order) and `kind`** — all of which are exact.

## 4. APPROXIMATE values (every spatial value)

- **All vertex coordinates** (`x`, `y`, `z`) — `confidence: "approximate"` on
  every vertex. Positions are the estimated digitized/reconstructed values
  from §2; none is a surveyed or officially published coordinate.
- **All edge weights** — `confidence: "approximate"` on every edge, with the
  *derivation method* recorded per edge in `weightSource`:
  - `digitized-path` (25 edges): the lagoon **promenade** segments (13), the
    **entrance spine** (Main Entrance → plaza → hub → fountain garden →
    bridge, 6 edges), the **bridge** (1), the **gateway plaza** links (2), and
    the **main branch walkways** out of the hub and through Discovery/Nature.
    These walkways are *drawn on the official map*; their **lengths** are
    scale-estimated, so they remain approximate.
  - `straight-line-approx` (18 edges): plausible **direct links that are not
    individually verified** — shortcuts between two attractions inside
    Discovery/Nature (e.g. Test Track ↔ Cosmic Rewind), hub ↔ Lion King
    stage, and the short **pavilion-internal** hops (promenade → pyramid →
    Gran Fiesta; promenade → stave church → Frozen; America → American
    Adventure theater; France → Ratatouille; France → Eiffel Tower replica).
    Weights are `ceil` of the straight-line distance between the endpoints,
    which is an **upper bound** on the true walk length — this also keeps the
    Euclidean A* heuristic admissible for this dataset.
- **The promenade circle radius (312 m)** — derived from the documented
  perimeter, rounded to close the 13-segment ring.
- **The lagoon shape** — modeled as a circle (kidney-shaped in reality).

**Honesty rule enforced:** no `approximate` value is ever labeled
`verified`; the distinction stays in the data (`confidence`,
`weightSource`) and in this document.

## 5. UNAVAILABLE values

Nothing in this dataset is marked `unavailable` — every location included was
placed with an honest `approximate` estimate instead. The schema supports
`confidence: "unavailable"` for locations whose position could not be
established at all (the template dataset demonstrates it). In EPCOT's case
that would apply, e.g., to individual restaurants/shops, which were simply
**omitted** (see §7).

## 6. Edge-weight method, in one paragraph

Ring (promenade) weights are the straight-line chords between the documented
pavilion landmarks placed on the calibrated perimeter circle, so the ring's
total (1952 m) agrees with the *documented* ≈1931 m perimeter within +1.1 %;
front-of-park weights are straight-line distances between scale-estimated
endpoint positions, with `ceil` rounding to integer metres; links that are
plausible but not individually verified (attraction-to-attraction shortcuts,
pavilion interiors) are explicitly labeled `straight-line-approx`. **No exact
walk distance was invented anywhere**; every weight is either a documented
figure or an explicitly-labeled approximation, and every approximate weight
is an upper bound on the true path length.

## 7. What is deliberately NOT modeled

- **Individual shops, restaurants and small refreshment stands** (hundreds
  per pavilion) — out of scope for a navigation graph; the pavilion node
  represents the pavilion as a whole.
- **Spain Pavilion** (retired 2024) — not part of the 2026 environment.
- **Queue lines, ride paths and indoor layout** of attractions — only the
  approach to each attraction (and, for Mexico/Norway/France/America, one or
  two indoor hops to the headline ride/theater/landmark).
- **Seasonal/nighttime overlays** (Luminous the Symphony of Us fireworks,
  holiday transforms), **opening hours, crowds, weather**.
- **Transportation** (monorail, trams, buses, parking) — on foot only.
- **Elevation/grade changes, ramps, accessibility details** — flat `z = 0`.
- **The Imagination / carousel building, the hub's small mid-size buildings
  (e.g. the plaza buildings between hub and bridge), and similar minor
  structures** — real but not individually placed here (their positions
  could not be established with the accuracy the rest of the dataset claims,
  so they were omitted rather than guessed).
- **The exact lagoon shoreline, islands and water features.**
- **Anything copyrighted** — no Disney names in code/identifiers (only in
  human-readable `name` fields, which are factual labels), no artwork, no
  logos, no map imagery.

## 8. How to update this dataset

If a new official map edition is released: re-read pavilion/area placement,
re-estimate angles, regenerate coordinates (the generator keeps the
documented-perimeter calibration), update `meta.referenceDate` and the
cross-check numbers in §2, and re-run the test suite
(`tests/integration/epcot-dataset.test.ts`) — the suite checks structure,
algorithmic behaviour and the perimeter cross-check, not fabricated absolutes.
