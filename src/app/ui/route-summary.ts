import { estimateWalkTime } from '../../engine/engine';
import { fmtDistance, fmtTime } from './readout';

/**
 * The "Your route" sheet's always-visible summary line (pure — unit-testable).
 *
 * SINGLE SOURCE OF TRUTH for walk time: the engine's `estimateWalkTime`
 * (declared 1.4 m/s) plus the shared `fmtTime`/`fmtDistance` formatters —
 * the exact same calls the guest hero card and the engineer result panel
 * use. `tests/unit/route-summary.test.ts` fails if this line and the card
 * expressions ever disagree.
 *
 * @param meters route length in metres (for BFS: the digitised metre length
 *        of the fewest-hop path, resolved by the caller).
 * @param algoLabel algorithm display name (e.g. "Dijkstra").
 * @param bfsStops when the algorithm is BFS, its hop count (totalDistance),
 *        shown as a "N stops" prefix — same wording as the other surfaces.
 */
export function buildSheetSummaryLine(meters: number, algoLabel: string, bfsStops?: number): string {
  const walk = fmtTime(estimateWalkTime(meters).estimatedSeconds);
  const stops = bfsStops !== undefined ? `${bfsStops} stops · ` : '';
  return `${stops}${fmtDistance(meters)} · ≈ ${walk} walk · ${algoLabel}`;
}
