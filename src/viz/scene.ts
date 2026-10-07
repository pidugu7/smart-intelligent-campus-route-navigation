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

export type TimeOfDay = 'day' | 'night';
export type RenderQuality = 'high' | 'low';

const INITIAL_DIRECTION = new THREE.Vector3(0.38, 0.74, 0.64).normalize(); // lower 3/4 aerial — park reads as a landscape, not a top-down map
const UP = new THREE.Vector3(0, 1, 0);
const FOCUS_DISTANCE = 240;
const TWEEN_SECONDS = 0.9;

/**
 * Lighting / atmosphere presets. 'day' is the calibrated Phase 4 look
 * (kept as the default so the tuned palette never shifts); 'night' is a
 * darker, cooler mood. Both keep the same light RIG — only intensities,
 * colours, sky and fog change.
 */
const TIME_PRESETS: Record<
  TimeOfDay,
  {
    background: number;
    fogNear: number;
    fogFar: number;
    hemiSky: number;
    hemiGround: number;
    hemiIntensity: number;
    sunColor: number;
    sunIntensity: number;
  }
> = {
  day: {
    background: 0x0b1220,
    fogNear: 2600,
    fogFar: 6500,
    hemiSky: 0xbfd9ff,
    hemiGround: 0x1c2536,
    hemiIntensity: 1.05,
    sunColor: 0xfff2df,
    sunIntensity: 1.6,
  },
  night: {
    background: 0x070c16,
    fogNear: 2200,
    fogFar: 6000,
    hemiSky: 0x8fb0e4,
    hemiGround: 0x0d1320,
    hemiIntensity: 0.75,
    sunColor: 0xbcd0f0,
    sunIntensity: 0.55,
  },
};

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface FlightKeyframe {
  pos: THREE.Vector3;
  tgt: THREE.Vector3;
  /** Cumulative path length at this keyframe (for constant-speed timing). */
  dist: number;
}

export interface FlightOptions {
  /** Total flight duration in seconds (clamped to a calm range). */
  duration?: number;
  /** Fired once when the flight completes (not when it is cancelled). */
  onDone?: () => void;
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

  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private currentTime: TimeOfDay = 'day';

  get timeOfDay(): TimeOfDay {
    return this.currentTime;
  }

  /** Cinematic route flight (cancel by user orbiting). */
  private flight: {
    keys: FlightKeyframe[];
    totalDist: number;
    elapsed: number;
    duration: number;
    onDone?: () => void;
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
    this.controls.minDistance = 70;
    // Zoom-out cap: the park spans ~1500 m, so 2400 m is already a wide
    // overview — this keeps the park filling the viewport (no empty sky).
    this.controls.maxDistance = 2400;
    this.controls.target.set(0, 0, 0);
    // User input cancels any running camera tween or cinematic flight
    // (no fighting the camera).
    this.controls.addEventListener('start', () => {
      this.tween = null;
      if (this.flight !== null) {
        this.flight = null; // cancelled — onDone intentionally not fired
      }
    });

    // Lights: soft ambient hemisphere + one shadow-casting sun.
    this.hemi = new THREE.HemisphereLight(0xbfd9ff, 0x1c2536, 1.05);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2df, 1.6);
    this.sun.position.set(650, 1100, -420);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -700;
    this.sun.shadow.camera.right = 700;
    this.sun.shadow.camera.top = 700;
    this.sun.shadow.camera.bottom = -700;
    this.sun.shadow.camera.far = 4000;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);

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
    distance *= 1.03; // tight framing: the park fills the viewport (Phase 6)

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

  // ── atmosphere & quality (canvas toolbar) ────────────────────────────────

  /** Switch lighting/sky between the calibrated 'day' look and 'night'. */
  setTimeOfDay(mode: TimeOfDay): void {
    this.currentTime = mode;
    const p = TIME_PRESETS[mode];
    this.scene.background = new THREE.Color(p.background);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.set(p.background);
    fog.near = p.fogNear;
    fog.far = p.fogFar;
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunIntensity;
  }

  /** 'high' = capped devicePixelRatio, 'low' = 1× (for weaker GPUs). */
  setQuality(level: RenderQuality): void {
    this.renderer.setPixelRatio(level === 'high' ? Math.min(window.devicePixelRatio, 2) : 1);
  }

  /**
   * Cinematic route intro: glide the camera above the path from origin to
   * destination, then settle into a destination-facing 3/4 view.
   *
   * Kept subtle on purpose: constant (speed-proportional) motion, gentle
   * height, no banking — and it is skipped entirely by the caller when
   * prefers-reduced-motion is set. Any user orbit cancels it immediately.
   */
  flyAlong(pathPoints: readonly THREE.Vector3[], opts: FlightOptions = {}): void {
    if (pathPoints.length < 2) return;

    // Camera side: a consistent perpendicular offset so the flight does not
    // cross over the route. Derived from the overall origin→destination axis.
    const overall = pathPoints[pathPoints.length - 1]!.clone().sub(pathPoints[0]!);
    overall.y = 0;
    if (overall.lengthSq() < 1e-6) overall.set(0, 0, 1);
    overall.normalize();
    const side = new THREE.Vector3().crossVectors(overall, UP).normalize().multiplyScalar(58);

    const H = 88; // flight altitude above the path
    const keys: FlightKeyframe[] = [];
    let dist = 0;
    const push = (pos: THREE.Vector3, tgt: THREE.Vector3): void => {
      dist += keys.length > 0 ? pos.distanceTo(keys[keys.length - 1]!.pos) : 0;
      keys.push({ pos: pos.clone(), tgt: tgt.clone(), dist });
    };

    // Keyframes: above every path vertex (skipping none — paths are short).
    for (let i = 0; i < pathPoints.length; i += 1) {
      const p = pathPoints[i]!;
      const pos = p.clone().add(new THREE.Vector3(0, H, 0)).add(side);
      // Look slightly ahead along the route (toward the next vertex).
      const look = pathPoints[Math.min(i + 1, pathPoints.length - 1)]!.clone();
      look.y = 6;
      push(pos, look);
    }
    // Final keyframe: pull back to a calm destination-facing 3/4 view.
    const dest = pathPoints[pathPoints.length - 1]!;
    push(dest.clone().addScaledVector(INITIAL_DIRECTION, 330).add(new THREE.Vector3(0, 60, 0)), dest.clone().add(new THREE.Vector3(0, 8, 0)));

    const flight: {
      keys: FlightKeyframe[];
      totalDist: number;
      elapsed: number;
      duration: number;
      onDone?: () => void;
    } = {
      keys,
      totalDist: dist,
      elapsed: 0,
      duration: THREE.MathUtils.clamp(opts.duration ?? 5, 3, 9),
    };
    if (opts.onDone !== undefined) flight.onDone = opts.onDone;
    this.flight = flight;
    this.tween = null;
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
    } else if (this.flight !== null) {
      this.flight.elapsed += dt;
      const u = Math.min(1, this.flight.elapsed / this.flight.duration);
      const targetDist = u * this.flight.totalDist;
      // Find the segment whose cumulative span contains targetDist.
      const keys = this.flight.keys;
      let i = 0;
      while (i + 1 < keys.length - 1 && keys[i + 1]!.dist < targetDist) i += 1;
      const a = keys[i]!;
      const b = keys[i + 1]!;
      const span = b.dist - a.dist;
      const t = span > 1e-6 ? (targetDist - a.dist) / span : 1;
      this.camera.position.lerpVectors(a.pos, b.pos, t);
      this.controls.target.lerpVectors(a.tgt, b.tgt, t);
      if (u >= 1) {
        const done = this.flight.onDone;
        this.flight = null;
        done?.();
      }
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
