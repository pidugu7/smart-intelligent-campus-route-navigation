/**
 * viz/route-layer.ts
 *
 * Everything that changes while an algorithm runs and after it finishes:
 *   - start / destination markers (green / orange-red, prominent)
 *   - visited-node and active-edge highlights driven by TraceEvent replay
 *   - the final route (bright cyan tube + moving pulse) and an optional
 *     alternative route (orange)
 *   - route emphasis: unrelated edges/nodes are DIMMED while a route shows,
 *     so the selected path reads instantly — the underlying graph stays
 *     visible (dimmed, never removed)
 *   - hovered walkway highlight + blocked-edge markers (red)
 *
 * This layer only VISUALIZES engine output (RouteResult / TraceEvent).
 * It contains no pathfinding logic of its own.
 */

import * as THREE from 'three';
import type { TraceEvent } from '../engine/engine';
import { pairKey, type CampusMeshes } from './campus-mesh';

export const ROUTE_COLOR = 0xf5b942; // primary route — premium gold (dominant)
export const ALT_ROUTE_COLOR = 0x93a3b8; // alternative route — subdued slate
export const VISITED_COLOR = 0xfbbf24; // settled nodes — amber
export const BLOCKED_COLOR = 0xef4444; // blocked edges — red (used only on real blocks)

export const PRIMARY_ROUTE_RADIUS = 3.4;
export const ALT_ROUTE_RADIUS = 2.4;
const CHEVRON_COUNT = 10;
const CHEVRON_COLOR = 0xffe08a;
const DEST_PULSE_COLOR = 0xf97316;

const NODE_BASE_COLOR = 0x9fb0c4;
const EDGE_FALLBACK_COLOR = 0x71829a;
const NODE_DIM_COLOR = 0x64748b; // nodes while a route is displayed (unrelated)
const EDGE_DIM_COLOR = 0x48546a; // edges while a route is displayed (unrelated)
const ROUTE_NODE_COLOR = 0xf5d48a; // nodes ON the active route (gold-family)
const HOVER_COLOR = 0xbcd3ea;
const HOVER_EMISSIVE = 0x1d3a49;
const ROUTE_EDGE_GLOW = 0x402e08; // warm glow on route edges (matches gold ribbon)

const FLASH_MS = 260;

/** Scratch vector reused by per-frame path walking (no per-frame alloc). */
const PULSE_DIR_TMP = new THREE.Vector3();
/** Scratch for the trail particles (kept separate from PULSE_DIR_TMP). */
const TRAIL_TMP = new THREE.Vector3();

interface FlashEntry {
  mesh: THREE.Mesh;
  until: number;
}

/**
 * Place `out` at arclength `d` (wrapping within the polyline) along the
 * given path, and orient `out`'s "ahead" by returning a point slightly
 * further along (written into `PULSE_DIR_TMP`). Pure math, no allocation
 * beyond the caller-provided target.
 */
function placeAlongPath(
  path: readonly THREE.Vector3[],
  segLengths: readonly number[],
  d: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  let dist = d;
  let seg = 0;
  while (seg < segLengths.length - 1 && dist > segLengths[seg]!) {
    dist -= segLengths[seg]!;
    seg += 1;
  }
  const a = path[seg]!;
  const b = path[seg + 1] ?? a;
  const t = segLengths[seg]! > 0 ? dist / segLengths[seg]! : 0;
  out.lerpVectors(a, b, t);
  // Reuse the scratch for the "ahead" point (small step further along).
  let aheadDist = dist + 2;
  let s2 = seg;
  while (s2 < segLengths.length - 1 && aheadDist > segLengths[s2]!) {
    aheadDist -= segLengths[s2]!;
    s2 += 1;
  }
  const a2 = path[s2]!;
  const b2 = path[s2 + 1] ?? a2;
  const t2 = segLengths[s2]! > 0 ? aheadDist / segLengths[s2]! : 0;
  PULSE_DIR_TMP.lerpVectors(a2, b2, t2);
  return PULSE_DIR_TMP;
}

function baseColorOf(mesh: THREE.Mesh): number {
  const c = mesh.userData.baseColor;
  return typeof c === 'number' ? c : EDGE_FALLBACK_COLOR;
}

function isBlockedEdge(mesh: THREE.Mesh): boolean {
  return (mesh.material as THREE.MeshStandardMaterial).color.getHex() === BLOCKED_COLOR;
}

export interface ShowRouteOptions {
  /** Travelling pulse marker (default: primary route only). */
  pulse?: boolean;
  /** Tube radius in metres (default: primary width; pass ALT for secondaries). */
  radius?: number;
  /** Directional chevrons flowing along the route (primary route only). */
  chevrons?: boolean;
  /**
   * Self-drawing glowing reveal: the ribbon draws itself start→destination
   * with a bright comet head + particle trail, then a "traveler orb" loops
   * the route forever (the orb doubles as the follow-camera target).
   * Primary route only.
   */
  reveal?: boolean;
  /** Animate the draw-on (pass false under prefers-reduced-motion). */
  animate?: boolean;
  /**
   * Emissive strength of the ribbon. The primary route uses a strong value
   * so it sits above the bloom threshold: a bright crisp core + soft halo
   * (secondary routes stay dim so they don't compete).
   */
  glow?: number;
}

const TRAIL_COUNT = 30;
const TRAIL_SPACING = 2.8; // metres between trail particles
const DRAW_SPEED = 240; // m/s of draw-on → 874 m ≈ 3.6 s
const TRAVEL_LAP_SECONDS = 26; // one full loop of the traveler orb

/** Canvas radial glow — shared by the comet head and the traveler orb. */
let glowTextureCache: THREE.CanvasTexture | null = null;
function glowTexture(): THREE.CanvasTexture {
  if (glowTextureCache !== null) return glowTextureCache;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255, 255, 255, 1)');
  g.addColorStop(0.25, 'rgba(255, 244, 214, 0.55)');
  g.addColorStop(0.6, 'rgba(255, 214, 130, 0.16)');
  g.addColorStop(1, 'rgba(255, 200, 100, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTextureCache = new THREE.CanvasTexture(canvas);
  return glowTextureCache;
}

/**
 * Self-drawing route reveal + comet head + particle trail + looping
 * traveler orb. One instance per primary route; disposed with clearRoutes.
 */
interface RevealState {
  mat: THREE.ShaderMaterial;
  path: THREE.Vector3[];
  segLengths: number[];
  total: number;
  /** 0..1 linear draw progress (eased when applied to the shader). */
  drawProgress: number;
  drawDuration: number;
  traveling: boolean;
  loopDist: number;
  trailFade: number; // 0..1 (fades the trail out when the reveal is cleared)
  head: THREE.Vector3;
  headMesh: THREE.Mesh;
  glow: THREE.Sprite;
  trail: THREE.Points;
  trailMat: THREE.ShaderMaterial;
  light: THREE.PointLight;
}

export class RouteLayer {
  private readonly group = new THREE.Group();
  private readonly meshes: CampusMeshes;
  private readonly pulses: Array<{ path: THREE.Vector3[]; cursor: THREE.Mesh; segLengths: number[]; total: number; offset: number }> = [];
  private readonly flashes: FlashEntry[] = [];
  private readonly blockedMarkers = new Map<string, THREE.Group>();
  /** Directional chevrons of the current primary route. */
  private chevrons: { group: THREE.Group; path: THREE.Vector3[]; segLengths: number[]; total: number; offsets: number[] } | null = null;
  /** Self-drawing reveal + traveler orb of the current primary route. */
  private reveal: RevealState | null = null;
  private now = 0;
  private prevNow = 0;

  private startMarker: THREE.Group | null = null;
  private targetMarker: THREE.Group | null = null;
  private readonly visited = new Set<string>();

  /** Paths currently emphasized (dimming everything else). */
  private emphasisPaths: readonly (readonly string[])[] | null = null;
  private hoverMesh: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene, meshes: CampusMeshes) {
    this.meshes = meshes;
    this.group.name = 'route-layer';
    scene.add(this.group);
  }

  // ── markers ──────────────────────────────────────────────────────────────

  setStart(id: string): void {
    this.clearStart();
    const p = this.meshes.worldPos(id);
    const m = marker(0x4ade80, 'origin'); // green, solid centre dot
    m.position.copy(p);
    this.startMarker = m;
    this.group.add(m);
  }

  setTarget(id: string): void {
    this.clearTarget();
    const p = this.meshes.worldPos(id);
    const m = marker(0xf97316, 'destination'); // orange-red + beacon pulse
    m.position.copy(p);
    this.targetMarker = m;
    this.group.add(m);
  }

  /** Colour the target marker (orange-red = reachable, grey = unreachable). */
  setTargetState(ok: boolean): void {
    if (this.targetMarker === null) return;
    const beam = this.targetMarker.getObjectByName('beam');
    if (beam instanceof THREE.Mesh) {
      (beam.material as THREE.MeshBasicMaterial).color.set(ok ? 0xf97316 : 0x9ca3af);
    }
  }

  private clearStart(): void {
    if (this.startMarker !== null) {
      disposeObject(this.startMarker);
      this.group.remove(this.startMarker);
    }
    this.startMarker = null;
  }

  private clearTarget(): void {
    if (this.targetMarker !== null) {
      disposeObject(this.targetMarker);
      this.group.remove(this.targetMarker);
    }
    this.targetMarker = null;
  }

  // ── trace replay visuals ─────────────────────────────────────────────────

  /** Reset all exploration highlights and route emphasis (before a replay). */
  resetHighlights(): void {
    this.visited.clear();
    this.clearEmphasis();
    for (const node of this.meshes.nodes.values()) {
      node.material.color.set(NODE_BASE_COLOR);
      node.material.emissive.set(0x000000);
    }
    this.flashes.length = 0;
  }

  /** Apply one engine TraceEvent to the scene (called by the replay driver). */
  applyTraceEvent(ev: TraceEvent): void {
    switch (ev.type) {
      case 'start':
        break;
      case 'visit': {
        this.visited.add(ev.vertexId);
        const node = this.meshes.nodes.get(ev.vertexId);
        if (node !== undefined) {
          node.material.color.set(VISITED_COLOR);
          node.material.emissive.set(0x664400);
        }
        break;
      }
      case 'relax': {
        const edge = this.meshes.edgeByPair.get(pairKey(ev.fromId, ev.toId));
        if (edge !== undefined && !isBlockedEdge(edge)) {
          (edge.material as THREE.MeshStandardMaterial).emissive.set(ev.improved ? 0x0e5f6e : 0x333a45);
          this.flashes.push({ mesh: edge, until: this.now + FLASH_MS });
        }
        break;
      }
      case 'finalize':
      case 'abort':
        break;
    }
  }

  // ── final routes + emphasis ──────────────────────────────────────────────

  /** Show one route as a tube; options control pulse / width / chevrons. */
  showRoute(path: readonly string[], color: number, opts: ShowRouteOptions = {}): THREE.Mesh | null {
    if (path.length < 2) return null;
    const { pulse = false, radius = PRIMARY_ROUTE_RADIUS, chevrons = false, reveal = false, animate = true, glow = 0.6 } = opts;
    const pts: THREE.Vector3[] = path.map((id) => this.meshes.worldPos(id).add(new THREE.Vector3(0, 7, 0)));
    const curve = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 0; i + 1 < pts.length; i += 1) {
      curve.add(new THREE.LineCurve3(pts[i]!, pts[i + 1]!));
    }
    const geo = new THREE.TubeGeometry(curve, Math.max(8, (pts.length - 1) * 4), radius, 10, false);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: glow,
      roughness: 0.35,
      flatShading: false,
    });
    const tube = new THREE.Mesh(geo, mat);
    tube.name = 'route';
    this.group.add(tube);

    // Shared segment-length table (pulse + chevrons walk the same polyline).
    const segLengths: number[] = [];
    let total = 0;
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const l = pts[i]!.distanceTo(pts[i + 1]!);
      segLengths.push(l);
      total += l;
    }

    if (pulse) {
      const cursor = new THREE.Mesh(new THREE.SphereGeometry(5, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      this.group.add(cursor);
      this.pulses.push({ path: [...pts], cursor, segLengths: [...segLengths], total, offset: 0 });
    }

    if (chevrons) {
      this.clearChevrons();
      const group = new THREE.Group();
      const offsets: number[] = [];
      const geo = new THREE.ConeGeometry(4.4, 9, 3);
      // Point the cone +Z→ its default tip is +Y; we orient per-instance below.
      const mat = new THREE.MeshBasicMaterial({ color: CHEVRON_COLOR, transparent: true, opacity: 0.95 });
      for (let i = 0; i < CHEVRON_COUNT; i += 1) {
        const c = new THREE.Mesh(geo, mat);
        offsets.push((i / CHEVRON_COUNT) * total);
        group.add(c);
      }
      this.group.add(group);
      this.chevrons = { group, path: [...pts], segLengths: [...segLengths], total, offsets };
    }

    if (reveal) {
      this.clearReveal();
      const rev = this.buildReveal(pts, segLengths, total, color, animate);
      this.reveal = rev;
    }
    return tube;
  }

  // ── self-drawing reveal + traveler orb ───────────────────────────────────

  private buildReveal(
    pts: THREE.Vector3[],
    segLengths: number[],
    total: number,
    color: number,
    animate: boolean,
  ): RevealState {
    // Glowing reveal tube: a slightly fatter additive ribbon whose shader
    // reveals arc-length uv.x up to uProgress (the "draw-on").
    const curve = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 0; i + 1 < pts.length; i += 1) {
      curve.add(new THREE.LineCurve3(pts[i]!, pts[i + 1]!));
    }
    const revGeo = new THREE.TubeGeometry(curve, Math.max(8, (pts.length - 1) * 4), PRIMARY_ROUTE_RADIUS + 0.8, 10, false);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uProgress: { value: animate ? 0 : 1 },
        uColor: { value: new THREE.Color(color) },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying float vT;
        void main() {
          vT = uv.x; // arc-length fraction along the tube (0..1)
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uProgress;
        uniform vec3 uColor;
        uniform float uTime;
        varying float vT;
        void main() {
          float front = uProgress;
          // Ribbon body behind the head.
          float body = 1.0 - smoothstep(front - 0.20, front, vT);
          // Bright comet band at the draw head.
          float head = exp(-abs(vT - front) * 42.0);
          // Gentle shimmer sweep once the full route is drawn.
          float shimmer = step(1.0, front) * 0.16 * (0.5 + 0.5 * sin(uTime * 1.5 - vT * 26.0));
          float a = clamp(body * 0.5 + head * 0.85 + shimmer, 0.0, 1.0);
          vec3 col = uColor * (0.75 + head * 1.7 + shimmer * 0.9);
          gl_FragColor = vec4(col, a);
        }
      `,
    });
    const revTube = new THREE.Mesh(revGeo, mat);
    revTube.name = 'route-reveal';
    revTube.renderOrder = 3;
    this.group.add(revTube);

    // Comet head → becomes the looping traveler orb.
    const head = new THREE.Vector3().copy(pts[0]!);
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(4.6, 18, 12), new THREE.MeshBasicMaterial({ color: 0xfff3d0 }));
    headMesh.name = 'route-head';
    this.group.add(headMesh);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(30, 30, 1);
    glow.name = 'route-glow';
    this.group.add(glow);

    // Soft warm point light so the orb lights the walkway beneath it.
    const light = new THREE.PointLight(color, 30, 150, 2);
    light.name = 'route-light';
    this.group.add(light);

    // Particle trail (additive points, per-particle fade attribute).
    const positions = new Float32Array(TRAIL_COUNT * 3);
    const fades = new Float32Array(TRAIL_COUNT);
    for (let i = 0; i < TRAIL_COUNT; i += 1) {
      fades[i] = Math.pow(1 - i / TRAIL_COUNT, 1.6);
    }
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    trailGeo.setAttribute('aFade', new THREE.BufferAttribute(fades, 1));
    const trailMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(0xffe2a8) },
        uOpacity: { value: animate ? 1 : 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aFade;
        varying float vFade;
        void main() {
          vFade = aFade;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 26.0 * (240.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vFade;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.04, d) * vFade * uOpacity;
          if (a < 0.012) discard;
          gl_FragColor = vec4(uColor, a);
        }
      `,
    });
    const trail = new THREE.Points(trailGeo, trailMat);
    trail.name = 'route-trail';
    trail.renderOrder = 4;
    this.group.add(trail);

    const drawDuration = THREE.MathUtils.clamp(total / DRAW_SPEED, 1.0, 3.6);
    return {
      mat,
      path: [...pts],
      segLengths: [...segLengths],
      total,
      drawProgress: animate ? 0 : 1,
      drawDuration,
      traveling: !animate,
      loopDist: 0,
      trailFade: 0,
      head,
      headMesh,
      glow,
      trail,
      trailMat,
      light,
    };
  }

  /** Current orb position (stable vector; caller must not mutate). */
  orbPosition(): THREE.Vector3 | null {
    return this.reveal !== null ? this.reveal.head : null;
  }

  private clearReveal(): void {
    if (this.reveal === null) return;
    const r = this.reveal;
    disposeObject(r.headMesh);
    this.group.remove(r.headMesh);
    r.glow.material.dispose(); // shared glow texture stays cached
    this.group.remove(r.glow);
    this.group.remove(r.light);
    r.trail.geometry.dispose();
    r.trailMat.dispose();
    this.group.remove(r.trail);
    const revTube = this.group.getObjectByName('route-reveal');
    if (revTube !== null && revTube !== undefined) {
      disposeObject(revTube);
      this.group.remove(revTube);
    }
    this.reveal = null;
  }

  private clearChevrons(): void {
    if (this.chevrons !== null) {
      disposeObject(this.chevrons.group);
      this.group.remove(this.chevrons.group);
      this.chevrons = null;
    }
  }

  /**
   * Emphasize the given route paths: dim unrelated edges/nodes slightly so
   * the route reads instantly, while the graph underneath stays visible.
   * Pass every route that should stay bright (primary + alternative).
   */
  applyRouteEmphasis(paths: readonly (readonly string[])[]): void {
    this.emphasisPaths = paths;
    const brightNodes = new Set<string>();
    const brightEdges = new Set<string>();
    for (const path of paths) {
      for (let i = 0; i < path.length; i += 1) {
        brightNodes.add(path[i]!);
        if (i + 1 < path.length) brightEdges.add(pairKey(path[i]!, path[i + 1]!));
      }
    }
    for (const e of this.meshes.edges.values()) {
      if (isBlockedEdge(e)) continue;
      const mat = e.material as THREE.MeshStandardMaterial;
      const pair = pairKey(e.userData.fromId as string, e.userData.toId as string);
      if (brightEdges.has(pair)) {
        mat.color.set(baseColorOf(e));
        mat.emissive.set(ROUTE_EDGE_GLOW); // subtle warm glow on route edges
      } else {
        mat.color.set(EDGE_DIM_COLOR);
        mat.emissive.set(0x000000);
      }
    }
    for (const [id, node] of this.meshes.nodes) {
      if (brightNodes.has(id)) {
        node.material.color.set(ROUTE_NODE_COLOR);
        node.material.emissive.set(0x052028);
      } else {
        node.material.color.set(NODE_DIM_COLOR);
        node.material.emissive.set(0x000000);
      }
    }
  }

  /** Restore base colours (no emphasis). */
  clearEmphasis(): void {
    this.emphasisPaths = null;
    for (const e of this.meshes.edges.values()) {
      if (isBlockedEdge(e)) continue;
      const mat = e.material as THREE.MeshStandardMaterial;
      mat.color.set(baseColorOf(e));
      mat.emissive.set(0x000000);
    }
    for (const node of this.meshes.nodes.values()) {
      node.material.color.set(NODE_BASE_COLOR);
      node.material.emissive.set(0x000000);
    }
  }

  // ── hover (block-path targeting) ─────────────────────────────────────────

  setHoverEdge(mesh: THREE.Mesh | null): void {
    if (this.hoverMesh === mesh) return;
    // Restore previous hover.
    if (this.hoverMesh !== null && !isBlockedEdge(this.hoverMesh)) {
      this.restoreEdgeState(this.hoverMesh);
    }
    this.hoverMesh = mesh;
    if (mesh !== null && !isBlockedEdge(mesh)) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(HOVER_COLOR);
      mat.emissive.set(HOVER_EMISSIVE);
    }
  }

  private restoreEdgeState(mesh: THREE.Mesh): void {
    if (this.emphasisPaths !== null) {
      this.applyRouteEmphasis(this.emphasisPaths);
      return;
    }
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.color.set(baseColorOf(mesh));
    mat.emissive.set(0x000000);
  }

  // ── blocked edges ────────────────────────────────────────────────────────

  setBlocked(edgeId: string, blocked: boolean): void {
    const existing = this.blockedMarkers.get(edgeId);
    if (existing !== undefined) {
      disposeObject(existing);
      this.group.remove(existing);
    }
    if (!blocked) {
      this.blockedMarkers.delete(edgeId);
      const edge = this.meshes.edges.get(edgeId);
      if (edge !== undefined) {
        const mat = edge.material as THREE.MeshStandardMaterial;
        mat.color.set(baseColorOf(edge));
        mat.emissive.set(0x000000);
      }
      return;
    }
    const edge = this.meshes.edges.get(edgeId);
    if (edge === undefined) return;
    const a = this.meshes.worldPos(edge.userData.fromId as string);
    const b = this.meshes.worldPos(edge.userData.toId as string);
    const markerGroup = blockedMarker(a.clone().add(b).multiplyScalar(0.5));
    this.blockedMarkers.set(edgeId, markerGroup);
    this.group.add(markerGroup);
    const mat = edge.material as THREE.MeshStandardMaterial;
    mat.color.set(BLOCKED_COLOR);
    mat.emissive.set(0x551111);
  }

  blockedEdgeIds(): string[] {
    return [...this.blockedMarkers.keys()];
  }

  // ── clearing ─────────────────────────────────────────────────────────────

  clearRoutes(): void {
    for (const obj of [...this.group.children]) {
      if (obj.name === 'route') {
        disposeObject(obj);
        this.group.remove(obj);
      }
    }
    for (const p of this.pulses) {
      disposeObject(p.cursor);
      this.group.remove(p.cursor);
    }
    this.pulses.length = 0;
    this.clearChevrons();
    this.clearReveal();
    this.clearEmphasis();
  }

  clearMarkers(): void {
    this.clearStart();
    this.clearTarget();
  }

  clearAll(): void {
    this.clearRoutes();
    this.clearMarkers();
    for (const id of [...this.blockedMarkers.keys()]) this.setBlocked(id, false);
    this.resetHighlights();
  }

  // ── animation ────────────────────────────────────────────────────────────

  /** Advance pulses, chevrons, destination beacon, edge flashes and the
   *  self-drawing reveal / traveler orb. Call once per frame with ms. */
  tick(nowMs: number): void {
    const dt = this.prevNow === 0 ? 0 : Math.min(0.1, (nowMs - this.prevNow) / 1000);
    this.prevNow = nowMs;
    this.now = nowMs;
    for (let i = this.flashes.length - 1; i >= 0; i -= 1) {
      const f = this.flashes[i]!;
      if (this.now >= f.until) {
        if (!isBlockedEdge(f.mesh) && this.hoverMesh !== f.mesh) {
          this.restoreEdgeState(f.mesh);
        }
        this.flashes.splice(i, 1);
      }
    }
    for (const p of this.pulses) {
      p.offset = (p.offset + (p.total / 4.5)) % p.total; // one lap ≈ 4.5 s
      placeAlongPath(p.path, p.segLengths, p.offset, p.cursor.position);
    }
    if (this.chevrons !== null) {
      const c = this.chevrons;
      const step = (c.total / 4.0) * 0.12; // flow speed: full lap ≈ 33 s
      for (let i = 0; i < c.offsets.length; i += 1) {
        const off = (c.offsets[i]! + step) % c.total;
        c.offsets[i] = off;
        const chev = c.group.children[i] as THREE.Mesh | undefined;
        if (chev === undefined) continue;
        placeAlongPath(c.path, c.segLengths, off, chev.position);
        chev.position.y += 1.5; // float just above the ribbon
        placeAlongPath(c.path, c.segLengths, (off + 2) % c.total, PULSE_DIR_TMP);
        chev.lookAt(PULSE_DIR_TMP); // +Z faces travel direction
        chev.rotateX(Math.PI / 2); // cone tip forward
      }
    }
    // Destination beacon: a slow expanding ring at the target marker.
    if (this.targetMarker !== null) {
      const ring = this.targetMarker.getObjectByName('beaconRing');
      if (ring instanceof THREE.Mesh) {
        const phase = (nowMs % 2200) / 2200; // 2.2 s loop
        const s = 1 + phase * 0.9;
        ring.scale.set(s, s, 1);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - phase);
      }
    }

    // Self-drawing reveal + traveler orb.
    if (this.reveal !== null) {
      this.advanceReveal(this.reveal, dt, nowMs / 1000);
    }
  }

  private advanceReveal(r: RevealState, dt: number, tSec: number): void {
    const uniforms = r.mat.uniforms;
    if (uniforms.uTime !== undefined) (uniforms.uTime.value as number) += dt;

    let headDist: number;
    if (r.traveling) {
      r.loopDist = (r.loopDist + (r.total / TRAVEL_LAP_SECONDS) * dt) % r.total;
      headDist = r.loopDist;
      // The shader shows the full ribbon with a travelling shimmer.
      if (uniforms.uProgress !== undefined) (uniforms.uProgress.value as number) = 1;
    } else {
      r.drawProgress = Math.min(1, r.drawProgress + dt / r.drawDuration);
      // Ease the draw for a smooth "magic" reveal.
      const p = r.drawProgress;
      const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      if (uniforms.uProgress !== undefined) (uniforms.uProgress.value as number) = eased;
      headDist = eased * r.total;
      if (r.drawProgress >= 1) r.traveling = true;
    }

    // Orb position (with a gentle bob) + glow + light.
    placeAlongPath(r.path, r.segLengths, headDist, r.head);
    r.head.y += Math.sin(tSec * 2.2) * 0.7;
    r.headMesh.position.copy(r.head);
    r.glow.position.copy(r.head);
    r.light.position.copy(r.head);

    // Particle trail: spaced particles just behind the orb along the path.
    const posAttr = r.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < TRAIL_COUNT; i += 1) {
      const d = Math.max(0, headDist - (i + 1) * TRAIL_SPACING);
      placeAlongPath(r.path, r.segLengths, d, TRAIL_TMP);
      arr[i * 3] = TRAIL_TMP.x;
      arr[i * 3 + 1] = TRAIL_TMP.y;
      arr[i * 3 + 2] = TRAIL_TMP.z;
    }
    posAttr.needsUpdate = true;
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Release GPU resources (geometry / materials / textures) of a scene object
 * and its descendants. Routes, markers and blocked markers are created per
 * interaction, so every removal must dispose — otherwise repeated
 * FIND ROUTE clicks would accumulate unused GPU buffers.
 */
function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        const mat = m as THREE.MeshStandardMaterial;
        if (mat.map !== null && mat.map !== undefined) mat.map.dispose();
        mat.dispose();
      }
    }
  });
}

/**
 * Origin / destination marker. Both share the ring + beam silhouette;
 * the origin gets a solid centre dot ("you are here"), the destination a
 * slowly expanding beacon ring (animated in tick()).
 */
function marker(color: number, variant: 'origin' | 'destination'): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(20, 2, 10, 44),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 1.4;
  g.add(ring);
  const inner = new THREE.Mesh(
    new THREE.TorusGeometry(11, 1.2, 8, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65 }),
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 1.6;
  g.add(inner);
  if (variant === 'origin') {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 10), new THREE.MeshBasicMaterial({ color }));
    dot.position.y = 3;
    g.add(dot);
  } else {
    const beacon = new THREE.Mesh(
      new THREE.TorusGeometry(20, 1.4, 8, 40),
      new THREE.MeshBasicMaterial({ color: DEST_PULSE_COLOR, transparent: true, opacity: 0.5 }),
    );
    beacon.name = 'beaconRing';
    beacon.rotation.x = -Math.PI / 2;
    beacon.position.y = 1.2;
    g.add(beacon);
  }
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.8, 1.8, 52, 8, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45 }),
  );
  beam.name = 'beam';
  beam.position.y = 27;
  g.add(beam);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(6, 12, 4), new THREE.MeshBasicMaterial({ color }));
  cone.position.y = 58;
  cone.rotation.x = Math.PI;
  g.add(cone);
  return g;
}

function blockedMarker(pos: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const barGeo = new THREE.BoxGeometry(28, 3.4, 4.8);
  const mat = new THREE.MeshBasicMaterial({ color: BLOCKED_COLOR });
  const a = new THREE.Mesh(barGeo, mat);
  a.rotation.z = Math.PI / 4;
  const b = new THREE.Mesh(barGeo, mat);
  b.rotation.z = -Math.PI / 4;
  g.add(a, b);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(21, 1.6, 8, 36), new THREE.MeshBasicMaterial({ color: BLOCKED_COLOR, transparent: true, opacity: 0.8 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -1;
  g.add(ring);
  g.position.copy(pos);
  g.position.y = Math.max(7, pos.y + 7);
  return g;
}
