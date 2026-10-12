import { describe, expect, it } from 'vitest';
import { MOODS, QUALITY, type MoodName } from '../../src/viz/tokens';

describe('mood tokens (atmosphere invariants)', () => {
  it('defines all three moods', () => {
    expect(Object.keys(MOODS).sort()).toEqual(['blueprint', 'night', 'twilight']);
  });

  it('fog colour EXACTLY matches the sky horizon in every mood (seamless horizon blend)', () => {
    for (const name of Object.keys(MOODS) as MoodName[]) {
      const m = MOODS[name];
      expect(m.fogColor, `fogColor must equal skyHorizon in mood "${name}"`).toBe(m.skyHorizon);
    }
  });

  it('keeps fog near < far in every mood', () => {
    for (const name of Object.keys(MOODS) as MoodName[]) {
      const m = MOODS[name];
      expect(m.fogNear).toBeLessThan(m.fogFar);
    }
  });

  it('night stays a readable dusk (no near-black sky, ground lifted)', () => {
    const n = MOODS.night;
    const lum = (hex: number): number => {
      const r = (hex >> 16) & 0xff;
      const g = (hex >> 8) & 0xff;
      const b = hex & 0xff;
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    expect(lum(n.skyTop)).toBeGreaterThan(0.06); // sky top not pure black
    expect(lum(n.skyHorizon)).toBeGreaterThan(0.12); // horizon visibly lit
    expect(lum(n.groundColor)).toBeGreaterThan(0.28); // ground readable
    expect(n.stars).toBeGreaterThan(0); // subtle stars on
  });
});

describe('quality tokens (render tiers)', () => {
  it('defines high / balanced / low with monotonic detail', () => {
    expect(Object.keys(QUALITY).sort()).toEqual(['balanced', 'high', 'low']);
    expect(QUALITY.high.dprCap).toBeGreaterThanOrEqual(QUALITY.balanced.dprCap);
    expect(QUALITY.balanced.dprCap).toBeGreaterThanOrEqual(QUALITY.low.dprCap);
    expect(QUALITY.high.composer).toBe(true);
    expect(QUALITY.low.composer).toBe(false);
  });
});
