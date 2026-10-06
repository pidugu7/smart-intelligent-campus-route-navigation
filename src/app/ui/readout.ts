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

function statRow(label: string, value: string, extra?: string): HTMLDivElement {
  const row = el('div', 'stat-row');
  row.appendChild(el('span', 'stat-label', label));
  const val = el('span', 'stat-value', value);
  row.appendChild(val);
  if (extra !== undefined) row.appendChild(el('span', 'stat-extra', extra));
  return row;
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

// ── route result ────────────────────────────────────────────────────────────

export function renderRouteResult(
  container: HTMLElement,
  result: RouteResult,
  algoLabel: string,
  routeLength: number | null,
): void {
  container.innerHTML = '';
  const card = el('div', 'panel-card');

  if (result.status === 'unreachable') {
    card.appendChild(el('div', 'panel-title', 'No route'));
    card.appendChild(
      el('div', 'result-bad', `${result.source.name} → ${result.target.name}: destination is UNREACHABLE (disconnected after blocks).`),
    );
    card.appendChild(statRow('Nodes explored', String(result.nodesExpanded)));
    container.appendChild(card);
    return;
  }

  const isBfs = algoLabel === 'BFS';
  card.appendChild(el('div', 'panel-title', `${algoLabel} route`));
  card.appendChild(
    el('div', 'route-endpoints', `${result.source.name} → ${result.target.name}`),
  );

  if (isBfs) {
    card.appendChild(
      statRow('Fewest hops', String(result.totalDistance), 'BFS cost = hops (weights ignored by design)'),
    );
    if (routeLength !== null) {
      card.appendChild(statRow('Route length', fmtMeters(routeLength), APPROX_BADGE));
      const t = estimateWalkTime(routeLength);
      card.appendChild(statRow('Walk time (est.)', fmtTime(t.estimatedSeconds), `at ${t.speedMetersPerSecond} m/s`));
    }
  } else {
    card.appendChild(statRow('Distance', fmtMeters(result.totalDistance), APPROX_BADGE));
    const t = estimateWalkTime(result.totalDistance);
    card.appendChild(statRow('Walk time (est.)', fmtTime(t.estimatedSeconds), `at ${t.speedMetersPerSecond} m/s`));
  }

  card.appendChild(statRow('Edges on route', String(result.path.length - 1)));
  card.appendChild(statRow('Nodes expanded', String(result.nodesExpanded)));
  card.appendChild(statRow('Trace steps', String(result.trace.length)));

  card.appendChild(el('div', 'provenance-note', `Distance based on ${APPROX_BADGE} — not a measured real-world value.`));
  container.appendChild(card);
}

// ── Dijkstra vs A* ──────────────────────────────────────────────────────────

export function renderComparison(container: HTMLElement, cmp: AlgorithmComparison): void {
  container.innerHTML = '';
  const card = el('div', 'panel-card');
  card.appendChild(el('div', 'panel-title', 'Dijkstra vs A*'));

  const table = el('table', 'cmp-table');
  const head = el('tr');
  head.appendChild(el('th', '', 'Metric'));
  head.appendChild(el('th', '', 'Dijkstra'));
  head.appendChild(el('th', '', 'A*'));
  table.appendChild(head);

  const row = (metric: string, d: string, a: string, dCls?: string, aCls?: string): void => {
    const tr = el('tr');
    tr.appendChild(el('td', 'cmp-metric', metric));
    tr.appendChild(el('td', dCls, d));
    tr.appendChild(el('td', aCls, a));
    table.appendChild(tr);
  };

  const dOk = cmp.dijkstra.status === 'ok';
  const aOk = cmp.astar.status === 'ok';
  row('Status', dOk ? 'ok' : 'unreachable', aOk ? 'ok' : 'unreachable');
  row('Distance', dOk ? fmtMeters(cmp.dijkstra.totalDistance!) : '—', aOk ? fmtMeters(cmp.astar.totalDistance!) : '—');
  row('Nodes expanded', String(cmp.dijkstra.nodesExpanded), String(cmp.astar.nodesExpanded));
  row('Trace steps', String(cmp.dijkstra.traceSteps), String(cmp.astar.traceSteps));
  const dTime = dOk ? fmtTime(estimateWalkTime(cmp.dijkstra.totalDistance!).estimatedSeconds) : '—';
  const aTime = aOk ? fmtTime(estimateWalkTime(cmp.astar.totalDistance!).estimatedSeconds) : '—';
  row('Est. time', dTime, aTime);
  card.appendChild(table);

  if (cmp.sameOptimalCost) {
    card.appendChild(
      el(
        'div',
        'cmp-note ok',
        '✓ Same optimal cost — A* with an admissible (Euclidean) heuristic finds the same optimal distance as Dijkstra.',
      ),
    );
  } else {
    card.appendChild(el('div', 'cmp-note bad', '✗ Costs differ — heuristic assumptions violated for this query.'));
  }
  card.appendChild(
    el(
      'div',
      'cmp-note',
      'Expansion counts are reported as measured: A* is NOT always faster — the saving depends on the heuristic and the graph (Δ nodes = Dijkstra − A* = ' +
        `${cmp.nodesExpandedDelta}).`,
    ),
  );
  card.appendChild(el('div', 'provenance-note', `Distances based on ${APPROX_BADGE}.`));
  container.appendChild(card);
}

// ── alternative route ───────────────────────────────────────────────────────

export function renderAlternative(container: HTMLElement, alt: AlternativeRouteResult): void {
  container.innerHTML = '';
  const card = el('div', 'panel-card');
  card.appendChild(el('div', 'panel-title', 'Alternative route'));

  if (alt.status === 'no-primary-route') {
    card.appendChild(el('div', 'result-bad', 'No primary route exists for this pair.'));
    container.appendChild(card);
    return;
  }
  const primary = alt.primary!;
  card.appendChild(statRow('Primary distance', fmtMeters(primary.totalDistance), 'cyan line'));
  if (alt.alternative === null) {
    card.appendChild(el('div', 'cmp-note', 'No distinct alternative route exists — the primary path is the only walkable route between these points.'));
    container.appendChild(card);
    return;
  }
  const other = alt.alternative;
  card.appendChild(statRow('Alternative distance', fmtMeters(other.totalDistance), 'orange line'));
  card.appendChild(statRow('Extra distance', `+${fmtMeters(other.totalDistance - primary.totalDistance)}`));
  const dt = estimateWalkTime(other.totalDistance).estimatedSeconds - estimateWalkTime(primary.totalDistance).estimatedSeconds;
  card.appendChild(statRow('Extra time (est.)', `+${fmtTime(dt)}`));
  card.appendChild(el('div', 'cmp-note', 'Guarantee: best cost among all SIMPLE paths distinct from the primary (second-best simple-path cost — not a general k-shortest listing).'));
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
  const card = el('div', 'panel-card');
  card.appendChild(el('div', 'panel-title', 'Blocked-path simulation'));

  card.appendChild(el('div', 'result-sub', `${blockedCount} walkway${blockedCount === 1 ? '' : 's'} blocked (shown with red ✕).`));

  if (after.status === 'ok') {
    if (before.status === 'ok') {
      card.appendChild(statRow('Before (clear path)', fmtMeters(before.totalDistance)));
      card.appendChild(statRow('After (re-routed)', fmtMeters(after.totalDistance)));
      const delta = after.totalDistance - before.totalDistance;
      card.appendChild(
        statRow(
          'Change',
          `${delta >= 0 ? '+' : '−'}${fmtMeters(Math.abs(delta))}`,
          `+${fmtTime(Math.abs(estimateWalkTime(after.totalDistance).estimatedSeconds - estimateWalkTime(before.totalDistance).estimatedSeconds))} est. time`,
        ),
      );
    } else {
      card.appendChild(el('div', 'result-sub', 'Before: unreachable · After: reachable (a block was removed).'));
      card.appendChild(statRow('After (re-routed)', fmtMeters(after.totalDistance)));
    }
  } else {
    card.appendChild(
      el('div', 'result-bad', `✗ Destination became UNREACHABLE with these walkways blocked.`),
    );
    if (before.status === 'ok') {
      card.appendChild(statRow('Before (clear path)', fmtMeters(before.totalDistance)));
    }
  }

  card.appendChild(
    el('div', 'cmp-note', 'The original graph is never modified — routing runs on a cloned view, so unblocking restores the exact prior state.'),
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
