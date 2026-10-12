/**
 * viz/markers.ts
 *
 * Floating marker system (Phase 3): every location gets a round category
 * badge (original canvas-drawn glyph, colour-coded by dataset `type`)
 * floating on a thin stem above the location. The existing name chips stay
 * as the "name" layer; badges are the "icon" layer with their own LOD:
 *
 *   far    → major badges only
 *   medium → + badges for detail-tier locations (attractions / landmarks)
 *   close  → all badges + all names (names still run collision avoidance)
 *
 * Hovering (or tapping) a badge shows a pulse ring here and a destination
 * card in the DOM (see main.ts). Badges are raycast-pickable in both modes
 * — that is how guests pick places without the engineer graph overlay.
 *
 * All glyphs are simple original geometry — no logos, artwork or
 * trademarked imagery.
 */

import * as THREE from 'three';
import type { CampusLayout } from './layout';

export type CategoryId = 'pavilion' | 'attraction' | 'area' | 'gate' | 'plaza' | 'landmark' | 'bridge' | 'other';

export interface CategoryStyle {
  color: string; // badge fill
  label: string; // human-readable category (shown in the destination card)
  glyph: GlyphKind;
}

export type GlyphKind = 'dome' | 'sparkle' | 'rings' | 'arch' | 'diamond' | 'obelisk' | 'bridge' | 'dot';

export const CATEGORIES: Record<CategoryId, CategoryStyle> = {
  pavilion: { color: '#2fbfae', label: 'Pavilion', glyph: 'dome' },
  attraction: { color: '#ff7a68', label: 'Attraction', glyph: 'sparkle' },
  area: { color: '#8b7cf6', label: 'Area', glyph: 'rings' },
  gate: { color: '#4ade80', label: 'Gate', glyph: 'arch' },
  plaza: { color: '#5b9bd5', label: 'Plaza', glyph: 'diamond' },
  landmark: { color: '#e8cf9a', label: 'Landmark', glyph: 'obelisk' },
  bridge: { color: '#93a3b8', label: 'Bridge', glyph: 'bridge' },
  other: { color: '#9aa6bd', label: 'Location', glyph: 'dot' },
};

export function categoryIdOf(type: string): CategoryId {
  return type in CATEGORIES ? (type as CategoryId) : 'other';
}

const BADGE_CANVAS = 128;

// ── glyph drawing (all original geometry) ──────────────────────────────────

function drawGlyph(ctx: CanvasRenderingContext2D, kind: GlyphKind, color: string): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const cx = BADGE_CANVAS / 2;
  const cy = BADGE_CANVAS / 2;
  switch (kind) {
    case 'dome': {
      // Pavilion: dome on a baseline.
      ctx.beginPath();
      ctx.arc(cx, cy + 14, 26, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 32, cy + 18);
      ctx.lineTo(cx + 32, cy + 18);
      ctx.stroke();
      break;
    }
    case 'sparkle': {
      // Attraction: 4-point star.
      ctx.beginPath();
      ctx.moveTo(cx, cy - 30);
      ctx.lineTo(cx + 8, cy - 8);
      ctx.lineTo(cx + 30, cy);
      ctx.lineTo(cx + 8, cy + 8);
      ctx.lineTo(cx, cy + 30);
      ctx.lineTo(cx - 8, cy + 8);
      ctx.lineTo(cx - 30, cy);
      ctx.lineTo(cx - 8, cy - 8);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'rings': {
      // Area: concentric rings.
      ctx.beginPath();
      ctx.arc(cx, cy, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 11, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'arch': {
      // Gate: arch over a baseline.
      ctx.beginPath();
      ctx.arc(cx, cy + 12, 24, Math.PI, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 24, cy + 12);
      ctx.lineTo(cx - 24, cy + 24);
      ctx.moveTo(cx + 24, cy + 12);
      ctx.lineTo(cx + 24, cy + 24);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 32, cy + 26);
      ctx.lineTo(cx + 32, cy + 26);
      ctx.stroke();
      break;
    }
    case 'diamond': {
      // Plaza: rotated square.
      ctx.beginPath();
      ctx.moveTo(cx, cy - 27);
      ctx.lineTo(cx + 27, cy);
      ctx.lineTo(cx, cy + 27);
      ctx.lineTo(cx - 27, cy);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'obelisk': {
      // Landmark: tapered obelisk.
      ctx.beginPath();
      ctx.moveTo(cx - 4, cy - 30);
      ctx.lineTo(cx + 4, cy - 30);
      ctx.lineTo(cx + 11, cy + 22);
      ctx.lineTo(cx - 11, cy + 22);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 17, cy + 26);
      ctx.lineTo(cx + 17, cy + 26);
      ctx.stroke();
      break;
    }
    case 'bridge': {
      // Bridge: arc + deck + piers.
      ctx.beginPath();
      ctx.arc(cx, cy + 10, 24, Math.PI, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 30, cy + 14);
      ctx.lineTo(cx + 30, cy + 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 18, cy + 14);
      ctx.lineTo(cx - 18, cy + 26);
      ctx.moveTo(cx + 18, cy + 14);
      ctx.lineTo(cx + 18, cy + 26);
      ctx.stroke();
      break;
    }
    case 'dot':
    default: {
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}

/** Badge canvas → texture. White glyph on a saturated category disc. */
function makeBadgeTexture(kind: GlyphKind, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = BADGE_CANVAS;
  canvas.height = BADGE_CANVAS;
  const ctx = canvas.getContext('2d')!;
  const cx = BADGE_CANVAS / 2;
  // Soft shadow ring for separation from the scene.
  ctx.beginPath();
  ctx.arc(cx, cx + 2, 56, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fill();
  // Category disc.
  const grad = ctx.createRadialGradient(cx - 14, cx - 16, 8, cx, cx, 54);
  grad.addColorStop(0, 'rgba(255,255,255,0.28)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.beginPath();
  ctx.arc(cx, cx, 54, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, BADGE_CANVAS, BADGE_CANVAS);
  ctx.restore();
  // Rim.
  ctx.beginPath();
  ctx.arc(cx, cx, 54, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 5;
  ctx.stroke();
  // Glyph.
  drawGlyph(ctx, kind, 'rgba(255,255,255,0.96)');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Shared hover-ring texture (soft white ring). */
let hoverRingTexture: THREE.CanvasTexture | null = null;
function hoverRingTex(): THREE.CanvasTexture {
  if (hoverRingTexture !== null) return hoverRingTexture;
  const s = 128;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = 7;
  ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, 46, 0, Math.PI * 2);
  ctx.stroke();
  hoverRingTexture = new THREE.CanvasTexture(canvas);
  return hoverRingTexture;
}

// ── marker world ────────────────────────────────────────────────────────────

export interface MarkerItem {
  id: string;
  badge: THREE.Sprite;
  /** Badge world position (stems + hover ring anchor here). */
  badgePos: THREE.Vector3;
  /** Instance slot of this badge's stem in the shared stem mesh. */
  stemIndex: number;
  name: string;
  category: CategoryId;
  major: boolean;
  /** Detail tier (attraction / landmark) — mid-ZOOM visibility. */
  detail: boolean;
}

export interface Markers {
  group: THREE.Group;
  items: Map<string, MarkerItem>;
  /** Pickable badge sprites (raycast this list). */
  pickables: THREE.Sprite[];
  /** Base world size of a badge before LOD scaling (major/minor). */
  baseSize: { major: number; minor: number };
  /** Advance the hover-ring pulse (and re-anchor it to the live badge). */
  tick(tSec: number): void;
  /** Pulse ring around the hovered/selected vertex (null clears). */
  setHover(id: string | null): void;
  setAllVisible(visible: boolean): void;
  /**
   * Re-anchor every badge to float just above its current label (whose
   * world height changes with the distance-based scale clamps) and stretch
   * the stem to match. Cheap: only items that actually moved are updated.
   */
  syncBadgesToLabels(labels: Map<string, THREE.Sprite>): void;
  dispose(): void;
}

/**
 * Build the marker layer. `labels` is the existing name-chip map from
 * CampusMeshes — badge positions are anchored to those (label height +
 * 10 m) so icons and names always agree about where a location "is".
 */
export function buildMarkers(layout: CampusLayout, labels: Map<string, THREE.Sprite>): Markers {
  const group = new THREE.Group();
  group.name = 'markers';
  const items = new Map<string, MarkerItem>();
  const pickables: THREE.Sprite[] = [];

  // Texture cache per category (few categories → few textures).
  const texCache = new Map<CategoryId, THREE.CanvasTexture>();
  const texFor = (c: CategoryId): THREE.CanvasTexture => {
    let t = texCache.get(c);
    if (t === undefined) {
      const style = CATEGORIES[c];
      t = makeBadgeTexture(style.glyph, style.color);
      texCache.set(c, t);
    }
    return t;
  };

  const baseSize = { major: 16, minor: 11.5 };

  for (const v of layout.vertices) {
    const cat = categoryIdOf(v.type);
    // Anchor to the existing name-chip position (label height), badge 10 m
    // above the chip so the two layers never overlap.
    const label = labels.get(v.id);
    const badgePos = label !== undefined
      ? label.position.clone().add(new THREE.Vector3(0, 10, 0))
      : new THREE.Vector3(v.x, 40, -v.y);
    const mat = new THREE.SpriteMaterial({ map: texFor(cat), transparent: true, depthTest: false });
    const badge = new THREE.Sprite(mat);
    const size = v.major ? baseSize.major : baseSize.minor;
    badge.scale.set(size, size, 1);
    badge.position.copy(badgePos);
    badge.userData.vertexId = v.id;
    badge.userData.noBounds = true;
    badge.renderOrder = 20;
    group.add(badge);
    pickables.push(badge);
    const detail = v.type === 'attraction' || v.type === 'landmark';
    // stemIndex is filled in when the shared stem mesh is built below.
    items.set(v.id, { id: v.id, badge, badgePos, stemIndex: -1, name: v.name, category: cat, major: v.major, detail });
  }

  // Stems: one instanced thin cylinder per badge (deterministic tiny lean).
  const stems = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.35, 0.5, 1, 5),
    new THREE.MeshBasicMaterial({ color: 0xb9c6d8, transparent: true, opacity: 0.5 }),
    items.size,
  );
  const stemDummy = new THREE.Object3D();
  let si = 0;
  for (const item of items.values()) {
    item.stemIndex = si;
    const h = item.badgePos.y - 1;
    stemDummy.position.set(item.badgePos.x, h / 2, item.badgePos.z);
    stemDummy.scale.set(1, h, 1);
    stemDummy.rotation.set(0, 0, 0);
    stemDummy.updateMatrix();
    stems.setMatrixAt(si, stemDummy.matrix);
    si += 1;
  }
  stems.instanceMatrix.needsUpdate = true;
  stems.userData.noBounds = true;
  group.add(stems);

  // Shared hover ring (repositioned, never allocated per hover).
  const ring = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: hoverRingTex(), transparent: true, opacity: 0, depthTest: false }),
  );
  ring.renderOrder = 21;
  ring.userData.noBounds = true;
  group.add(ring);
  let hoverId: string | null = null;
  let ringBase = 1;

  const setHover = (id: string | null): void => {
    hoverId = id;
    if (id !== null) {
      const item = items.get(id);
      if (item !== undefined) {
        ring.position.copy(item.badgePos);
        const s = item.major ? baseSize.major : baseSize.minor;
        ringBase = s * 1.9;
        ring.scale.set(ringBase, ringBase, 1);
      }
    }
  };

  const tick = (tSec: number): void => {
    const mat = ring.material as THREE.SpriteMaterial;
    if (hoverId === null) {
      mat.opacity = 0;
      return;
    }
    const item = items.get(hoverId);
    if (item !== undefined) ring.position.copy(item.badge.position); // live badge
    const phase = (tSec % 1.6) / 1.6;
    const s = ringBase * (1 + phase * 0.35);
    ring.scale.set(s, s, 1);
    mat.opacity = 0.85 * (1 - phase);
  };

  /**
   * Keep every badge a fixed 5 m above its label's current TOP edge (the
   * label's world height varies with distance-based scale clamps), and
   * stretch the stem to reach it. Only items that actually moved touch the
   * instance buffer.
   */
  const syncBadgesToLabels = (labels: Map<string, THREE.Sprite>): void => {
    for (const item of items.values()) {
      const label = labels.get(item.id);
      if (label === undefined) continue;
      const y = label.position.y + label.scale.y / 2 + 5;
      if (Math.abs(y - item.badgePos.y) < 0.25) continue;
      item.badgePos.y = y;
      item.badge.position.y = y;
      const h = y - 1;
      stemDummy.position.set(item.badgePos.x, h / 2, item.badgePos.z);
      stemDummy.scale.set(1, h, 1);
      stemDummy.rotation.set(0, 0, 0);
      stemDummy.updateMatrix();
      stems.setMatrixAt(item.stemIndex, stemDummy.matrix);
      stems.instanceMatrix.needsUpdate = true;
    }
  };

  const setAllVisible = (v: boolean): void => {
    for (const item of items.values()) item.badge.visible = v;
    stems.visible = v;
    if (!v) ring.visible = false;
    else ring.visible = hoverId !== null;
  };

  const dispose = (): void => {
    for (const item of items.values()) {
      (item.badge.material as THREE.SpriteMaterial).map?.dispose();
      item.badge.material.dispose();
    }
    stems.geometry.dispose();
    (stems.material as THREE.Material).dispose();
    (ring.material as THREE.SpriteMaterial).map?.dispose();
    ring.material.dispose();
    group.removeFromParent();
  };

  return { group, items, pickables, baseSize, tick, setHover, setAllVisible, syncBadgesToLabels, dispose };
}
