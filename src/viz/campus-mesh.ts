/**
 * viz/campus-mesh.ts
 *
 * Builds the 3D environment from a dataset: ground, lagoon, walkways,
 * graph nodes and location labels — plus stylized low-poly buildings for the
 * DOCUMENTED landmarks (pyramid in Mexico, stave church in Norway, Eiffel
 * Tower replica in France, Spaceship Earth, …). Every shape here is original
 * primitive geometry; no map artwork, imagery, logos or textures are used.
 *
 * The builder is driven by the layout module; per-vertex building choices
 * come from a style table keyed by vertex id (EPCOT documentation → our own
 * simple interpretation).
 */

import * as THREE from 'three';
import type { CampusLayout } from './layout';

// ── palette (original, restrained) ─────────────────────────────────────────
const COLORS = {
  groundTop: 0x283b2e,
  groundSide: 0x1d2b22,
  platform: 0x131c17,
  water: 0x2e5c86, // large but subdued
  walkwayRing: 0x93a5bd, // World Showcase ring — strongest walkway class
  walkway: 0x71829a, // regular paths
  walkwayIndoor: 0x5a6a80, // indoor / narrow
  bridge: 0x8b98a8,
  railing: 0xbcc7d4,
  node: 0x9fb0c4,
  wall: 0xe8e2d6,
  wallDark: 0xcfc8ba,
  slate: 0x5b6b7a,
  terracotta: 0x8c5a3c,
  copper: 0xb0684a,
  deepRed: 0xa33d3d,
  sand: 0xcbb27a,
  metal: 0x9aa7b4,
  white: 0xf2f5f8,
  glass: 0x7fae8f,
};

/** Base colors per walkway class (stored on each edge mesh so the route
 *  layer can restore exact colors when dimming/emphasizing). */
function walkwayBaseColor(widthClass: number): number {
  if (widthClass === 1) return COLORS.walkwayRing;
  if (widthClass === -1) return COLORS.walkwayIndoor;
  return COLORS.walkway;
}

function walkwayRadius(widthClass: number): number {
  if (widthClass === 1) return 4.2;
  if (widthClass === -1) return 1.8;
  return 2.2;
}

export interface CampusMeshes {
  group: THREE.Group;
  /** One sphere per vertex (the graph node). */
  nodes: Map<string, THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>>;
  /** One walkway (or bridge deck) mesh per dataset edge id. */
  edges: Map<string, THREE.Mesh>;
  /** Edge mesh lookup by sorted "a|b" vertex-pair key. */
  edgeByPair: Map<string, THREE.Mesh>;
  /** Label sprite per vertex. */
  labels: Map<string, THREE.Sprite>;
  /** Bounds of the "useful" model (buildings, walkways, nodes) — excludes
   *  the plinth and label sprites; drives camera framing. */
  contentBox: THREE.Box3;
  worldPos: (id: string) => THREE.Vector3;
  setLabelsVisible(visible: boolean): void;
  labelsVisible(): boolean;
}

/** Dataset (x, y) → three.js world position (north = -z, y = up). */
export function toWorld(x: number, y: number, z = 0): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y);
}

function std(color: number, opts: { metalness?: number; roughness?: number; flat?: boolean; opacity?: number } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color,
    metalness: opts.metalness ?? 0.05,
    roughness: opts.roughness ?? 0.9,
    flatShading: opts.flat ?? true,
  });
  if (opts.opacity !== undefined) {
    m.transparent = true;
    m.opacity = opts.opacity;
  }
  return m;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** Gabled (triangular-prism) roof via extruded triangle. */
function gableRoof(width: number, depth: number, height: number, mat: THREE.Material): THREE.Mesh {
  const s = new THREE.Shape();
  s.moveTo(-width / 2, 0);
  s.lineTo(width / 2, 0);
  s.lineTo(0, height);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  return m;
}

function dome(radius: number, mat: THREE.Material, y = 0): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  return m;
}

function pyramid(radius: number, height: number, mat: THREE.Material, y = 0): THREE.Mesh {
  const geo = new THREE.ConeGeometry(radius, height, 4, 1);
  geo.rotateY(Math.PI / 4);
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y + height / 2;
  return m;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  return mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
}

function cylinder(rTop: number, rBottom: number, h: number, seg: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  return mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), mat, x, y, z);
}

// ── building table: documented landmark → our own simple geometry ──────────

function genericPavilion(roofColor: number): THREE.Group {
  const g = new THREE.Group();
  g.add(cylinder(15, 16.5, 11, 6, std(COLORS.wall), 0, 5.5, 0));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(18.5, 9, 6, 1), std(roofColor));
  roof.position.y = 15.5;
  g.add(roof);
  return g;
}

function buildingFor(id: string, type: string): THREE.Group | null {
  const g = new THREE.Group();
  switch (id) {
    case 'pav-mexico':
      return genericPavilion(COLORS.sand);
    case 'pav-norway': {
      // white hall + steep slate gable (stave-church silhouette)
      g.add(box(26, 13, 20, std(COLORS.white), 0, 6.5, 0));
      const roof = gableRoof(30, 24, 13, std(COLORS.slate));
      roof.position.y = 13;
      g.add(roof);
      return g;
    }
    case 'pav-china': {
      // pagoda: box + two stacked flared 8-gon roofs, deep red
      g.add(box(22, 10, 22, std(COLORS.wallDark), 0, 5, 0));
      const r1 = new THREE.Mesh(new THREE.ConeGeometry(24, 8, 8, 1), std(COLORS.deepRed));
      r1.position.y = 14;
      g.add(r1);
      const r2 = new THREE.Mesh(new THREE.ConeGeometry(16, 7, 8, 1), std(COLORS.deepRed));
      r2.position.y = 22;
      g.add(r2);
      return g;
    }
    case 'pav-germany': {
      // hall + tall copper pyramid
      g.add(box(26, 12, 20, std(COLORS.wall), 0, 6, 0));
      g.add(pyramid(20, 14, std(COLORS.copper), 12));
      return g;
    }
    case 'pav-italy': {
      // hall + terracotta dome
      g.add(box(26, 12, 20, std(COLORS.wall), 0, 6, 0));
      g.add(dome(15, std(COLORS.terracotta, { flat: false, roughness: 0.7 }), 12));
      return g;
    }
    case 'pav-america': {
      // temple: portico columns + pediment
      const h = genericPavilion(0x8c9bab);
      const ped = new THREE.Mesh(new THREE.ConeGeometry(21, 8, 4, 1), std(0x8c9bab));
      ped.rotation.y = Math.PI / 4;
      ped.position.set(0, 15, 12);
      h.add(ped);
      for (let i = -1.5; i <= 1.5; i += 1) {
        h.add(cylinder(1.4, 1.4, 11, 8, std(COLORS.white), i * 8, 5.5, 15));
      }
      return h;
    }
    case 'pav-japan': {
      // two-tier curved-look roof (wide 12-gon cones), dark timber
      g.add(box(24, 10, 24, std(COLORS.wallDark), 0, 5, 0));
      const r1 = new THREE.Mesh(new THREE.ConeGeometry(26, 7, 12, 1), std(0x7a5a3c));
      r1.position.y = 13.5;
      g.add(r1);
      const r2 = new THREE.Mesh(new THREE.ConeGeometry(17, 6.5, 12, 1), std(0x7a5a3c));
      r2.position.y = 20.5;
      g.add(r2);
      return g;
    }
    case 'pav-morocco': {
      // rampart + corner minaret with small dome
      g.add(box(26, 12, 20, std(COLORS.wallDark), 0, 6, 0));
      g.add(box(28, 2, 22, std(0xb98a5a), 0, 13, 0));
      g.add(cylinder(3.2, 3.6, 24, 8, std(COLORS.copper), 17, 12, 0));
      g.add(dome(3.6, std(0x6d9e6d, { flat: false }), 24));
      return g;
    }
    case 'pav-france': {
      // slate-roofed hall (the Eiffel Tower sits at its own landmark node)
      g.add(box(26, 12, 20, std(COLORS.wall), 0, 6, 0));
      g.add(pyramid(19, 10, std(0x7d8a99), 12));
      return g;
    }
    case 'pav-uk': {
      // hall + corner clock tower
      g.add(box(26, 12, 20, std(COLORS.wallDark), 0, 6, 0));
      g.add(box(28, 1.6, 22, std(0x9a8f7d), 0, 12.8, 0));
      g.add(cylinder(5, 5.4, 18, 8, std(0xb9ab8f), 17, 2, 0));
      g.add(pyramid(6, 7, std(COLORS.slate), 16));
      return g;
    }
    case 'pav-canada': {
      // timber hall + steep red gable
      g.add(box(26, 12, 20, std(COLORS.wall), 0, 6, 0));
      const roof = gableRoof(30, 24, 12, std(COLORS.deepRed));
      roof.position.y = 12;
      g.add(roof);
      return g;
    }

    case 'outpost': {
      g.add(box(15, 9, 15, std(COLORS.wallDark), 0, 4.5, 0));
      g.add(box(17, 1.6, 17, std(COLORS.slate), 0, 9.8, 0));
      return g;
    }
    case 'gate-main':
    case 'gate-gateway': {
      const w = id === 'gate-main' ? 56 : 44;
      g.add(box(9, 24, 9, std(COLORS.metal, { metalness: 0.4, roughness: 0.5 }), -w / 2, 12, 0));
      g.add(box(9, 24, 9, std(COLORS.metal, { metalness: 0.4, roughness: 0.5 }), w / 2, 12, 0));
      g.add(box(w + 9, 7, 11, std(COLORS.metal, { metalness: 0.4, roughness: 0.5 }), 0, 26, 0));
      g.add(cylinder(30, 32, 2, 32, std(0xcfd6df), 0, 1, 0));
      return g;
    }
    case 'area-showcase':
    case 'gate-plaza': {
      g.add(cylinder(28, 28, 2, 36, std(0xcfd6df), 0, 1, 0));
      return g;
    }
    case 'area-celebration':
    case 'area-discovery':
    case 'area-nature': {
      const tints = [0x3a4a3f, 0x403c33, 0x33413a] as const;
      const i = id === 'area-celebration' ? 0 : id === 'area-discovery' ? 1 : 2;
      g.add(cylinder(30, 30, 2, 36, std(tints[i]), 0, 1, 0));
      return g;
    }

    case 'land-spaceship': {
      const geo = new THREE.IcosahedronGeometry(44, 1);
      g.add(mesh(geo, std(COLORS.white, { roughness: 0.7 }), 0, 44, 0));
      g.add(cylinder(50, 52, 3, 32, std(0xcfd6df), 0, 1.5, 0));
      return g;
    }
    case 'attr-journey': {
      g.add(cylinder(22, 24, 5, 28, std(0xcbd5e1), 0, 2.5, 0));
      const water = new THREE.Mesh(new THREE.CircleGeometry(19, 28), std(0x4f9fd8, { roughness: 0.4 }));
      water.rotation.x = -Math.PI / 2;
      water.position.y = 5.2;
      g.add(water);
      return g;
    }
    case 'attr-soarin': {
      g.add(dome(30, std(COLORS.sand, { flat: false }), 0));
      g.add(cylinder(31, 32, 3, 28, std(0xcfc8ba), 0, 1.5, 0));
      return g;
    }
    case 'attr-testtrack': {
      const torus = new THREE.Mesh(new THREE.TorusGeometry(29, 7, 10, 36), std(0xb7c0cc, { metalness: 0.3, roughness: 0.6 }));
      torus.rotation.x = Math.PI / 2;
      torus.position.y = 7;
      g.add(torus);
      g.add(box(14, 10, 14, std(COLORS.wallDark), 0, 5, 0));
      return g;
    }
    case 'attr-rewind': {
      g.add(cylinder(33, 35, 8, 28, std(0x8fa0b0, { metalness: 0.65, roughness: 0.35 }), 0, 4, 0));
      g.add(mesh(new THREE.SphereGeometry(13, 20, 12), std(0xdde5ee, { metalness: 0.5, roughness: 0.4, flat: false }), 0, 19, 0));
      return g;
    }
    case 'attr-missionspace': {
      g.add(dome(24, std(COLORS.white), 0));
      const rocket = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(8.5, 30, 12), std(0xd64545));
      body.position.y = 15;
      rocket.add(body);
      rocket.add(mesh(new THREE.SphereGeometry(8.5, 12, 8, 0, Math.PI * 2, Math.PI / 2), std(COLORS.white), 0, 0, 0));
      rocket.rotation.z = Math.PI / 4;
      rocket.position.set(7, 24, 0);
      g.add(rocket);
      return g;
    }
    case 'area-land': {
      const geo = new THREE.IcosahedronGeometry(47, 1);
      g.add(mesh(geo, std(COLORS.glass, { opacity: 0.85 }), 0, 26, 0));
      return g;
    }
    case 'attr-seas': {
      g.add(dome(17, std(0x6f9fc8), 0));
      g.add(pyramid(9, 14, std(COLORS.wall), 14));
      return g;
    }
    case 'attr-lionking': {
      g.add(cylinder(24, 26, 3, 28, std(0xb08954), 0, 1.5, 0));
      g.add(box(26, 9, 2, std(COLORS.wallDark), 0, 8, -20));
      g.add(cylinder(1.6, 1.6, 12, 8, std(0x8a7350), -12, 6, -20));
      g.add(cylinder(1.6, 1.6, 12, 8, std(0x8a7350), 12, 6, -20));
      return g;
    }
    case 'area-fountain': {
      for (let i = 0; i < 3; i += 1) {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
        const fx = Math.cos(a) * 16;
        const fz = Math.sin(a) * 16;
        g.add(cylinder(8, 9, 4, 20, std(0xcbd5e1), fx, 2, fz));
        const w = new THREE.Mesh(new THREE.CircleGeometry(6.5, 20), std(0x4f9fd8, { roughness: 0.4 }));
        w.rotation.x = -Math.PI / 2;
        w.position.set(fx, 4.1, fz);
        g.add(w);
      }
      return g;
    }

    case 'land-pyramid': {
      g.add(pyramid(34, 40, std(COLORS.sand, { roughness: 0.8 }), 0));
      return g;
    }
    case 'land-stavechurch': {
      g.add(box(20, 12, 26, std(COLORS.white), 0, 6, 0));
      const roof = gableRoof(24, 28, 12, std(COLORS.slate));
      roof.position.y = 12;
      g.add(roof);
      g.add(box(5, 9, 1, std(0x6b4a2f), 0, 4.5, 13.2));
      return g;
    }
    case 'attr-frozen': {
      g.add(dome(12, std(0xbfe3f2, { flat: false, roughness: 0.3 }), 0));
      g.add(cylinder(13, 13, 3, 20, std(COLORS.white), 0, 1.5, 0));
      return g;
    }
    case 'attr-adv': {
      g.add(box(34, 15, 24, std(COLORS.wallDark), 0, 7.5, 0));
      const ped = new THREE.Mesh(new THREE.ConeGeometry(19, 7, 4, 1), std(COLORS.wallDark));
      ped.rotation.y = Math.PI / 4;
      ped.position.y = 18.5;
      g.add(ped);
      for (let i = -1.5; i <= 1.5; i += 1) {
        g.add(cylinder(1.4, 1.4, 12, 8, std(COLORS.white), i * 7.5, 6, 12.6));
      }
      return g;
    }
    case 'attr-granfiesta': {
      g.add(box(13, 8, 13, std(COLORS.sand), 0, 4, 0));
      g.add(pyramid(10, 6, std(COLORS.sand), 8));
      return g;
    }
    case 'attr-ratatouille': {
      g.add(dome(12, std(COLORS.deepRed), 0));
      g.add(cylinder(13, 13, 2.5, 20, std(COLORS.wallDark), 0, 1.2, 0));
      return g;
    }
    case 'land-eiffel': {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 24, 92, 4, 1), std(0x6d7683, { metalness: 0.5, roughness: 0.55 }));
      tower.rotation.y = Math.PI / 4;
      tower.position.y = 46;
      g.add(tower);
      g.add(box(34, 3, 34, std(0x6d7683, { metalness: 0.5 }), 0, 26, 0));
      g.add(box(21, 2.6, 21, std(0x6d7683, { metalness: 0.5 }), 0, 58, 0));
      g.add(cylinder(1.5, 1.5, 12, 8, std(0x6d7683), 0, 96, 0));
      return g;
    }

    default:
      break;
  }
  // Fallback for unknown ids: a small neutral kiosk (keeps the scene complete
  // for future datasets without venue-specific tables).
  if (g.children.length === 0) {
    if (type === 'gate') {
      g.add(box(8, 18, 8, std(COLORS.metal, { metalness: 0.4 }), -14, 9, 0));
      g.add(box(8, 18, 8, std(COLORS.metal, { metalness: 0.4 }), 14, 9, 0));
      g.add(box(36, 5, 8, std(COLORS.metal, { metalness: 0.4 }), 0, 20, 0));
    } else if (type === 'area' || type === 'plaza') {
      g.add(cylinder(20, 20, 2, 28, std(0x3a4a3f), 0, 1, 0));
    } else {
      g.add(box(14, 10, 14, std(COLORS.wallDark), 0, 5, 0));
      g.add(pyramid(11, 6, std(COLORS.slate), 10));
    }
  }
  return g;
}

// ── labels ──────────────────────────────────────────────────────────────────

function makeLabel(text: string, major: boolean): THREE.Sprite {
  // Map-label look: calm sans-serif, light weight, subtle translucent
  // backing with only slightly rounded corners — not a UI button.
  const font = major
    ? '500 38px Inter, ui-sans-serif, system-ui, "Segoe UI", sans-serif'
    : '400 32px Inter, ui-sans-serif, system-ui, "Segoe UI", sans-serif';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  const padX = 16;
  const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
  const h = major ? 54 : 46;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  const r = 9;
  ctx.beginPath();
  ctx.roundRect(1, 1, w - 2, h - 2, r);
  ctx.fillStyle = 'rgba(10, 15, 26, 0.72)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = major ? 'rgba(140, 170, 215, 0.5)' : 'rgba(110, 125, 150, 0.3)';
  ctx.stroke();
  ctx.fillStyle = major ? '#e8eef7' : '#b6c2d6';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  const worldH = major ? 17 : 13;
  const worldW = worldH * (w / h);
  sprite.scale.set(worldW, worldH, 1);
  sprite.userData.baseScale = new THREE.Vector2(worldW, worldH);
  sprite.renderOrder = 20;
  return sprite;
}

// ── main builder ────────────────────────────────────────────────────────────

/** Vertex ids whose graph node floats above a tall building. */
const NODE_HEIGHT: Record<string, number> = {
  'land-eiffel': 124,
  'land-spaceship': 98,
};

export function buildCampusMeshes(layout: CampusLayout): CampusMeshes {
  const group = new THREE.Group();
  group.name = 'campus';
  const { minX, maxX, minY, maxY } = layout.bounds;

  // Ground: promenade circle (when a ring exists) united with a front-yard
  // ellipse that wraps the front-of-park vertices. Non-zero fill rule makes
  // the two overlapping contours render as a union.
  const shape = new THREE.Shape();
  if (layout.ringRadius > 0) {
    shape.absarc(0, 0, layout.ringRadius * 1.16, 0, Math.PI * 2, false);
  }
  const frontXs: number[] = [];
  const frontYs: number[] = [];
  for (const v of layout.vertices) {
    if (layout.ringRadius === 0 || (v.y < 0 && v.type !== 'pavilion')) {
      frontXs.push(v.x);
      frontYs.push(v.y);
    }
  }
  if (frontXs.length >= 4) {
    const fx0 = Math.min(...frontXs);
    const fx1 = Math.max(...frontXs);
    const fy0 = Math.min(...frontYs);
    const fy1 = Math.max(...frontYs);
    const pad = 55;
    const cx = (fx0 + fx1) / 2;
    const cy = (fy0 + fy1) / 2;
    shape.absellipse(cx, cy, (fx1 - fx0) / 2 + pad, (fy1 - fy0) / 2 + pad, 0, Math.PI * 2, false);
  }
  const groundGeo = new THREE.ExtrudeGeometry(shape, { depth: 16, bevelEnabled: false, steps: 1 });
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate(0, -16, 0);
  const ground = new THREE.Mesh(groundGeo, [std(COLORS.groundTop, { flat: false }), std(COLORS.groundSide, { flat: false })]);
  ground.receiveShadow = true;
  group.add(ground);

  // A darker base platform beneath the park (architectural plinth).
  const plinth = new THREE.Shape();
  if (layout.ringRadius > 0) {
    plinth.absarc(0, 0, layout.ringRadius * 1.34, 0, Math.PI * 2, false);
  }
  plinth.absellipse(
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    Math.max(maxX - minX, layout.ringRadius * 2) * 0.72 + 60,
    Math.max(maxY - minY, layout.ringRadius * 2) * 0.62 + 60,
    0,
    Math.PI * 2,
    false,
  );
  const plinthGeo = new THREE.ShapeGeometry(plinth, 64);
  plinthGeo.rotateX(-Math.PI / 2);
  const plinthMesh = new THREE.Mesh(plinthGeo, std(COLORS.platform, { flat: false }));
  plinthMesh.position.y = -16.4;
  plinthMesh.userData.noBounds = true; // excluded from camera framing
  group.add(plinthMesh);

  // Lagoon water.
  if (layout.lagoonRadius > 0) {
    const waterGeo = new THREE.CircleGeometry(layout.lagoonRadius, 64);
    waterGeo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(waterGeo, std(COLORS.water, { roughness: 0.35, metalness: 0.15, flat: false }));
    water.position.y = 0.7;
    water.receiveShadow = true;
    group.add(water);
  }

  // Walkways (one mesh per dataset edge), colour + width by class.
  const edges = new Map<string, THREE.Mesh>();
  const edgeByPair = new Map<string, THREE.Mesh>();
  for (const e of layout.edges) {
    const a = toWorld(e.fromX, e.fromY, 0.9);
    const b = toWorld(e.toX, e.toY, 0.9);
    const dir = b.clone().sub(a);
    const len = dir.length();
    let m: THREE.Mesh;
    if (e.isBridge) {
      const deck = new THREE.Group();
      const w = 24;
      const deckMesh = box(w, 3.5, len + 18, std(COLORS.bridge, { flat: false }));
      deck.add(deckMesh);
      deck.add(box(1.4, 3, len + 18, std(COLORS.railing), -w / 2, 4.2, 0));
      deck.add(box(1.4, 3, len + 18, std(COLORS.railing), w / 2, 4.2, 0));
      deck.position.copy(a);
      deck.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
      deck.position.y = 2.2;
      // The clickable surface is the deck box itself.
      const clickable = deck.children[0] as THREE.Mesh;
      edges.set(e.id, clickable);
      edgeByPair.set(pairKey(e.fromId, e.toId), clickable);
      group.add(deck);
      m = clickable;
    } else {
      const radius = walkwayRadius(e.widthClass);
      const geo = new THREE.CylinderGeometry(radius, radius, len, 10, 1, true);
      m = new THREE.Mesh(geo, std(walkwayBaseColor(e.widthClass), { flat: false }));
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      m.receiveShadow = true;
      edges.set(e.id, m);
      edgeByPair.set(pairKey(e.fromId, e.toId), m);
      group.add(m);
    }
    m.userData.edgeId = e.id;
    m.userData.fromId = e.fromId;
    m.userData.toId = e.toId;
    m.userData.baseColor = e.isBridge ? COLORS.bridge : walkwayBaseColor(e.widthClass);
  }

  // Buildings + graph nodes + labels.
  const nodes = new Map<string, THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>>();
  const labels = new Map<string, THREE.Sprite>();
  for (const v of layout.vertices) {
    const p = toWorld(v.x, v.y, 0);
    const building = buildingFor(v.id, v.type);
    if (building !== null) {
      building.position.copy(p);
      building.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.castShadow = true;
      });
      group.add(building);
    }
    const nodeY = NODE_HEIGHT[v.id] ?? 30;
    const nodeGeo = new THREE.SphereGeometry(v.type === 'gate' ? 7 : v.type === 'pavilion' ? 6.5 : 5, 18, 12);
    const nodeMat = std(COLORS.node, { metalness: 0.25, roughness: 0.5, flat: false });
    const node = new THREE.Mesh(nodeGeo, nodeMat);
    node.position.copy(p).add(new THREE.Vector3(0, nodeY, 0));
    node.userData.vertexId = v.id;
    nodes.set(v.id, node);
    group.add(node);

    const label = makeLabel(v.name, v.major);
    label.position.copy(p).add(new THREE.Vector3(0, nodeY + 14, 0));
    label.userData.noBounds = true; // excluded from camera framing
    labels.set(v.id, label);
    group.add(label);
  }

  // Bounds of the useful model (everything except plinth + labels).
  group.updateMatrixWorld(true);
  const contentBox = new THREE.Box3();
  for (const child of group.children) {
    if (child.userData.noBounds === true) continue;
    contentBox.expandByObject(child);
  }

  const worldPos = (id: string): THREE.Vector3 => {
    const v = layout.vertexById.get(id);
    return v !== undefined ? toWorld(v.x, v.y, v.z) : new THREE.Vector3();
  };

  let labelVisibility = true;
  const setLabelsVisible = (visible: boolean): void => {
    labelVisibility = visible;
    for (const s of labels.values()) s.visible = visible;
  };

  return {
    group,
    nodes,
    edges,
    edgeByPair,
    labels,
    contentBox,
    worldPos,
    setLabelsVisible,
    labelsVisible: () => labelVisibility,
  };
}

/** Sorted undirected pair key — matches the engine's convention. */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}
