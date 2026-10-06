/**
 * viz/scene.ts
 *
 * SceneManager — renderer, perspective camera, OrbitControls, lights and the
 * render loop. Everything else (campus meshes, route layer) is added to
 * `this.scene` by its owner; the manager also provides:
 *   - frameAll()    fit the camera to the current scene bounds (initial view / reset)
 *   - focusOn()     smooth camera tween onto a selected location
 *   - tick-driven per-frame updates (label scaling, route pulse, tweening)
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const SCENE_BACKGROUND = 0x0b1220;

const INITIAL_DIRECTION = new THREE.Vector3(0.42, 0.9, 0.66).normalize(); // 3/4 aerial from the south-east
const UP = new THREE.Vector3(0, 1, 0);
const FOCUS_DISTANCE = 240;
const TWEEN_SECONDS = 0.9;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;

  /** Per-frame subscribers: called with delta seconds. */
  private readonly tickers = new Set<(dt: number, t: number) => void>();

  private tween: {
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    elapsed: number;
  } | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SCENE_BACKGROUND);
    this.scene.fog = new THREE.Fog(SCENE_BACKGROUND, 2600, 6500);

    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(50, aspect, 1, 20000);
    this.camera.position.set(0, 400, 1500);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.485; // stay above the ground
    this.controls.minDistance = 60;
    this.controls.maxDistance = 5200;
    this.controls.target.set(0, 0, 0);
    // User input cancels any running camera tween (no fighting the tween).
    this.controls.addEventListener('start', () => {
      this.tween = null;
    });

    // Lights: soft ambient hemisphere + one shadow-casting sun.
    const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x1c2536, 1.05);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2df, 1.6);
    sun.position.set(650, 1100, -420);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -700;
    sun.shadow.camera.right = 700;
    sun.shadow.camera.top = 700;
    sun.shadow.camera.bottom = -700;
    sun.shadow.camera.far = 4000;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);

    this.loop();
  }

  /** Register a per-frame callback (label scaling, pulses, …). */
  onTick(fn: (dt: number, t: number) => void): () => void {
    this.tickers.add(fn);
    return () => this.tickers.delete(fn);
  }

  /**
   * Fit the camera so the whole bounding box is visible from the canonical
   * 3/4 aerial direction. Uses an exact box→frustum fit (project every box
   * corner into the view and solve for the distance at which all corners
   * land inside the frustum) — tight for elongated layouts like a teardrop
   * park, and generic for any dataset's bounds.
   */
  frameAll(box: THREE.Box3, animate = false): void {
    const center = box.getCenter(new THREE.Vector3());
    const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);

    const fwd = INITIAL_DIRECTION.clone().negate(); // camera → target
    const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();

    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const tanH = tanV * this.camera.aspect;

    let distance = 1;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const corner = new THREE.Vector3(
            center.x + sx * half.x,
            center.y + sy * half.y,
            center.z + sz * half.z,
          ).sub(center);
          const z = Math.max(1, corner.dot(fwd)); // depth of the corner beyond the center
          const x = Math.abs(corner.dot(right));
          const y = Math.abs(corner.dot(up));
          // At camera distance D the corner sits at depth D + z:
          distance = Math.max(distance, x / tanH - z, y / tanV - z);
        }
      }
    }
    distance *= 1.1; // margin

    const toPos = center.clone().addScaledVector(INITIAL_DIRECTION, distance);
    if (animate) {
      this.startTween(toPos, center);
    } else {
      this.camera.position.copy(toPos);
      this.controls.target.copy(center);
      this.camera.near = Math.max(1, distance / 100);
      this.camera.far = distance * 8;
      this.camera.updateProjectionMatrix();
      this.controls.update();
    }
  }

  /** Smoothly move the camera to look at a world position from the current viewing direction. */
  focusOn(worldPos: THREE.Vector3, distance = FOCUS_DISTANCE): void {
    const dir = this.camera.position.clone().sub(this.controls.target);
    dir.y = Math.abs(dir.y);
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 1);
    dir.normalize();
    const toPos = worldPos.clone().addScaledVector(dir, distance);
    toPos.y = Math.max(toPos.y, worldPos.y + distance * 0.25);
    this.startTween(toPos, worldPos.clone());
  }

  private startTween(toPos: THREE.Vector3, toTarget: THREE.Vector3): void {
    this.tween = {
      fromPos: this.camera.position.clone(),
      toPos,
      fromTarget: this.controls.target.clone(),
      toTarget,
      elapsed: 0,
    };
  }

  private onResize(): void {
    const w = this.container.clientWidth;
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;

    if (this.tween !== null) {
      this.tween.elapsed += dt;
      const k = easeInOutCubic(Math.min(1, this.tween.elapsed / TWEEN_SECONDS));
      this.camera.position.lerpVectors(this.tween.fromPos, this.tween.toPos, k);
      this.controls.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, k);
      if (this.tween.elapsed >= TWEEN_SECONDS) this.tween = null;
    }

    this.controls.update();
    for (const fn of this.tickers) fn(dt, t);
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
