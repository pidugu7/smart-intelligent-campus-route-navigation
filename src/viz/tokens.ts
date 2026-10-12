/**
 * viz/tokens.ts
 *
 * Scene-side design tokens: the three atmospheric "moods" and the quality
 * tiers. The SceneManager tweens between moods (animated mode transition);
 * the CampusMeshes' material registry exposes hookable material slots so a
 * mood can re-tint ground / water / lamps without touching any logic.
 *
 * All values are plain numbers — the manager converts to THREE.Color at
 * application time, so this module stays unit-testable without WebGL.
 */

export type MoodName = 'twilight' | 'night' | 'blueprint';
export type QualityName = 'high' | 'balanced' | 'low';

export interface Mood {
  /** Sky dome gradient (top → mid → horizon). */
  skyTop: number;
  skyMid: number;
  skyHorizon: number;
  /** Fog colour + depth range. */
  fogColor: number;
  fogNear: number;
  fogFar: number;
  /** Hemisphere (ambient) light. */
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /** Warm key light (soft shadows). */
  keyColor: number;
  keyIntensity: number;
  /** Cool fill light (no shadows). */
  fillColor: number;
  fillIntensity: number;
  /** Lagoon shader colours + sparkle amount (0..1). */
  waterDeep: number;
  waterShallow: number;
  waterSparkle: number;
  /** Ground tint (multiplied over the gradient texture). */
  groundColor: number;
  /** Star field opacity (0..1) and lamp glow (0..1). */
  stars: number;
  lampGlow: number;
  /** Blueprint mode: extra emissive lift on graph nodes (0..1). */
  nodeGlow: number;
  /** Overall scene brightness multiplier applied to key/fill. */
  exposure: number;
  /** Warm sun-glow band near the horizon (0..1). */
  sunGlow: number;
}

export const MOODS: Record<MoodName, Mood> = {
  /**
   * Guest "day" default: a real daylight sky — warm cream horizon (soft
   * golden-hour light) rising to a calm blue zenith, with a subtle sun
   * glow low in the west and light warm fog that dissolves the island
   * edge into the horizon. Not a dusk, not a red backdrop.
   */
  twilight: {
    skyTop: 0x6fa3d8,
    skyMid: 0x9fc0e4,
    skyHorizon: 0xf0d2ae,
    fogColor: 0xcbb096,
    fogNear: 2400,
    fogFar: 7400,
    hemiSky: 0xcfe0f5,
    hemiGround: 0x77836a,
    hemiIntensity: 1.2,
    keyColor: 0xfff0d6,
    keyIntensity: 2.3,
    fillColor: 0xa8c4e6,
    fillIntensity: 0.75,
    waterDeep: 0x17506b,
    waterShallow: 0x5cb8c8,
    waterSparkle: 0.4,
    groundColor: 0xbcc9ad,
    stars: 0.0,
    lampGlow: 0.12,
    nodeGlow: 0,
    exposure: 1.05,
    sunGlow: 0.55,
  },
  /** Deep night: stars out, lamps carry the scene, water reflects. */
  night: {
    skyTop: 0x04070f,
    skyMid: 0x0a1224,
    skyHorizon: 0x1c2745,
    fogColor: 0x070d1a,
    fogNear: 2000,
    fogFar: 6200,
    hemiSky: 0x6f86b8,
    hemiGround: 0x10141f,
    hemiIntensity: 0.5,
    keyColor: 0x9db4dd,
    keyIntensity: 0.55,
    fillColor: 0x22304d,
    fillIntensity: 0.45,
    waterDeep: 0x081826,
    waterShallow: 0x1e4f63,
    waterSparkle: 0.95,
    groundColor: 0x6f8272,
    stars: 1.0,
    lampGlow: 1.0,
    nodeGlow: 0,
    exposure: 0.92,
    sunGlow: 0.12,
  },
  /** Engineer: dark glass / holographic blueprint, cyan-teal energy. */
  blueprint: {
    skyTop: 0x030609,
    skyMid: 0x061018,
    skyHorizon: 0x0a2230,
    fogColor: 0x05131c,
    fogNear: 1800,
    fogFar: 5800,
    hemiSky: 0x2a7a8e,
    hemiGround: 0x04141a,
    hemiIntensity: 0.75,
    keyColor: 0x7fd8e8,
    keyIntensity: 0.75,
    fillColor: 0x2a4a66,
    fillIntensity: 0.5,
    waterDeep: 0x06222e,
    waterShallow: 0x1a5a6e,
    waterSparkle: 0.3,
    groundColor: 0x7c94a0,
    stars: 0.3,
    lampGlow: 0.55,
    nodeGlow: 1.0,
    exposure: 0.95,
    sunGlow: 0.04,
  },
};

export interface QualityTier {
  /** Render through the post-processing composer at all. */
  composer: boolean;
  bloom: boolean;
  ssao: boolean;
  vignette: boolean;
  /** Max device pixel ratio. */
  dprCap: number;
  /** Shadow map size (0 disables shadows). */
  shadowMap: number;
}

export const QUALITY: Record<QualityName, QualityTier> = {
  high: { composer: true, bloom: true, ssao: true, vignette: true, dprCap: 2, shadowMap: 2048 },
  balanced: { composer: true, bloom: true, ssao: false, vignette: true, dprCap: 1.5, shadowMap: 1024 },
  low: { composer: false, bloom: false, ssao: false, vignette: false, dprCap: 1, shadowMap: 0 },
};

/** Deterministic 32-bit PRNG (mulberry32) — instanced decoration placement. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
