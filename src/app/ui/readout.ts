/**
 * app/ui/readout.ts
 *
 * Renders the RESULT panels: route statistics, the Dijkstra-vs-A* comparison
 * table, the alternative route summary, the blocked-path before/after report
 * and the data-provenance information panel. All values come from engine
 * results — nothing here computes a route.
 *
 * Honesty rule: this dataset's spatial values are approximate, so every
 * distance/time figure is rendered with an explicit "digitized approximate
 * geometry" disclaimer and never presented as a measured real-world value.
 */

import type {
  AlgorithmComparison,
  AlternativeRouteResult,
  RouteResult,
} from '../../engine/engine';
import { estimateWalkTime } from '../../engine/engine';

const APPROX_BADGE = 'digitized approximate geometry';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className !== undefined) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

function fmtMeters(m: number): string {
  return `${Math.round(m).toLocaleString('en-IN')} m`;
}

function fmtTime(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return rem === 0 ? `${mins} min` : `${mins} min ${rem} s`;
}

/** Sum of dataset edge weights along a path (true route length in metres). */
export function pathLengthMeters(path: readonly string[], weightOf: (a: string, b: string) => number): number {
  let sum = 0;
  for (let i = 0; i + 1 < path.length; i += 1) {
    sum += weightOf(path[i]!, path[i + 1]!);
  }
  return sum;
}

/** One quiet item of the metadata strip. */
function metaItem(strip: HTMLElement, label: string, value: string): void {
  const item = el('div', 'meta-item');
  item.appendChild(el('div', 'meta-value', value));
  item.appendChild(el('div', 'meta-label', label));
  strip.appendChild(item);
}

// ── route result ────────────────────────────────────────────────────────────

export function renderRouteResult(
  container: HTMLElement,
  result: RouteResult,
  algoLabel: string,
  routeLength: number | null,
): void {
  container.innerHTML = '';
  const card = el('div', 'panel-card result-card');

  // Unreachable — plain, unambiguous
  if (result.status === 'unreachable') {
    card.appendChild(el('div', 'panel-title', `${algoLabel} route`));
    const chipRow = el('div', 'result-status');
    chipRow.appendChild(el('span', 'status-chip status-no', '✗ Unreachable'));
    chipRow.appendChild(el('span', 'result-endpoints', `${result.source.name} → ${result.target.name}`));
    card.appendChild(chipRow);
    card.appendChild(el('div', 'result-bad', 'No route exists between these two locations in the graph.'));
    card.appendChild(el('div', 'provenance-note', `The search expanded ${result.nodesExpanded} nodes before exhausting the graph.`));
    container.appendChild(card);
    return;
  }

  const isBfs = algoLabel === 'BFS';

  card.appendChild(el('div', 'panel-title', `${algoLabel} route`));
  const chipRow = el('div', 'result-status');
  chipRow.appendChild(el('span', 'status-chip status-ok', isBfs ? '✓ Fewest-hop route found' : '✓ Route found'));
  chipRow.appendChild(el('span', 'result-endpoints', `${result.source.name} → ${result.target.name}`));
  card.appendChild(chipRow);

  // Primary result: the cost, as a single large number.
  const cost = el('div', 'result-cost');
  if (isBfs) {
    cost.appendChild(el('span', 'result-cost-value', String(result.totalDistance)));
    cost.appendChild(el('span', 'result-cost-unit', 'hops · fewest edges'));
  } else {
    cost.appendChild(el('span', 'result-cost-value', Math.round(result.totalDistance).toLocaleString('en-IN')));
    cost.appendChild(el('span', 'result-cost-unit', 'm'));
  }
  card.appendChild(cost);

  // Secondary: estimated walk time. BFS: routeLength is the digitized metre
  // length of the fewest-hop path (weights ignored by design).
  const metersForWalk = isBfs && routeLength !== null ? routeLength : result.totalDistance;
  const walk = estimateWalkTime(metersForWalk);
  card.appendChild(el('div', 'result-walk', `≈ ${fmtTime(walk.estimatedSeconds)} walk at ${walk.speedMetersPerSecond} m/s`));

  // Quiet metadata: algorithm work, not results.
  const strip = el('div', 'meta-strip');
  metaItem(strip, 'nodes expanded', String(result.nodesExpanded));
  metaItem(strip, 'trace steps', String(result.trace.length));
  metaItem(strip, 'edges on route', String(result.path.length - 1));
  if (isBfs && routeLength !== null) {
    metaItem(strip, 'route length', fmtMeters(routeLength));
  }
  card.appendChild(strip);

  card.appendChild(
    el(
      'div',
      'provenance-note',
      isBfs
        ? 'BFS cost is hop count (weights ignored by design); route length is the digitized metre length of that path. Distances based on digitized approximate geometry.'
        : `Distance based on ${APPROX_BADGE} — not a measured real-world value.`,
    ),
  );
  container.appendChild(card);
}

// ── Dijkstra vs A* ──────────────────────────────────────────────────────────

export function renderComparison(container: HTMLElement, cmp: AlgorithmComparison): void {
  container.innerHTML = '';
  const card = el('div', 'panel-card result-card');
  card.appendChild(el('div', 'panel-title', 'Dijkstra vs A*'));

  // Prominent verdict first
  if (cmp.sameOptimalCost) {
    card.appendChild(el('div', 'compare-banner', 'Same optimal cost ✓'));
  } else {
    card.appendChild(el('div', 'compare-banner compare-banner-warn', '✗ Costs differ — heuristic assumptions violated for this query'));
  }

  // Headline efficiency fact: nodes expanded, side by side
  const facts = el('div', 'compare-facts');
  const fDi = el('div', 'compare-fact');
  fDi.appendChild(el('span', 'fact-value', String(cmp.dijkstra.nodesExpanded)));
  fDi.appendChild(el('span', 'fact-label', 'nodes expanded · Dijkstra'));
  const fAs = el('div', 'compare-fact');
  fAs.appendChild(el('span', 'fact-value', String(cmp.astar.nodesExpanded)));
  fAs.appendChild(el('span', 'fact-label', 'nodes expanded · A*'));
  facts.append(fDi, fAs);
  card.appendChild(facts);

  // Detail table
  const table = el('table', 'cmp-table');
  const head = el('tr');
  head.appendChild(el('th', '', 'Metric'));
  head.appendChild(el('th', '', 'Dijkstra'));
  head.appendChild(el('th', '', 'A*'));
  table.appendChild(head);

  const row = (metric: string, d: string, a: string): void => {
    const tr = el('tr');
    tr.appendChild(el('td', 'cmp-metric', metric));
    tr.appendChild(el('td', '', d));
    tr.appendChild(el('td', '', a));
    table.appendChild(tr);
  };

  const dOk = cmp.dijkstra.status === 'ok';
  const aOk = cmp.astar.status === 'ok';
  row('Status', dOk ? 'ok' : 'unreachable', aOk ? 'ok' : 'unreachable');
  row('Distance', dOk ? fmtMeters(cmp.dijkstra.totalDistance!) : '—', aOk ? fmtMeters(cmp.astar.totalDistance!) : '—');
  row('Path edges', dOk ? String(cmp.dijkstra.path.length - 1) : '—', aOk ? String(cmp.astar.path.length - 1) : '—');
  row('Nodes expanded', String(cmp.dijkstra.nodesExpanded), String(cmp.astar.nodesExpanded));
  row('Trace steps', String(cmp.dijkstra.traceSteps), String(cmp.astar.traceSteps));
  const dTime = dOk ? fmtTime(estimateWalkTime(cmp.dijkstra.totalDistance!).estimatedSeconds) : '—';
  const aTime = aOk ? fmtTime(estimateWalkTime(cmp.astar.totalDistance!).estimatedSeconds) : '—';
  row('Est. walk time', dTime, aTime);
  card.appendChild(table);

  card.appendChild(
    el(
      'div',
      'cmp-note',
      'Expansion counts are reported as measured: A* is NOT guaranteed to expand fewer nodes on every graph or query — the saving depends on how informative the heuristic is (Δ nodes = Dijkstra − A* = ' +
        `${cmp.nodesExpandedDelta}).`,
    ),
  );
  card.appendChild(el('div', 'provenance-note', `Distances based on ${APPROX_BADGE}.`));
  container.appendChild(card);
}

// ── alternative route ───────────────────────────────────────────────────────

export function renderAlternative(container: HTMLElement, alt: AlternativeRouteResult): void {
  container.innerHTML = '';
  const card = el('div', 'panel-card result-card');
  card.appendChild(el('div', 'panel-title', 'Alternative route'));

  if (alt.status === 'no-primary-route') {
    card.appendChild(el('div', 'result-bad', 'No primary route exists for this pair.'));
    container.appendChild(card);
    return;
  }
  const primary = alt.primary!;

  // Colour-coded primary vs alternative, readable at a glance
  const pairRow = el('div', 'alt-pair');
  const primaryRow = el('div', 'alt-entry');
  primaryRow.appendChild(el('span', 'alt-dot alt-dot-primary'));
  primaryRow.appendChild(el('span', 'alt-name', 'Primary'));
  primaryRow.appendChild(el('span', 'alt-dist', fmtMeters(primary.totalDistance)));
  pairRow.appendChild(primaryRow);

  if (alt.alternative === null) {
    card.appendChild(pairRow);
    card.appendChild(el('div', 'cmp-note', 'No distinct alternative route exists — the primary path is the only walkable route between these points.'));
    container.appendChild(card);
    return;
  }

  const other = alt.alternative;
  const altRow = el('div', 'alt-entry');
  altRow.appendChild(el('span', 'alt-dot alt-dot-alt'));
  altRow.appendChild(el('span', 'alt-name', 'Alternative'));
  altRow.appendChild(el('span', 'alt-dist', fmtMeters(other.totalDistance)));
  pairRow.appendChild(altRow);
  card.appendChild(pairRow);

  const extra = alt.extraDistance ?? other.totalDistance - primary.totalDistance;
  const extraRow = el('div', 'alt-extra');
  extraRow.appendChild(el('span', '', `Extra distance: +${fmtMeters(extra)}`));
  const dt = estimateWalkTime(other.totalDistance).estimatedSeconds - estimateWalkTime(primary.totalDistance).estimatedSeconds;
  extraRow.appendChild(el('span', '', `Extra walk time: +${fmtTime(dt)}`));
  card.appendChild(extraRow);

  // Alternating dot list of the alternative's vertex sequence
  const altSteps = el('ol', 'route-steps route-steps-alt');
  other.path.forEach((id, i) => {
    const li = el('li', i === other.path.length - 1 ? 'route-step-end' : undefined, id);
    li.dataset.vertex = id;
    altSteps.appendChild(li);
  });
  card.appendChild(altSteps);

  card.appendChild(
    el(
      'div',
      'cmp-note',
      'Guarantee: best cost among all SIMPLE paths distinct from the primary (second-best simple-path cost — not a general k-shortest listing, and not Yen’s algorithm).',
    ),
  );
  card.appendChild(el('div', 'provenance-note', `Distances based on ${APPROX_BADGE}.`));
  container.appendChild(card);
}

// ── blocked path ────────────────────────────────────────────────────────────

export function renderBlockReport(
  container: HTMLElement,
  before: RouteResult,
  after: RouteResult,
  blockedCount: number,
): void {
  container.innerHTML = '';
  const card = el('div', 'panel-card result-card');
  card.appendChild(el('div', 'panel-title', 'Blocked-path simulation'));

  const chipRow = el('div', 'result-status');
  const chip = el('span', `status-chip ${after.status === 'ok' ? 'status-warn' : 'status-no'}`, after.status === 'ok' ? `Rerouted around ${blockedCount} block${blockedCount === 1 ? '' : 's'}` : '✗ Unreachable now');
  chipRow.appendChild(chip);
  card.appendChild(chipRow);

  if (after.status === 'ok') {
    const strip = el('div', 'meta-strip');
    if (before.status === 'ok') {
      metaItem(strip, 'before (clear)', fmtMeters(before.totalDistance));
      metaItem(strip, 'after (rerouted)', fmtMeters(after.totalDistance));
      const delta = after.totalDistance - before.totalDistance;
      metaItem(strip, 'change', `${delta >= 0 ? '+' : '−'}${fmtMeters(Math.abs(delta))}`);
      metaItem(strip, 'extra walk time', `+${fmtTime(Math.abs(estimateWalkTime(after.totalDistance).estimatedSeconds - estimateWalkTime(before.totalDistance).estimatedSeconds))}`);
    } else {
      metaItem(strip, 'before', 'unreachable');
      metaItem(strip, 'after (rerouted)', fmtMeters(after.totalDistance));
    }
    card.appendChild(strip);
  } else {
    card.appendChild(el('div', 'result-bad', `No route remains with ${blockedCount} walkway${blockedCount === 1 ? '' : 's'} blocked — the destination is unreachable.`));
    if (before.status === 'ok') {
      const strip = el('div', 'meta-strip');
      metaItem(strip, 'before (clear)', fmtMeters(before.totalDistance));
      card.appendChild(strip);
    }
  }

  card.appendChild(
    el('div', 'cmp-note', 'The original graph is never modified — routing runs on a cloned view with the blocked edges removed, so unblocking restores the exact prior state.'),
  );
  container.appendChild(card);
}

// ── provenance info panel ───────────────────────────────────────────────────

export function renderProvenanceInfo(container: HTMLElement): void {
  container.innerHTML = '';
  const card = el('div', 'panel-card');
  card.appendChild(el('div', 'panel-title', 'Data provenance — EPCOT'));
  card.appendChild(
    el(
      'p',
      'provenance-text',
      'Original schematic model built for a DSA demonstration from the publicly documented 2026 EPCOT layout. No Disney artwork, logos or map imagery is embedded. See src/data/datasets/epcot/provenance.md for the full record.',
    ),
  );

  const sec = (title: string, cls: string, body: string): void => {
    card.appendChild(el('div', `prov-sec ${cls}`, title));
    card.appendChild(el('div', 'provenance-text', body));
  };
  sec(
    'Verified (documented facts)',
    'ok',
    'Pavilion names and clockwise order; the three front-of-park neighbourhoods (Celebration / Discovery / Nature); the ≈1.2-mile lagoon perimeter; both entrances and the single showcase bridge; Canada replaced Spain (2024).',
  );
  sec(
    'Approximate (every spatial value)',
    'warn',
    'All coordinates and all edge weights are digitized/estimated from public maps (±20–50 m). Ring perimeter cross-check: 1952 m reconstructed vs ≈1931 m documented (+1.1%).',
  );
  sec(
    'Not modeled',
    '',
    'Individual shops & restaurants, queues, opening hours, seasonal events, transport, elevation; the retired Spain pavilion; minor hub structures that could not be placed accurately.',
  );
  container.appendChild(card);
}
