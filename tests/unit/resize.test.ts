import { describe, expect, it } from 'vitest';
import { applyViewportResize, type ResizeTargets } from '../../src/viz/resize';

/** Plain spy mocks — no three.js, no DOM. */
function makeTargets(): {
  targets: ResizeTargets;
  cameraUpdates: number;
  rendererSizes: Array<[number, number]>;
  composerSizes: Array<[number, number]>;
} {
  let cameraUpdates = 0;
  const rendererSizes: Array<[number, number]> = [];
  const composerSizes: Array<[number, number]> = [];
  const targets: ResizeTargets = {
    camera: {
      aspect: 1,
      updateProjectionMatrix() {
        cameraUpdates += 1;
      },
    },
    renderer: { setSize(w, h) { rendererSizes.push([w, h]); } },
    composer: { setSize(w, h) { composerSizes.push([w, h]); } },
  };
  return { targets, get cameraUpdates() { return cameraUpdates; }, rendererSizes, composerSizes };
}

describe('applyViewportResize (renderer / camera / composer size sync)', () => {
  it('updates camera aspect + projection, renderer size and composer size on a normal resize', () => {
    const m = makeTargets();
    const applied = applyViewportResize(1280, 720, m.targets);
    expect(applied).toBe(true);
    expect(m.targets.camera.aspect).toBeCloseTo(1280 / 720, 9);
    expect(m.cameraUpdates).toBe(1);
    expect(m.rendererSizes).toEqual([[1280, 720]]);
    expect(m.composerSizes).toEqual([[1280, 720]]);
  });

  it('skips transient 0×0 frames (the fullscreen-transition blank-canvas bug)', () => {
    const m = makeTargets();
    expect(applyViewportResize(0, 0, m.targets)).toBe(false);
    expect(m.cameraUpdates).toBe(0);
    expect(m.rendererSizes).toEqual([]);
    expect(m.composerSizes).toEqual([]);
  });

  it('skips sub-pixel (1×1) sizes as well', () => {
    const m = makeTargets();
    expect(applyViewportResize(1, 500, m.targets)).toBe(false);
    expect(applyViewportResize(500, 1, m.targets)).toBe(false);
    expect(m.cameraUpdates).toBe(0);
    expect(m.rendererSizes).toEqual([]);
  });

  it('still resizes camera + renderer when the composer is absent (Low quality)', () => {
    const m = makeTargets();
    m.targets.composer = null;
    expect(applyViewportResize(390, 844, m.targets)).toBe(true);
    expect(m.targets.camera.aspect).toBeCloseTo(390 / 844, 9);
    expect(m.rendererSizes).toEqual([[390, 844]]);
    expect(m.composerSizes).toEqual([]);
  });

  it('accumulates successive resizes (fullscreen enter + exit)', () => {
    const m = makeTargets();
    applyViewportResize(1226, 922, m.targets);
    applyViewportResize(1920, 1080, m.targets); // fullscreen
    applyViewportResize(1226, 922, m.targets); // exit
    expect(m.rendererSizes).toEqual([
      [1226, 922],
      [1920, 1080],
      [1226, 922],
    ]);
    expect(m.composerSizes).toEqual([
      [1226, 922],
      [1920, 1080],
      [1226, 922],
    ]);
    expect(m.targets.camera.aspect).toBeCloseTo(1226 / 922, 9);
  });
});
