import { GraphError } from '../graph/graph';

/**
 * Estimated walking time for a route of a given length.
 *
 * This is a DECLARED ASSUMPTION, not measured data: a comfortable urban
 * walking speed of 1.4 m/s (≈ 5 km/h), a standard value in pedestrian
 * planning. The result is an estimate for display only — never present it
 * as a GPS-grade figure. The metric is dataset-independent (EPCOT today,
 * Amrita tomorrow): the engine sees metres in and seconds out.
 */
export const DEFAULT_WALKING_SPEED_M_PER_S = 1.4;

export interface WalkTimeEstimate {
  /** Route length in metres (from a RouteResult.totalDistance). */
  distanceMeters: number;
  /** The declared walking speed used (m/s). */
  speedMetersPerSecond: number;
  /** distanceMeters / speedMetersPerSecond. */
  estimatedSeconds: number;
  /** estimatedSeconds / 60. */
  estimatedMinutes: number;
  /** Always true: this is an estimate from a declared speed, not a measurement. */
  isEstimate: true;
  /** Human-readable label for the UI. */
  note: string;
}

/**
 * Estimate the walking time of a distance. O(1).
 * @throws GraphError on negative/non-finite distances or non-positive speeds.
 */
export function estimateWalkTime(
  distanceMeters: number,
  speedMetersPerSecond: number = DEFAULT_WALKING_SPEED_M_PER_S,
): WalkTimeEstimate {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new GraphError(`distance must be a finite, non-negative number of metres (got ${String(distanceMeters)})`);
  }
  if (!Number.isFinite(speedMetersPerSecond) || speedMetersPerSecond <= 0) {
    throw new GraphError(`walking speed must be finite and > 0 m/s (got ${String(speedMetersPerSecond)})`);
  }
  const estimatedSeconds = distanceMeters / speedMetersPerSecond;
  return {
    distanceMeters,
    speedMetersPerSecond,
    estimatedSeconds,
    estimatedMinutes: estimatedSeconds / 60,
    isEstimate: true,
    note: `estimate at declared walking speed ${speedMetersPerSecond} m/s (not measured)`,
  };
}
