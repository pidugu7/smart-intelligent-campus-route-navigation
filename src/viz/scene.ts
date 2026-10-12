/**
 * viz/scene.ts
 *
 * SceneManager — renderer, camera, OrbitControls, atmosphere and the render
 * loop. Phase 7 additions:
 *   - gradient sky dome + star field (uniform-driven, mood-animated)
 *   - IBL via RoomEnvironment (PBR ambience, no external HDR files)
 *   - key (warm, shadow-casting) + fill (cool) + hemisphere lights
 *   - post-processing chain: SSAO (high) → UnrealBloom → Vignette → Output,
 *     all toggleable via the 3-tier quality setting
 *   - animated MOOD system: the scene tweens between "twilight", "night"
 *     and "blueprint" (the Guest ↔ Engineer transition)
 *   - cinematic intro fly-in and a "follow target" camera mode
 *
 * Everything else (campus meshes, route layer) is added to `this.scene` by
 * its owner. The mood system reaches into the world only through
 * `MoodHooks` registered by the world builder — no logic lives here.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MOODS, QUALITY, type Mood, type MoodName, type QualityName } from './tokens';
import { applyViewportResize } from './resize';

/** Fallback clear colour (the sky dome overpaints it every frame). */
export const SCENE_BACKGROUND = 0x6fa3d8;

/**
 * Direction of the "sun" for the sky-glow band and water glint. Low in the
 * west — deliberately a *visual* constant, unrelated to the shadow-casting
 * key light's position.
 */
export const SUN_DIR = new THREE.Vector3(0.55, 0.16, -0.35).normalize();

/** Shared scratch for the water-sparkle colour (no per-frame allocation). */
const SPARKLE_WHITE = new THREE.Color(0xffffff);

export type TimeOfDay = 'day' | 'night';
/** 'high' | 'balanced' | 'low' — three tiers, one knob each in the toolbar. */
export type RenderQuality = QualityName;

const INITIAL_DIRECTION = new THREE.Vector3(0.38, 0.74, 0.64).normalize();
const UP = new THREE.Vector3(0, 1, 0);
const FOCUS_DISTANCE = 240;
const TWEEN_SECONDS = 0.9;
const MOOD_TWEEN_SECONDS = 0.85;

const SKY_RADIUS = 7000;
const STAR_COUNT = 650;

/**
 * Material/uniform slots the mood system may re-tint per frame. The world
 * builder (campus-mesh.ts) registers its instances once after construction.
 */
export interface MoodHooks {
  /** Ground top material (coloured over a gradient texture). */
  groundMat: THREE.MeshStandardMaterial;
  /** Lagoon shader uniforms. */
  water: {
    uDeep: THREE.IUniform<THREE.Color>;
    uShallow: THREE.IUniform<THREE.Color>;
    uSparkle: THREE.IUniform<number>;
    uFogColor: THREE.IUniform<THREE.Color>;
    uFogNear: THREE.IUniform<number>;
    uFogFar: THREE.IUniform<number>;
    /** Sky tint the water reflects at grazing angles. */
    uSky: THREE.IUniform<THREE.Color>;
    /** Sparkle point colour. */
    uSparkleColor: THREE.IUniform<THREE.Color>;
    /** 1 = full ripple detail, 0 = flat (Low quality). */
    uDetail: THREE.IUniform<number>;
    /** 0..1 fraction of sparkle points alive (cheaper on Low). */
    uDensity: THREE.IUniform<number>;
  };
  /** Terrain skirt below the island edge (mood-tinted soil gradient). */
  skirtMat: THREE.MeshStandardMaterial;
  /** Horizon floor that dissolves into the fog colour. */
  skirtFadeMat: THREE.MeshStandardMaterial;
  /** Lamp-head material (emissive intensity = lampGlow × constant). */
  lampHeadMat: THREE.MeshStandardMaterial;
  /** Eiffel lattice material — soft warm landmark glow, strongest at night. */
  eiffelGlowMat?: THREE.MeshStandardMaterial;
  /** Spaceship Earth shell — subtle emissive sheen, lifted slightly at night. */
  spaceshipSheenMat?: THREE.MeshStandardMaterial;
  /** Graph node materials (blueprint mode lifts their emissive). */
  nodeMats: THREE.MeshStandardMaterial[];
  /** Walkway materials (blueprint mode gives them a faint holographic lift). */
  walkwayMats: THREE.MeshStandardMaterial[];
}

interface FlightKeyframe {
  pos: THREE.Vector3;
  tgt: THREE.Vector3;
  dist: number;
}

export interface FlightOptions {
  duration?: number;
  onDone?: () => void;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ── mood state (preallocated; lerp'd per frame during the tween) ───────────

interface MoodState {
  skyTop: THREE.Color;
  skyMid: THREE.Color;
  skyHorizon: THREE.Color;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  keyColor: THREE.Color;
  keyIntensity: number;
  fillColor: THREE.Color;
  fillIntensity: number;
  rimColor: THREE.Color;
  rimIntensity: number;
  waterDeep: THREE.Color;
  waterShallow: THREE.Color;
  waterSparkle: number;
  groundColor: THREE.Color;
  stars: number;
  lampGlow: number;
  nodeGlow: number;
  exposure: number;
  sunGlow: number;
}

function moodStateFrom(m: Mood): MoodState {
  return {
    skyTop: new THREE.Color(m.skyTop),
    skyMid: new THREE.Color(m.skyMid),
    skyHorizon: new THREE.Color(m.skyHorizon),
    fogColor: new THREE.Color(m.fogColor),
    fogNear: m.fogNear,
    fogFar: m.fogFar,
    hemiSky: new THREE.Color(m.hemiSky),
    hemiGround: new THREE.Color(m.hemiGround),
    hemiIntensity: m.hemiIntensity,
    keyColor: new THREE.Color(m.keyColor),
    keyIntensity: m.keyIntensity,
    fillColor: new THREE.Color(m.fillColor),
    fillIntensity: m.fillIntensity,
    rimColor: new THREE.Color(m.rimColor),
    rimIntensity: m.rimIntensity,
    waterDeep: new THREE.Color(m.waterDeep),
    waterShallow: new THREE.Color(m.waterShallow),
    waterSparkle: m.waterSparkle,
    groundColor: new THREE.Color(m.groundColor),
    stars: m.stars,
    lampGlow: m.lampGlow,
    nodeGlow: m.nodeGlow,
    exposure: m.exposure,
    sunGlow: m.sunGlow,
  };
}

function lerpMood(live: MoodState, dest: MoodState, k: number): void {
  live.skyTop.lerp(dest.skyTop, k);
  live.skyMid.lerp(dest.skyMid, k);
  live.skyHorizon.lerp(dest.skyHorizon, k);
  live.fogColor.lerp(dest.fogColor, k);
  live.fogNear = THREE.MathUtils.lerp(live.fogNear, dest.fogNear, k);
  live.fogFar = THREE.MathUtils.lerp(live.fogFar, dest.fogFar, k);
  live.hemiSky.lerp(dest.hemiSky, k);
  live.hemiGround.lerp(dest.hemiGround, k);
  live.hemiIntensity = THREE.MathUtils.lerp(live.hemiIntensity, dest.hemiIntensity, k);
  live.keyColor.lerp(dest.keyColor, k);
  live.keyIntensity = THREE.MathUtils.lerp(live.keyIntensity, dest.keyIntensity, k);
  live.fillColor.lerp(dest.fillColor, k);
  live.fillIntensity = THREE.MathUtils.lerp(live.fillIntensity, dest.fillIntensity, k);
  live.rimColor.lerp(dest.rimColor, k);
  live.rimIntensity = THREE.MathUtils.lerp(live.rimIntensity, dest.rimIntensity, k);
  live.waterDeep.lerp(dest.waterDeep, k);
  live.waterShallow.lerp(dest.waterShallow, k);
  live.waterSparkle = THREE.MathUtils.lerp(live.waterSparkle, dest.waterSparkle, k);
  live.groundColor.lerp(dest.groundColor, k);
  live.stars = THREE.MathUtils.lerp(live.stars, dest.stars, k);
  live.lampGlow = THREE.MathUtils.lerp(live.lampGlow, dest.lampGlow, k);
  live.nodeGlow = THREE.MathUtils.lerp(live.nodeGlow, dest.nodeGlow, k);
  live.exposure = THREE.MathUtils.lerp(live.exposure, dest.exposure, k);
  live.sunGlow = THREE.MathUtils.lerp(live.sunGlow, dest.sunGlow, k);
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

  private readonly tickers = new Set<(dt: number, t: number) => void>();

  private tween: {
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    elapsed: number;
    duration: number;
  } | null = null;

  private flight: {
    keys: FlightKeyframe[];
    totalDist: number;
    elapsed: number;
    duration: number;
    onDone?: () => void;
  } | null = null;

  // ── atmosphere ─────────────────────────────────────────────────────────
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly fill: THREE.DirectionalLight;
  private readonly rim: THREE.DirectionalLight;
  private readonly skyUniforms: {
    uTop: THREE.IUniform<THREE.Color>;
    uMid: THREE.IUniform<THREE.Color>;
    uHorizon: THREE.IUniform<THREE.Color>;
    uGlowAmount: THREE.IUniform<number>;
  };
  private readonly starMaterial: THREE.PointsMaterial;
  private readonly mood: MoodState;
  private moodDest: MoodState | null = null;
  private moodProgress = 1; // 1 = settled
  private moodName: MoodName = 'twilight';
  private hooksRef: MoodHooks | null = null;

  // ── post-processing ────────────────────────────────────────────────────
  private composer: EffectComposer | null = null;

  // ── GPU/context resilience ────────────────────────────────────────────
  /** True while the WebGL context is lost — the loop skips rendering. */
  private contextLost = false;
  /** Warn once per session about unexpected render errors (no log spam). */
  private renderErrorLogged = false;
  private tickerErrorLogged = false;
  /** Small "context lost / restoring" card shown over the canvas. */
  private contextOverlay: HTMLDivElement | null = null;

  /** Follow-target mode: pan the camera toward a moving point each frame. */
  private followGetter: (() => THREE.Vector3 | null) | null = null;
  onFollowCancelled: (() => void) | null = null;

  get timeOfDay(): TimeOfDay {
    return this.moodName === 'night' ? 'night' : 'day';
  }
  get moodNameNow(): MoodName {
    return this.moodName;
  }

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.high.dprCap));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.domElement.style.display = 'block';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SCENE_BACKGROUND);
    this.scene.fog = new THREE.Fog(0x232a4a, 2200, 6800);

    // IBL: a small procedural room environment gives PBR surfaces soft
    // ambience without downloading any HDR file.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environmentIntensity = 0.35;

    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(50, aspect, 1, 24000);
    this.camera.position.set(0, 400, 1500);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.minDistance = 70;
    this.controls.maxDistance = 2400;
    this.controls.target.set(0, 0, 0);
    this.controls.addEventListener('start', () => {
      this.tween = null;
      if (this.flight !== null) this.flight = null; // user takes over
      if (this.followGetter !== null) {
        this.followGetter = null; // follow ends on user input
        this.onFollowCancelled?.();
      }
    });

    // Lights: hemisphere ambient + warm shadow-casting key + cool fill.
    this.hemi = new THREE.HemisphereLight(0x8ea0d0, 0x2a2030, 0.95);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffcf9e, 1.55);
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
    this.fill = new THREE.DirectionalLight(0x4a6a9e, 0.55);
    this.fill.position.set(-520, 700, 640);
    this.scene.add(this.fill);
    // Soft cool rim from behind/above — lifts building silhouettes off the
    // sky at night so their shapes read (no shadows, mood-driven intensity).
    this.rim = new THREE.DirectionalLight(0x7fa8d8, 0.9);
    this.rim.position.set(180, 520, -820);
    this.scene.add(this.rim);

    // Sky dome + stars. The gradient is computed per fragment from the view
    // direction (smooth at any dome resolution); a soft warm glow is added
    // around SUN_DIR so "day" reads as a real sky, not a flat backdrop.
    const skyGeo = new THREE.SphereGeometry(SKY_RADIUS, 48, 32);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x6fa3d8) },
        uMid: { value: new THREE.Color(0x9fc0e4) },
        uHorizon: { value: new THREE.Color(0xf0d2ae) },
        uSunDir: { value: SUN_DIR.clone() },
        uGlow: { value: new THREE.Color(0xffd9a8) },
        uGlowAmount: { value: 0.55 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        void main() {
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uMid;
        uniform vec3 uHorizon;
        uniform vec3 uSunDir;
        uniform vec3 uGlow;
        uniform float uGlowAmount;
        varying vec3 vWorldPos;
        void main() {
          vec3 dir = normalize(vWorldPos);
          float h = dir.y;                               // -1..1, mostly 0..1
          float horizon = smoothstep(-0.06, 0.24, h);    // 0 at ground line → 1 at ~14°
          float top = smoothstep(0.22, 0.8, h);
          vec3 c = mix(uHorizon, uMid, horizon);
          c = mix(c, uTop, top);
          // Warm sun glow: broad band low on the horizon + tight core.
          float sd = max(dot(dir, uSunDir), 0.0);
          float glow = pow(sd, 6.0) * (1.0 - top) + pow(sd, 24.0) * 0.55;
          c += uGlow * glow * uGlowAmount * smoothstep(-0.02, 0.05, h);
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    this.skyUniforms = skyMat.uniforms as typeof this.skyUniforms;
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.name = 'sky';
    this.scene.add(sky);

    // Star field (opacity driven by the mood).
    const starPos = new Float32Array(STAR_COUNT * 3);
    let s = 0;
    for (let i = 0; i < STAR_COUNT; i += 1) {
      // Uniform-ish on the upper hemisphere.
      const az = Math.random() * Math.PI * 2;
      const el = Math.random() * Math.PI * 0.46 + 0.04;
      const r = SKY_RADIUS * 0.92;
      starPos[s++] = Math.cos(az) * Math.cos(el) * r;
      starPos[s++] = Math.sin(el) * r;
      starPos[s++] = Math.sin(az) * Math.cos(el) * r;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    // Star tint kept just under the bloom threshold so stars stay crisp
    // points (subtle) rather than blooming into soft blobs.
    this.starMaterial = new THREE.PointsMaterial({
      color: 0xb8c4e8,
      size: 2.1,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });
    const stars = new THREE.Points(starGeo, this.starMaterial);
    stars.name = 'stars';
    this.scene.add(stars);

    // Mood state starts at the guest default (twilight).
    this.mood = moodStateFrom(MOODS.twilight);
    this.applyMoodToScene(this.mood);

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);

    // Robustness: a fullscreen toggle (or a pixel-ratio change from the
    // quality button) can make the driver drop the WebGL context. Without
    // handlers the canvas would sit black forever; with them we pause the
    // loop, tell the user, and resume cleanly on restore.
    const canvas = this.renderer.domElement;
    this.onContextLostEvent = (e: Event) => {
      e.preventDefault(); // marks the context "restore-eligible"
      this.setContextLost(true);
    };
    this.onContextRestoredEvent = () => {
      this.setContextLost(false);
      this.onResize(); // fullscreen may have changed the container size
    };
    this.onFullscreenChangeEvent = () => this.onResize();
    canvas.addEventListener('webglcontextlost', this.onContextLostEvent, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestoredEvent);
    document.addEventListener('fullscreenchange', this.onFullscreenChangeEvent);

    this.loop();
  }

  private onContextLostEvent: ((e: Event) => void) | null = null;
  private onContextRestoredEvent: (() => void) | null = null;
  private onFullscreenChangeEvent: (() => void) | null = null;

  private setContextLost(lost: boolean): void {
    if (this.contextLost === lost) return;
    this.contextLost = lost;
    if (lost) {
      if (this.contextOverlay === null) {
        const el = document.createElement('div');
        el.className = 'scene-context-overlay';
        el.setAttribute('role', 'status');
        el.textContent = 'Graphics context lost — restoring…';
        this.container.appendChild(el);
        this.contextOverlay = el;
      }
      this.contextOverlay.hidden = false;
    } else if (this.contextOverlay !== null) {
      this.contextOverlay.hidden = true;
    }
  }

  // ── world hooks ─────────────────────────────────────────────────────────

  /** Register the world's tintable material slots (called once by main). */
  attachMoodHooks(hooks: MoodHooks): void {
    this.hooksRef = hooks;
    this.applyMoodToScene(this.mood);
  }

  // ── API ─────────────────────────────────────────────────────────────────

  onTick(fn: (dt: number, t: number) => void): () => void {
    this.tickers.add(fn);
    return () => this.tickers.delete(fn);
  }

  frameAll(box: THREE.Box3, animate = false): void {
    const center = box.getCenter(new THREE.Vector3());
    const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);

    const fwd = INITIAL_DIRECTION.clone().negate();
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
          const z = Math.max(1, corner.dot(fwd));
          const x = Math.abs(corner.dot(right));
          const y = Math.abs(corner.dot(up));
          distance = Math.max(distance, x / tanH - z, y / tanV - z);
        }
      }
    }
    distance *= 1.03;

    const toPos = center.clone().addScaledVector(INITIAL_DIRECTION, distance);
    const toTgt = center.clone();
    if (animate) {
      this.startTween(toPos, toTgt, TWEEN_SECONDS);
    } else {
      this.camera.position.copy(toPos);
      this.controls.target.copy(toTgt);
      this.camera.near = Math.max(1, distance / 100);
      this.camera.far = Math.max(20000, distance * 8);
      this.camera.updateProjectionMatrix();
      this.controls.update();
    }
  }

  focusOn(worldPos: THREE.Vector3, distance = FOCUS_DISTANCE): void {
    const dir = this.camera.position.clone().sub(this.controls.target);
    dir.y = Math.abs(dir.y);
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 1);
    dir.normalize();
    const toPos = worldPos.clone().addScaledVector(dir, distance);
    toPos.y = Math.max(toPos.y, worldPos.y + distance * 0.25);
    this.startTween(toPos, worldPos.clone(), TWEEN_SECONDS);
  }

  private startTween(toPos: THREE.Vector3, toTarget: THREE.Vector3, duration: number): void {
    this.tween = {
      fromPos: this.camera.position.clone(),
      toPos,
      fromTarget: this.controls.target.clone(),
      toTarget,
      elapsed: 0,
      duration,
    };
  }

  /**
   * Cinematic first-load fly-in: start far above the park and settle into
   * the framed view. Skipped by the caller under prefers-reduced-motion.
   */
  introFly(box: THREE.Box3, seconds = 2.8): void {
    this.frameAll(box, false); // compute + snap to the framed view…
    const framedPos = this.camera.position.clone();
    const center = this.controls.target.clone();
    const dir = framedPos.clone().sub(center);
    const farPos = center.clone().addScaledVector(dir, 2.35).add(new THREE.Vector3(0, dir.length() * 0.42, 0));
    this.camera.position.copy(farPos);
    this.startTween(framedPos, center, seconds);
  }

  /**
   * Follow mode: each frame the camera (and its target) pans toward the
   * point `getter` returns, preserving the current viewing angle. Any user
   * input cancels follow (fired via onFollowCancelled).
   */
  setFollowTarget(getter: (() => THREE.Vector3 | null) | null): void {
    this.followGetter = getter;
  }

  // ── atmosphere API ──────────────────────────────────────────────────────

  /**
   * Switch mood (twilight / night / blueprint). `animate` tweens every
   * colour + light + fog parameter over ~0.85 s — this is the "magical"
   * Guest ↔ Engineer transition.
   */
  setMood(name: MoodName, animate = true): void {
    this.moodName = name;
    if (!animate) {
      const fresh = moodStateFrom(MOODS[name]);
      // Snap: overwrite every live value (no allocation churn on this path).
      this.mood.skyTop.copy(fresh.skyTop);
      this.mood.skyMid.copy(fresh.skyMid);
      this.mood.skyHorizon.copy(fresh.skyHorizon);
      this.mood.fogColor.copy(fresh.fogColor);
      this.mood.fogNear = fresh.fogNear;
      this.mood.fogFar = fresh.fogFar;
      this.mood.hemiSky.copy(fresh.hemiSky);
      this.mood.hemiGround.copy(fresh.hemiGround);
      this.mood.hemiIntensity = fresh.hemiIntensity;
      this.mood.keyColor.copy(fresh.keyColor);
      this.mood.keyIntensity = fresh.keyIntensity;
      this.mood.fillColor.copy(fresh.fillColor);
      this.mood.fillIntensity = fresh.fillIntensity;
      this.mood.rimColor.copy(fresh.rimColor);
      this.mood.rimIntensity = fresh.rimIntensity;
      this.mood.waterDeep.copy(fresh.waterDeep);
      this.mood.waterShallow.copy(fresh.waterShallow);
      this.mood.waterSparkle = fresh.waterSparkle;
      this.mood.groundColor.copy(fresh.groundColor);
      this.mood.stars = fresh.stars;
      this.mood.lampGlow = fresh.lampGlow;
      this.mood.nodeGlow = fresh.nodeGlow;
      this.mood.exposure = fresh.exposure;
      this.mood.sunGlow = fresh.sunGlow;
      this.applyMoodToScene(this.mood);
      return;
    }
    this.moodDest = moodStateFrom(MOODS[name]);
    this.moodProgress = 0;
  }

  /** Guest day/night convenience (day → twilight). Ignored in blueprint. */
  setTimeOfDay(mode: TimeOfDay): void {
    if (this.moodName === 'blueprint') return;
    this.setMood(mode === 'night' ? 'night' : 'twilight');
  }

  /** Apply the current mood state to scene objects + world hooks. */
  private applyMoodToScene(m: MoodState): void {
    (this.scene.fog as THREE.Fog).color.copy(m.fogColor);
    (this.scene.fog as THREE.Fog).near = m.fogNear;
    (this.scene.fog as THREE.Fog).far = m.fogFar;
    (this.scene.background as THREE.Color).copy(m.skyTop);
    this.hemi.color.copy(m.hemiSky);
    this.hemi.groundColor.copy(m.hemiGround);
    this.hemi.intensity = m.hemiIntensity;
    this.sun.color.copy(m.keyColor);
    this.sun.intensity = m.keyIntensity;
    this.fill.color.copy(m.fillColor);
    this.fill.intensity = m.fillIntensity;
    this.rim.color.copy(m.rimColor);
    this.rim.intensity = m.rimIntensity;
    this.renderer.toneMappingExposure = m.exposure;
    this.starMaterial.opacity = m.stars;
    this.skyUniforms.uTop.value.copy(m.skyTop);
    this.skyUniforms.uMid.value.copy(m.skyMid);
    this.skyUniforms.uHorizon.value.copy(m.skyHorizon);
    this.skyUniforms.uGlowAmount.value = m.sunGlow;

    const hooks = this.hooksRef;
    if (hooks !== null) {
      hooks.groundMat.color.copy(m.groundColor);
      hooks.water.uDeep.value.copy(m.waterDeep);
      hooks.water.uShallow.value.copy(m.waterShallow);
      hooks.water.uSparkle.value = m.waterSparkle;
      hooks.water.uFogColor.value.copy(m.fogColor);
      hooks.water.uFogNear.value = m.fogNear;
      hooks.water.uFogFar.value = m.fogFar;
      // The water picks up the mid-sky tint at grazing angles, and the
      // sparkle points a brighter cousin of the shallow tone.
      hooks.water.uSky.value.copy(m.skyMid);
      hooks.water.uSparkleColor.value.copy(m.waterShallow).lerp(SPARKLE_WHITE, 0.6);
      hooks.skirtMat.color.copy(m.groundColor);
      hooks.skirtFadeMat.color.copy(m.fogColor);
      hooks.lampHeadMat.emissiveIntensity = m.lampGlow * 2.4;
      if (hooks.eiffelGlowMat !== undefined) {
        hooks.eiffelGlowMat.emissiveIntensity = 0.3 + m.lampGlow * 1.2;
      }
      if (hooks.spaceshipSheenMat !== undefined) {
        hooks.spaceshipSheenMat.emissiveIntensity = 0.12 + m.lampGlow * 0.5;
      }
      for (const mat of hooks.nodeMats) {
        mat.emissive.setRGB(0.16 * m.nodeGlow, 0.62 * m.nodeGlow, 0.72 * m.nodeGlow);
        mat.emissiveIntensity = 0.5 + m.nodeGlow * 0.9;
      }
      // Holographic walkway lift (blueprint) + a whisper of lamp-warmth at night.
      const wp = m.lampGlow * 0.16; // faint night glow
      for (const mat of hooks.walkwayMats) {
        mat.emissive.setRGB(
          0.02 * m.nodeGlow + wp * 0.6,
          0.1 * m.nodeGlow + wp * 0.35,
          0.15 * m.nodeGlow + wp * 0.18,
        );
        mat.emissiveIntensity = m.nodeGlow * 0.8 + wp;
      }
    }
  }

  /**
   * Quality tiers (see viz/tokens.ts):
   *   high     — full composer: SSAO + bloom + vignette, DPR ≤ 2
   *   balanced — bloom + vignette, DPR ≤ 1.5
   *   low      — direct render (no composer), DPR 1, no shadows
   */
  setQuality(level: RenderQuality): void {
    const tier = QUALITY[level];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.dprCap));
    this.renderer.shadowMap.enabled = tier.shadowMap > 0;
    this.sun.castShadow = tier.shadowMap > 0;
    if (tier.shadowMap > 0) this.sun.shadow.mapSize.set(tier.shadowMap, tier.shadowMap);
    this.rebuildComposer(tier);
  }

  private rebuildComposer(tier: { composer: boolean; bloom: boolean; ssao: boolean; vignette: boolean }): void {
    if (this.composer !== null) {
      // Dispose passes first (they own their own targets), then the
      // composer's shared render targets — no leak on quality toggles.
      for (const pass of this.composer.passes) {
        (pass as { dispose?: () => void }).dispose?.();
      }
      this.composer.dispose();
      this.composer = null;
    }
    if (!tier.composer) return;

    const w = this.container.clientWidth;
    const h = Math.max(1, this.container.clientHeight);
    // Compositor renders to a render target, so re-enable MSAA there
    // (4× on high, 2× on balanced) to keep edges smooth.
    const target = new THREE.WebGLRenderTarget(w, h, { samples: tier.ssao ? 4 : 2 });
    const composer = new EffectComposer(this.renderer, target);
    composer.setSize(w, h);
    composer.setPixelRatio(this.renderer.getPixelRatio());

    if (tier.ssao) {
      const ssao = new SSAOPass(this.scene, this.camera, w, h);
      ssao.kernelRadius = 18;
      ssao.minDistance = 0.0008;
      ssao.maxDistance = 0.08;
      composer.addPass(ssao);
    } else {
      composer.addPass(new RenderPass(this.scene, this.camera));
    }
    if (tier.bloom) {
      // Tight, thresholded bloom: only genuinely bright emissives (route
      // core, lamp heads, blueprint nodes) glow — buildings stay clean and
      // the halo stays close to its source instead of bleeding over.
      const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.45, 0.5, 0.85);
      composer.addPass(bloom);
    }
    if (tier.vignette) {
      const vignette = new ShaderPass(VignetteShader);
      const darkness = vignette.uniforms['darkness'];
      const offset = vignette.uniforms['offset'];
      if (darkness !== undefined) darkness.value = 1.15;
      if (offset !== undefined) offset.value = 1.05;
      composer.addPass(vignette);
    }
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  private onResize(): void {
    // Pure + unit-tested: updates camera aspect/projection, renderer size
    // and the composer (all post-processing render targets ride along via
    // composer.setSize), and skips transient 0×0 frames.
    applyViewportResize(this.container.clientWidth, this.container.clientHeight, {
      camera: this.camera,
      renderer: this.renderer,
      composer: this.composer,
    });
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;

    // Mood tween (Guest ↔ Engineer transition): exponential approach toward
    // the destination state — frame-rate independent, zero allocations.
    if (this.moodProgress < 1 && this.moodDest !== null) {
      this.moodProgress = Math.min(1, this.moodProgress + dt / MOOD_TWEEN_SECONDS);
      const k = 1 - Math.pow(0.00005, dt / MOOD_TWEEN_SECONDS);
      lerpMood(this.mood, this.moodDest, k);
      this.applyMoodToScene(this.mood);
      if (this.moodProgress >= 1) {
        // Settle exactly on the target, then release the destination.
        lerpMood(this.mood, this.moodDest, 1);
        this.applyMoodToScene(this.mood);
        this.moodDest = null;
      }
    }

    if (this.tween !== null) {
      this.tween.elapsed += dt;
      const k = easeInOutCubic(Math.min(1, this.tween.elapsed / this.tween.duration));
      this.camera.position.lerpVectors(this.tween.fromPos, this.tween.toPos, k);
      this.controls.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, k);
      if (this.tween.elapsed >= this.tween.duration) this.tween = null;
    } else if (this.flight !== null) {
      this.flight.elapsed += dt;
      const u = Math.min(1, this.flight.elapsed / this.flight.duration);
      const targetDist = u * this.flight.totalDist;
      const keys = this.flight.keys;
      let i = 0;
      while (i + 1 < keys.length - 1 && keys[i + 1]!.dist < targetDist) i += 1;
      const a = keys[i]!;
      const b = keys[i + 1]!;
      const span = b.dist - a.dist;
      const tt = span > 1e-6 ? (targetDist - a.dist) / span : 1;
      this.camera.position.lerpVectors(a.pos, b.pos, tt);
      this.controls.target.lerpVectors(a.tgt, b.tgt, tt);
      if (u >= 1) {
        const done = this.flight.onDone;
        this.flight = null;
        done?.();
      }
    } else if (this.followGetter !== null) {
      const pt = this.followGetter();
      if (pt !== null) {
        const follow = Math.min(1, dt * 3.2);
        const dx = (pt.x - this.controls.target.x) * follow;
        const dy = (pt.y - this.controls.target.y) * follow;
        const dz = (pt.z - this.controls.target.z) * follow;
        this.controls.target.x += dx;
        this.controls.target.y += dy;
        this.controls.target.z += dz;
        this.camera.position.x += dx;
        this.camera.position.y += dy;
        this.camera.position.z += dz;
      }
    }

    this.controls.update();
    // A failing ticker must not take the loop down (the rAF chain is
    // pre-scheduled above, but an uncaught throw would spam the console
    // every frame) — log once, keep running.
    for (const fn of this.tickers) {
      try {
        fn(dt, t);
      } catch (err) {
        if (!this.tickerErrorLogged) {
          this.tickerErrorLogged = true;
          console.warn('[scene] tick error — continuing:', err);
        }
      }
    }

    // Never render into a lost context (it would throw and leave a black
    // canvas); an unexpected GPU error is logged once, then kept quiet.
    if (this.contextLost) return;
    try {
      if (this.composer !== null) {
        this.composer.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    } catch (err) {
      if (!this.renderErrorLogged) {
        this.renderErrorLogged = true;
        console.warn('[scene] render error — continuing:', err);
      }
    }
  };

  /**
   * Cinematic route intro: glide above the path from origin to destination,
   * then settle into a destination-facing 3/4 view. Constant speed, gentle
   * height, no banking. Any user orbit cancels it immediately.
   */
  flyAlong(pathPoints: readonly THREE.Vector3[], opts: FlightOptions = {}): void {
    if (pathPoints.length < 2) return;

    const overall = pathPoints[pathPoints.length - 1]!.clone().sub(pathPoints[0]!);
    overall.y = 0;
    if (overall.lengthSq() < 1e-6) overall.set(0, 0, 1);
    overall.normalize();
    const side = new THREE.Vector3().crossVectors(overall, UP).normalize().multiplyScalar(58);

    const H = 88;
    const keys: FlightKeyframe[] = [];
    let dist = 0;
    const push = (pos: THREE.Vector3, tgt: THREE.Vector3): void => {
      dist += keys.length > 0 ? pos.distanceTo(keys[keys.length - 1]!.pos) : 0;
      keys.push({ pos: pos.clone(), tgt: tgt.clone(), dist });
    };

    for (let i = 0; i < pathPoints.length; i += 1) {
      const p = pathPoints[i]!;
      const pos = p.clone().add(new THREE.Vector3(0, H, 0)).add(side);
      const look = pathPoints[Math.min(i + 1, pathPoints.length - 1)]!.clone();
      look.y = 6;
      push(pos, look);
    }
    const dest = pathPoints[pathPoints.length - 1]!;
    push(dest.clone().addScaledVector(INITIAL_DIRECTION, 330).add(new THREE.Vector3(0, 60, 0)), dest.clone().add(new THREE.Vector3(0, 8, 0)));

    this.flight = {
      keys,
      totalDist: dist,
      elapsed: 0,
      duration: THREE.MathUtils.clamp(opts.duration ?? 5, 3, 9),
      ...(opts.onDone !== undefined ? { onDone: opts.onDone } : {}),
    };
    this.tween = null;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    if (this.onContextLostEvent !== null) {
      this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLostEvent);
    }
    if (this.onContextRestoredEvent !== null) {
      this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestoredEvent);
    }
    if (this.onFullscreenChangeEvent !== null) {
      document.removeEventListener('fullscreenchange', this.onFullscreenChangeEvent);
    }
    this.contextOverlay?.remove();
    this.contextOverlay = null;
    this.controls.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
