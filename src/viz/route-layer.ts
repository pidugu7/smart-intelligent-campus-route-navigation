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

export const ROUTE_COLOR = 0x22d3ee; // primary route — bright cyan
export const ALT_ROUTE_COLOR = 0xfb923c; // alternative route — orange
export const VISITED_COLOR = 0xfbbf24; // settled nodes — amber
export const BLOCKED_COLOR = 0xef4444; // blocked edges — red

const NODE_BASE_COLOR = 0x9fb0c4;
const EDGE_FALLBACK_COLOR = 0x71829a;
const NODE_DIM_COLOR = 0x64748b; // nodes while a route is displayed (unrelated)
const EDGE_DIM_COLOR = 0x48546a; // edges while a route is displayed (unrelated)
const ROUTE_NODE_COLOR = 0x9fe6f5; // nodes ON the active route
const HOVER_COLOR = 0xbcd3ea;
const HOVER_EMISSIVE = 0x1d3a49;

const FLASH_MS = 260;

interface FlashEntry {
  mesh: THREE.Mesh;
  until: number;
}

function baseColorOf(mesh: THREE.Mesh): number {
  const c = mesh.userData.baseColor;
  return typeof c === 'number' ? c : EDGE_FALLBACK_COLOR;
}

function isBlockedEdge(mesh: THREE.Mesh): boolean {
  return (mesh.material as THREE.MeshStandardMaterial).color.getHex() === BLOCKED_COLOR;
}

export class RouteLayer {
  private readonly group = new THREE.Group();
  private readonly meshes: CampusMeshes;
  private readonly pulses: Array<{ path: THREE.Vector3[]; cursor: THREE.Mesh; segLengths: number[]; total: number; offset: number }> = [];
  private readonly flashes: FlashEntry[] = [];
  private readonly blockedMarkers = new Map<string, THREE.Group>();
  private now = 0;

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
    const m = marker(0x4ade80); // green
    m.position.copy(p);
    this.startMarker = m;
    this.group.add(m);
  }

  setTarget(id: string): void {
    this.clearTarget();
    const p = this.meshes.worldPos(id);
    const m = marker(0xf97316); // orange-red
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
    if (this.startMarker !== null) this.group.remove(this.startMarker);
    this.startMarker = null;
  }

  private clearTarget(): void {
    if (this.targetMarker !== null) this.group.remove(this.targetMarker);
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

  /** Show one route as a bright tube; `withPulse` adds the travelling marker. */
  showRoute(path: readonly string[], color: number, withPulse: boolean): THREE.Mesh | null {
    if (path.length < 2) return null;
    const pts: THREE.Vector3[] = path.map((id) => this.meshes.worldPos(id).add(new THREE.Vector3(0, 7, 0)));
    const curve = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 0; i + 1 < pts.length; i += 1) {
      curve.add(new THREE.LineCurve3(pts[i]!, pts[i + 1]!));
    }
    const geo = new THREE.TubeGeometry(curve, Math.max(8, (pts.length - 1) * 4), 3, 10, false);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.6,
      roughness: 0.35,
      flatShading: false,
    });
    const tube = new THREE.Mesh(geo, mat);
    tube.name = 'route';
    this.group.add(tube);

    if (withPulse) {
      const cursor = new THREE.Mesh(new THREE.SphereGeometry(5, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      this.group.add(cursor);
      const segLengths: number[] = [];
      let total = 0;
      for (let i = 0; i + 1 < pts.length; i += 1) {
        const l = pts[i]!.distanceTo(pts[i + 1]!);
        segLengths.push(l);
        total += l;
      }
      this.pulses.push({ path: [...pts], cursor, segLengths, total, offset: 0 });
    }
    return tube;
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
        mat.emissive.set(0x083040); // subtle glow on route edges
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
    if (existing !== undefined) this.group.remove(existing);
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
      if (obj.name === 'route') this.group.remove(obj);
    }
    for (const p of this.pulses) this.group.remove(p.cursor);
    this.pulses.length = 0;
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

  /** Advance pulses and edge flashes; call once per frame with absolute ms. */
  tick(nowMs: number): void {
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
      let d = p.offset;
      let seg = 0;
      while (seg < p.segLengths.length && d > p.segLengths[seg]!) {
        d -= p.segLengths[seg]!;
        seg += 1;
      }
      if (seg >= p.segLengths.length) seg = p.segLengths.length - 1;
      const a = p.path[seg]!;
      const b = p.path[seg + 1] ?? a;
      const t = p.segLengths[seg]! > 0 ? d / p.segLengths[seg]! : 0;
      p.cursor.position.lerpVectors(a, b, t);
    }
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function marker(color: number): THREE.Group {
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
