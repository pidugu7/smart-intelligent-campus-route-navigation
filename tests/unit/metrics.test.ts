import { describe, expect, it } from 'vitest';
import { GraphError } from '../../src/engine/graph/graph';
import { DEFAULT_WALKING_SPEED_M_PER_S, estimateWalkTime } from '../../src/engine/routing/metrics';

describe('walk-time metrics (declared assumption: 1.4 m/s)', () => {
  it('uses the declared default walking speed of 1.4 m/s', () => {
    expect(DEFAULT_WALKING_SPEED_M_PER_S).toBe(1.4);
  });

  it('estimates 1400 m at 1.4 m/s as 1000 s (~16.67 min)', () => {
    const m = estimateWalkTime(1400);
    expect(m.distanceMeters).toBe(1400);
    expect(m.speedMetersPerSecond).toBe(1.4);
    // 1400 / 1.4 is 1000.0000000000001 in IEEE 754 — compare with a tolerance
    expect(m.estimatedSeconds).toBeCloseTo(1000, 9);
    expect(m.estimatedMinutes).toBeCloseTo(16.6667, 4);
  });

  it('handles zero distance', () => {
    const m = estimateWalkTime(0);
    expect(m.estimatedSeconds).toBe(0);
    expect(m.estimatedMinutes).toBe(0);
  });

  it('supports a custom declared speed', () => {
    const m = estimateWalkTime(1400, 1.0);
    expect(m.speedMetersPerSecond).toBe(1);
    expect(m.estimatedSeconds).toBe(1400);
  });

  it('is explicitly labelled as an estimate', () => {
    const m = estimateWalkTime(100);
    expect(m.isEstimate).toBe(true);
    expect(m.note).toMatch(/estimate/i);
    expect(m.note).toMatch(/not measured/i);
  });

  it('rejects invalid inputs', () => {
    expect(() => estimateWalkTime(-1)).toThrow(GraphError);
    expect(() => estimateWalkTime(Number.NaN)).toThrow(GraphError);
    expect(() => estimateWalkTime(100, 0)).toThrow(GraphError);
    expect(() => estimateWalkTime(100, Number.NaN)).toThrow(GraphError);
  });
});
