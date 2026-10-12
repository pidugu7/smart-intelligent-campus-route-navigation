/**
 * viz/resize.ts
 *
 * Pure viewport-resize application (duck-typed, no three.js imports) so
 * the "never render at 0×0" rule and the exact set of resized objects
 * (camera aspect + projection, renderer, composer) can be unit-tested
 * with plain mocks.
 *
 * The SceneManager calls this from its ResizeObserver, the
 * fullscreenchange handler and the webglcontextrestored handler.
 */

export interface ResizableCamera {
  aspect: number;
  updateProjectionMatrix(): void;
}

export interface ResizableRenderer {
  setSize(width: number, height: number): void;
}

export interface ResizableComposer {
  setSize(width: number, height: number): void;
}

export interface ResizeTargets {
  camera: ResizableCamera;
  renderer: ResizableRenderer;
  composer?: ResizableComposer | null;
}

/**
 * Apply a container size change to every size-dependent object.
 * @returns false when the change was SKIPPED (transient 0×0 frame during
 *          a fullscreen transition — rendering at that size blanks the
 *          canvas).
 */
export function applyViewportResize(width: number, height: number, targets: ResizeTargets): boolean {
  if (width < 2 || height < 2) return false;
  targets.camera.aspect = width / height;
  targets.camera.updateProjectionMatrix();
  targets.renderer.setSize(width, height);
  if (targets.composer !== null && targets.composer !== undefined) {
    targets.composer.setSize(width, height);
  }
  return true;
}
