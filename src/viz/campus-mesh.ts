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
import { SUN_DIR, type MoodHooks } from './scene';
import { MOODS, mulberry32 } from './tokens';

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
  /** Engineer "graph" overlay: one weight sprite per edge. */
  weightLabels: THREE.Group;
  /** Bounds of the "useful" model (buildings, walkways, nodes) — excludes
   *  the terrain skirt/floor and label sprites; drives camera framing. */
  contentBox: THREE.Box3;
  worldPos: (id: string) => THREE.Vector3;
  setLabelsVisible(visible: boolean): void;
  labelsVisible(): boolean;
  /** Graph overlay (nodes + edge weights) on/off — Engineer "Show Graph". */
  setGraphVisible(visible: boolean): void;
  graphVisible(): boolean;
  /** Mood-system tint slots (SceneManager.attachMoodHooks). */
  moodHooks: MoodHooks;
  /** Low quality → flat water + fewer sparkle points (see quality tiers). */
  setWaterDetail(low: boolean): void;
  /** Per-frame animation: water uTime + pennant sway. */
  tick(t: number): void;
}

/** Dataset (x, y) → three.js world position (north = -z, y = up). */
export function toWorld(x: number, y: number, z = 0): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y);
}

const UP = new THREE.Vector3(0, 1, 0);

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

/** A small stylised tree: trunk + one or two stacked cones (low-poly). */
function tree(x = 0, y = 0, z = 0): THREE.Group {
  const t = new THREE.Group();
  t.add(cylinder(0.9, 1.2, 4, 6, std(0x6b4a2f), 0, 2, 0));
  t.add(pyramid(5, 9, std(0x4f7a4a, { flat: true }), 4));
  t.add(pyramid(3.6, 6, std(0x5d8a55, { flat: true }), 10));
  t.position.set(x, y, z);
  return t;
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
    case 'area-celebration': {
      g.add(cylinder(30, 30, 2, 36, std(0x3a4a3f), 0, 1, 0));
      return g;
    }
    case 'area-discovery': {
      // World Discovery — stylized tech cluster: a lean observation tower,
      // two angular ride halls and a low planetarium shell (original massing).
      g.add(cylinder(30, 30, 2, 36, std(0x3d4653), 0, 1, 0));
      // observation tower (slightly tapered shaft + viewing deck)
      g.add(cylinder(2.6, 3.6, 46, 8, std(0xaebccb, { metalness: 0.35, roughness: 0.55 }), -14, 23, -8));
      g.add(cylinder(6.5, 7, 4.5, 8, std(0x8fa0b5, { metalness: 0.3, roughness: 0.6 }), -14, 48, -8));
      // angular ride halls (slab + tilted roof slab)
      g.add(box(26, 11, 18, std(0x93a2b5, { metalness: 0.25, roughness: 0.6 }), 14, 5.5, 10));
      const roofD = box(28, 2, 20, std(0x5b6b7a, { metalness: 0.3, roughness: 0.5 }));
      roofD.position.set(14, 12.5, 10);
      roofD.rotation.z = 0.14;
      g.add(roofD);
      g.add(box(20, 9, 14, std(0x8494a8, { metalness: 0.25, roughness: 0.6 }), 8, 4.5, -16));
      // planetarium shell
      g.add(dome(10, std(0xb9c6d6, { flat: false, metalness: 0.4, roughness: 0.45 }), -2));
      g.add(cylinder(11, 11.5, 2.4, 20, std(0x7c8da2), -2, 1.2, 0));
      for (const [tx, tz] of [[-26, 18], [28, -6], [-6, 26]] as const) {
        g.add(tree(tx, 1, tz));
      }
      return g;
    }
    case 'area-nature': {
      // World Nature — stylized mountain massing (Soarin's "across America"
      // ridgeline) plus woodland: overlapping cones, varied heights, warm
      // rock + green canopy accents. Original geometry only.
      g.add(cylinder(30, 30, 2, 36, std(0x33413a), 0, 1, 0));
      const ridge: Array<[number, number, number, number, number]> = [
        // [x, z, radius, height, color]
        [-16, -10, 15, 30, 0x6d7d64],
        [6, -16, 18, 38, 0x5d6f58],
        [22, -4, 13, 26, 0x77876c],
        [-4, 4, 11, 20, 0x8a9a80],
        [14, 12, 9, 15, 0x93a289],
      ];
      for (const [x, z, r, h, c] of ridge) {
        const peak = pyramid(r, h, std(c, { flat: true }), 1);
        peak.position.x = x;
        peak.position.z = z;
        g.add(peak);
        // snow/dust cap on the two tallest
        if (h >= 30) {
          const cap = pyramid(r * 0.34, h * 0.3, std(0xd8e0da, { flat: true }), 1 + h * 0.7);
          cap.position.x = x;
          cap.position.z = z;
          g.add(cap);
        }
      }
      for (const [tx, tz] of [[-27, 14], [28, 20], [-24, -24], [27, -22], [-2, 26]] as const) {
        g.add(tree(tx, 1, tz));
      }
      return g;
    }

    case 'land-spaceship': {
      // Geodesic sphere: the flat icosahedron faces read as curved panels,
      // and an edge overlay makes the geodesic panel lines explicit.
      const shellMat = std(COLORS.white, { roughness: 0.35, metalness: 0.3 });
      shellMat.emissive = new THREE.Color(0x8fb4d8); // cool sheen, mood-driven
      const geo = new THREE.IcosahedronGeometry(44, 1);
      g.add(mesh(geo, shellMat, 0, 44, 0));
      const panels = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, 1),
        new THREE.LineBasicMaterial({ color: 0xb9c2cc, transparent: true, opacity: 0.7 }),
      );
      panels.position.set(0, 44, 0);
      g.add(panels);
      g.add(cylinder(50, 52, 3, 32, std(0xcfd6df), 0, 1.5, 0));
      g.userData.spaceshipSheenMat = shellMat;
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
      // Low-poly Eiffel replica: four arched legs, two decks, concave
      // 4-sided tapered shafts (a 4-segment lathe = the square silhouette),
      // spire, and a lattice line overlay. The steel material carries a
      // soft warm emissive for the night glow (mood-driven, see moodHooks).
      const steel = std(0x6d7683, { metalness: 0.5, roughness: 0.55, flat: false });
      steel.emissive = new THREE.Color(0xffc873);
      const shaftGeo = (y0: number, y1: number, r0: number, r1: number, rc: number, steps: number): THREE.LatheGeometry => {
        const pts: THREE.Vector2[] = [];
        for (let i = 0; i <= steps; i += 1) {
          const t = i / steps;
          // Quadratic-bezier radius → the signature concave (curved-in) taper.
          const r = (1 - t) * (1 - t) * r0 + 2 * (1 - t) * t * rc + t * t * r1;
          pts.push(new THREE.Vector2(r, y0 + (y1 - y0) * t));
        }
        return new THREE.LatheGeometry(pts, 4);
      };
      const linePos: number[] = [];
      const pushLines = (geo: THREE.BufferGeometry, m4?: THREE.Matrix4): void => {
        const src = m4 !== undefined ? geo.clone().applyMatrix4(m4) : geo;
        const wf = new THREE.WireframeGeometry(src);
        const p = wf.getAttribute('position');
        for (let i = 0; i < p.count; i += 1) linePos.push(p.getX(i), p.getY(i), p.getZ(i));
        wf.dispose();
        if (m4 !== undefined) src.dispose();
      };
      // Four arched legs (square section) from the apron to the lower deck,
      // under the shaft's corners.
      const legGeo = new THREE.CylinderGeometry(1.7, 2.5, 1, 4);
      for (let k = 0; k < 4; k += 1) {
        const a = (k / 4) * Math.PI * 2;
        const base = new THREE.Vector3(Math.cos(a) * 23, 0, Math.sin(a) * 23);
        const top = new THREE.Vector3(Math.cos(a) * 12, 25, Math.sin(a) * 12);
        const dir = top.clone().sub(base);
        const leg = new THREE.Mesh(legGeo, steel);
        leg.position.copy(base).addScaledVector(dir, 0.5);
        leg.scale.set(1, dir.length(), 1);
        leg.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
        leg.castShadow = true;
        g.add(leg);
        leg.updateMatrix();
        pushLines(legGeo, leg.matrix);
      }
      g.add(box(34, 3, 34, steel, 0, 26, 0));
      g.add(box(20, 2.6, 20, steel, 0, 58, 0));
      const s1 = shaftGeo(27.5, 58, 15, 7, 10.0, 8);
      g.add(mesh(s1, steel, 0, 0, 0));
      pushLines(s1);
      const s2 = shaftGeo(59.3, 88, 6.2, 2.0, 3.8, 6);
      g.add(mesh(s2, steel, 0, 0, 0));
      pushLines(s2);
      g.add(mesh(new THREE.CylinderGeometry(0.8, 1.1, 14, 4), steel, 0, 95, 0));
      g.add(mesh(new THREE.SphereGeometry(1.2, 8, 6), steel, 0, 102.5, 0));
      const latticeGeo = new THREE.BufferGeometry();
      latticeGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
      g.add(
        new THREE.LineSegments(
          latticeGeo,
          new THREE.LineBasicMaterial({ color: 0x9aa6b4, transparent: true, opacity: 0.5 }),
        ),
      );
      g.userData.eiffelGlowMat = steel;
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

/** Small edge-weight chip for the Engineer "graph" overlay. */
function makeWeightLabel(text: string): THREE.Sprite {
  const font = '500 26px Inter, ui-sans-serif, system-ui, "Segoe UI", sans-serif';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  const padX = 12;
  const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
  const h = 38;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  const r = 7;
  ctx.beginPath();
  ctx.roundRect(1, 1, w - 2, h - 2, r);
  ctx.fillStyle = 'rgba(8, 12, 22, 0.78)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(245, 185, 66, 0.55)';
  ctx.stroke();
  ctx.fillStyle = '#f5d48a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, opacity: 0.95 });
  const sprite = new THREE.Sprite(material);
  const worldH = 7;
  sprite.scale.set(worldH * (w / h), worldH, 1);
  sprite.renderOrder = 19;
  sprite.userData.noBounds = true;
  return sprite;
}

// ── main builder ────────────────────────────────────────────────────────────

/** Vertex ids whose graph node floats above a tall building. */
const NODE_HEIGHT: Record<string, number> = {
  'land-eiffel': 124,
  'land-spaceship': 98,
};

// ── Phase 1 atmosphere helpers ────────────────────────────────────────────────

/** Radial ground texture: bright park centre fading to darker parkland edge.
 *  Generated once, tinted per-mood by the material colour (multiply). */
function makeGroundTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.5);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.55, '#dfe6da');
  g.addColorStop(1, '#9aa394');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // Subtle deterministic mottle so the ground isn't a perfect radial wipe.
  const rng = mulberry32(7);
  for (let i = 0; i < 900; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 4 + rng() * 22;
    const shade = 190 + Math.floor(rng() * 50);
    ctx.fillStyle = `rgba(${shade}, ${shade + 8}, ${shade - 6}, ${0.03 + rng() * 0.05})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ── value noise (hash-based, no sines → no periodic grid / moiré) ─────────
const WATER_NOISE_GLSL = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    return 0.55 * vnoise(p) + 0.30 * vnoise(p * 2.17 + 7.31) + 0.15 * vnoise(p * 4.43 + 17.7);
  }
`;

/**
 * Lagoon water: a small hand-written shader (no assets).
 *  - deep→shallow radial gradient with a noise-wobbled, organic shoreline
 *  - soft low-frequency ripple normals (value-noise finite differences —
 *    deliberately NOT sines: sine products create visible grid rows/moiré)
 *  - true view-dependent fresnel mixing in the sky tint at grazing angles
 *  - manual distance fog so the shader matches the scene fog
 *  - sparkle is a separate random Points cloud (see makeSparklePoints)
 * Quality: uDetail = 0 on Low (flat surface, no ripple normal work).
 */
function makeWaterMaterial(lagoonRadius: number): {
  mat: THREE.ShaderMaterial;
  uniforms: MoodHooks['water'];
  /** Live uTime uniform for per-frame updates. */
  timeRef: THREE.IUniform<number>;
} {
  const uniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(MOODS.twilight.waterDeep) },
    uShallow: { value: new THREE.Color(MOODS.twilight.waterShallow) },
    uSky: { value: new THREE.Color(MOODS.twilight.skyMid) },
    uSparkle: { value: MOODS.twilight.waterSparkle },
    uSparkleColor: { value: new THREE.Color(MOODS.twilight.waterShallow) },
    uFogColor: { value: new THREE.Color(MOODS.twilight.fogColor) },
    uFogNear: { value: MOODS.twilight.fogNear },
    uFogFar: { value: MOODS.twilight.fogFar },
    uDetail: { value: 1 },
    uDensity: { value: 1 },
    uRadius: { value: lagoonRadius },
    uSunDir: { value: SUN_DIR.clone() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uSky;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform float uDetail;
      uniform vec3 uSunDir;
      varying vec2 vUv;
      varying vec3 vWorld;
      ${WATER_NOISE_GLSL}
      void main() {
        // uv of a CircleGeometry: 0..1 across the disc, centre at 0.5
        vec2 p = (vUv - 0.5) * 2.0;
        float d = length(p);
        float t = uTime;

        // Organic shoreline: low-frequency noise wobbles the blend so the
        // shallow band is irregular (and drifts very slowly), not a ring.
        float wob = fbm(vUv * 3.1 + vec2(t * 0.016, -t * 0.011));
        float r = d + (wob - 0.5) * 0.34;
        float shore = smoothstep(0.45, 0.98, r);
        vec3 col = mix(uShallow, uDeep, 1.0 - shore);

        // Soft low-frequency ripple normal (noise finite differences).
        // Skipped entirely on Low quality (uDetail = 0).
        vec3 n = vec3(0.0, 1.0, 0.0);
        if (uDetail > 0.5) {
          vec2 uv = vUv * 6.5;
          vec2 drift = vec2(t * 0.030, t * 0.021);
          float h  = fbm(uv + drift);
          float hx = fbm(uv + vec2(0.9, 0.0) + drift);
          float hz = fbm(uv + vec2(0.0, 0.9) + drift);
          float amp = 0.35 + 0.45 * shore;
          n = normalize(vec3((h - hx) * amp, 1.0, (h - hz) * amp));
        }

        // View-dependent fresnel: sky tint at grazing angles (the rim),
        // deep tone head-on. Approximation, not a reflection probe.
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - clamp(dot(V, n), 0.0, 1.0), 3.0);
        col = mix(col, uSky, clamp(fres * 0.55, 0.0, 0.55));

        // Faint sun glint — tight spread, no bleeds onto surroundings.
        float spec = pow(max(dot(reflect(-uSunDir, n), V), 0.0), 90.0);
        col += vec3(1.0, 0.96, 0.88) * spec * (0.12 + 0.28 * uDetail);

        // Manual distance fog (shader is not part of the scene fog pass).
        float fd = distance(cameraPosition, vWorld);
        float f = clamp((fd - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
        col = mix(col, uFogColor, f * f * (3.0 - 2.0 * f));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  return {
    mat,
    uniforms: uniforms as MoodHooks['water'],
    timeRef: uniforms.uTime,
  };
}

/**
 * Sparkle: a cloud of RANDOMLY placed points over the lagoon (one draw
 * call, additive). Each point twinkles on its own phase — no lattice, so
 * no rows or moiré at any camera distance. uDensity scales how many are
 * alive (Low quality runs a fraction of them).
 */
function makeSparklePoints(
  lagoonRadius: number,
  shared: MoodHooks['water'],
  timeRef: THREE.IUniform<number>,
): THREE.Points {
  const COUNT = 420;
  const rng = mulberry32(20261012);
  const pos = new Float32Array(COUNT * 3);
  const phase = new Float32Array(COUNT);
  const speed = new Float32Array(COUNT);
  const rand = new Float32Array(COUNT);
  const size = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i += 1) {
    const rr = lagoonRadius * 0.92 * Math.sqrt(rng());
    const th = rng() * Math.PI * 2;
    pos[i * 3] = Math.cos(th) * rr;
    pos[i * 3 + 1] = 0;
    pos[i * 3 + 2] = Math.sin(th) * rr;
    phase[i] = rng() * Math.PI * 2;
    speed[i] = 0.6 + rng() * 1.4;
    rand[i] = rng();
    size[i] = 0.8 + rng() * 1.0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: timeRef,
      uSparkle: shared.uSparkle,
      uSparkleColor: shared.uSparkleColor,
      uDensity: shared.uDensity,
      uRadius: { value: lagoonRadius },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uSparkle;
      uniform float uDensity;
      uniform float uRadius;
      attribute float aPhase;
      attribute float aSpeed;
      attribute float aRand;
      attribute float aSize;
      varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float tw = 0.5 + 0.5 * sin(uTime * aSpeed + aPhase);
        float edge = smoothstep(1.0, 0.7, length(position.xz) / uRadius);
        vAlpha = uSparkle * smoothstep(0.45, 0.95, tw) * edge * step(aRand, uDensity);
        gl_PointSize = clamp(aSize * (520.0 / max(1.0, -mv.z)), 0.0, 7.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSparkleColor;
      varying float vAlpha;
      void main() {
        float m = smoothstep(0.5, 0.05, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(uSparkleColor, vAlpha * m * 0.9);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'water-sparkle';
  points.userData.noBounds = true; // excluded from camera framing
  return points;
}

/**
 * Stone plaza discs beneath major locations. Zone tint (Phase 3):
 * World Showcase (pavilion ring) reads WARM, the front-of-park / lagoon
 * side (Future World) reads COOL — derived from the dataset `type`, no
 * extra data.
 */
function addStonePlazas(group: THREE.Group, layout: CampusLayout): void {
  const geo = new THREE.CircleGeometry(1, 40);
  geo.rotateX(-Math.PI / 2);
  const warmMat = std(0xd8c5a4, { flat: false, roughness: 0.85, metalness: 0.02 }); // Showcase — warm stone
  const coolMat = std(0xbcc9d2, { flat: false, roughness: 0.85, metalness: 0.02 }); // Future World — cool stone
  for (const v of layout.vertices) {
    if (!v.major) continue;
    const p = toWorld(v.x, v.y, 0);
    const m = new THREE.Mesh(geo, v.type === 'pavilion' ? warmMat : coolMat);
    const s = v.type === 'pavilion' ? 34 : v.type === 'gate' ? 30 : 26;
    m.scale.set(s, 1, s);
    m.position.set(p.x, 0.45, p.z);
    m.receiveShadow = true;
    group.add(m);
  }
}

/**
 * Per-pavilion pennant flags (recognisable from above, no trademarks):
 * each is a simple pennant with the nation's colour bands (and, where the
 * real flag is a charge on a field, a simple original disc/cross).
 * Simplified geometric interpretation — documented as such.
 */
const PAVILION_PENNANT_SPECS: Record<string, { bands: string[]; disc?: string; cross?: boolean }> = {
  'pav-mexico': { bands: ['#006847', '#ffffff', '#ce1126'] },
  'pav-norway': { bands: ['#ba0c2f', '#ffffff', '#00205b'] },
  'pav-china': { bands: ['#de2910'], disc: '#ffde00' },
  'pav-germany': { bands: ['#1a1a1a', '#dd0000', '#ffce00'] },
  'pav-italy': { bands: ['#009246', '#ffffff', '#ce2b37'] },
  'pav-america': { bands: ['#b22234', '#ffffff', '#3c3b6e'] },
  'pav-japan': { bands: ['#ffffff'], disc: '#bc002d' },
  'pav-morocco': { bands: ['#c1272d'], disc: '#006233' },
  'pav-france': { bands: ['#0055a4', '#ffffff', '#ef4135'] },
  'pav-uk': { bands: ['#012169'], cross: true },
  'pav-canada': { bands: ['#d80621', '#ffffff', '#d80621'] },
};

function pennantTexture(spec: { bands: string[]; disc?: string; cross?: boolean }): THREE.CanvasTexture {
  const w = 48;
  const h = 32;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const n = spec.bands.length;
  for (let i = 0; i < n; i += 1) {
    ctx.fillStyle = spec.bands[i]!;
    ctx.fillRect((i * w) / n, 0, w / n + 1, h);
  }
  if (spec.cross) {
    // Simplified cross on the field (original, not the flag artwork).
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(w / 2 - 4, 0, 8, h);
    ctx.fillRect(0, h / 2 - 4, w, 8);
    ctx.fillStyle = '#d52b1e';
    ctx.fillRect(w / 2 - 2, 0, 4, h);
    ctx.fillRect(0, h / 2 - 2, w, 4);
  }
  if (spec.disc !== undefined) {
    ctx.fillStyle = spec.disc;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface PennantSwing {
  pennant: THREE.Mesh;
  baseRotY: number;
  phase: number;
}

function addPennants(group: THREE.Group, layout: CampusLayout): PennantSwing[] {
  const poleGeo = new THREE.CylinderGeometry(0.35, 0.5, 15, 6);
  const poleMat = std(0x8a94a4, { flat: false, metalness: 0.4, roughness: 0.5 });
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(15, -2.6);
  shape.lineTo(0, -5.2);
  shape.closePath();
  const pennantGeo = new THREE.ShapeGeometry(shape);
  const swings: PennantSwing[] = [];
  layout.vertices.forEach((v, vi) => {
    if (v.type !== 'pavilion') return;
    const spec = PAVILION_PENNANT_SPECS[v.id];
    if (spec === undefined) return;
    const p = toWorld(v.x, v.y, 0);
    // Pole just outside the building, on the lagoon-facing side.
    const ang = Math.atan2(-v.y, v.x);
    const ox = Math.cos(ang + 0.5) * 30;
    const oz = -Math.sin(ang + 0.5) * 30;
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(p.x + ox, 7.5, p.z + oz);
    pole.castShadow = true;
    const pennant = new THREE.Mesh(
      pennantGeo,
      new THREE.MeshStandardMaterial({ map: pennantTexture(spec), side: THREE.DoubleSide, roughness: 0.8 }),
    );
    const baseRotY = -ang + 0.4;
    pennant.position.set(0, 7.4, 0);
    pennant.rotation.y = baseRotY;
    pole.add(pennant);
    swings.push({ pennant, baseRotY, phase: vi * 1.7 });
    group.add(pole);
  });
  return swings;
}

/**
 * Instanced trees (trunk + canopy) — one draw call each. Placement is
 * deterministic (seeded PRNG): clusters near major locations + a perimeter
 * ring. Never inside the lagoon.
 */
function addInstancedTrees(group: THREE.Group, layout: CampusLayout): void {
  const rng = mulberry32(20261012);
  const spots: THREE.Vector3[] = [];
  const inLagoon = (x: number, z: number): boolean =>
    layout.lagoonRadius > 0 && Math.hypot(x, z) < layout.lagoonRadius + 14;

  for (const v of layout.vertices) {
    if (!v.major && v.type !== 'area') continue;
    const n = v.type === 'pavilion' ? 6 : 4;
    for (let i = 0; i < n; i += 1) {
      const ang = rng() * Math.PI * 2;
      const dist = 42 + rng() * 26;
      const x = v.x + Math.cos(ang) * dist;
      const z = -v.y - Math.sin(ang) * dist; // dataset y → world -z
      if (inLagoon(x, z)) continue;
      if (layout.ringRadius > 0 && Math.hypot(x, z) > layout.ringRadius * 1.42) continue;
      spots.push(toWorld(x, -z, 0));
    }
  }
  // Perimeter ring for a finished parkland edge.
  if (layout.ringRadius > 0) {
    for (let i = 0; i < 34; i += 1) {
      const ang = (i / 34) * Math.PI * 2 + rng() * 0.14;
      const r = layout.ringRadius * (1.24 + rng() * 0.1);
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      if (inLagoon(x, z)) continue;
      spots.push(new THREE.Vector3(x, 0, z));
    }
  }
  if (spots.length === 0) return;

  // Two-tier low-poly tree (trunk + two stacked cones). Geometries are
  // baked base-at-y=0 so a single ground-level instance matrix (position +
  // uniform scale) grows each tree from the ground with its full variation.
  const dummy = new THREE.Object3D();
  const trunkGeo = new THREE.CylinderGeometry(0.55, 0.85, 6, 6);
  trunkGeo.translate(0, 3, 0);
  const trunkMat = std(0x4a3a28, { flat: true });
  const canGeo = new THREE.ConeGeometry(4.2, 12, 7);
  canGeo.translate(0, 4.5 + 6, 0); // canopy base at y=4.5 (top ≈ 16.5)
  const canMat = std(0x2f6b3a, { flat: true });
  const can2Geo = new THREE.ConeGeometry(3.0, 8.5, 7);
  can2Geo.translate(0, 12 + 4.25, 0); // upper tier base at y=12 (top ≈ 20.5)
  const can2Mat = std(0x3d7a47, { flat: true });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const canopies = new THREE.InstancedMesh(canGeo, canMat, spots.length);
  const canopies2 = new THREE.InstancedMesh(can2Geo, can2Mat, spots.length);
  trunks.castShadow = true;
  canopies.castShadow = true;
  canopies2.castShadow = true;
  for (let i = 0; i < spots.length; i += 1) {
    const s = spots[i]!;
    const sc = 0.7 + rng() * 0.8; // varied sizes: ~14 m to ~31 m
    dummy.position.set(s.x, 0, s.z);
    dummy.scale.setScalar(sc);
    dummy.rotation.y = rng() * Math.PI * 2;
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    canopies.setMatrixAt(i, dummy.matrix);
    canopies2.setMatrixAt(i, dummy.matrix);
  }
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  canopies2.instanceMatrix.needsUpdate = true;
  group.add(trunks, canopies, canopies2);
}

/**
 * Instanced lamp posts along the walkways (one draw call for poles, one for
 * heads). Heads are emissive — the mood system drives emissiveIntensity, so
 * at night (and in blueprint mode) they bloom.
 */
function addLampPosts(group: THREE.Group, layout: CampusLayout): {
  headMat: THREE.MeshStandardMaterial;
} {
  const spots: THREE.Vector3[] = [];
  for (const e of layout.edges) {
    const a = toWorld(e.fromX, e.fromY, 0);
    const b = toWorld(e.toX, e.toY, 0);
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 30) continue;
    const steps = Math.min(3, Math.max(1, Math.floor(len / 75)));
    const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
    for (let s = 1; s <= steps; s += 1) {
      const t = s / (steps + 1);
      const mid = a.clone().addScaledVector(dir, t);
      // Ring walkways: lamps on the OUTER edge (away from the lagoon).
      // Inner walkways: alternate perpendicular sides.
      let off: THREE.Vector3;
      if (layout.ringRadius > 0 && mid.length() > layout.ringRadius * 0.8) {
        off = new THREE.Vector3(mid.x, 0, mid.z).normalize().multiplyScalar(walkwayRadius(e.widthClass) + 3);
      } else {
        off = side.clone().multiplyScalar((walkwayRadius(e.widthClass) + 3) * (s % 2 === 0 ? 1 : -1));
      }
      const p = mid.add(off);
      if (layout.lagoonRadius > 0 && Math.hypot(p.x, p.z) < layout.lagoonRadius + 6) continue;
      spots.push(p);
    }
  }
  if (spots.length === 0) return { headMat: std(0x2b3038, { flat: false }) };

  // Upright post: wide base plinth, tapering pole, one warm glowing head.
  // Geometries are baked base-at-y=0 so every instance stands straight on
  // the walkway with identity rotation (no stray tilts).
  const plinthGeo = new THREE.CylinderGeometry(0.85, 1.1, 0.9, 8);
  plinthGeo.translate(0, 0.45, 0);
  const poleGeo = new THREE.CylinderGeometry(0.3, 0.5, 8.6, 6);
  poleGeo.translate(0, 0.6 + 4.3, 0); // spans 0.6 → 9.2
  const headGeo = new THREE.SphereGeometry(1.5, 12, 10);
  headGeo.translate(0, 9.8, 0);
  const poleMat = std(0x2b3038, { flat: false, metalness: 0.5, roughness: 0.45 });
  const headMat = std(0x3a3f4a, { flat: false, metalness: 0.2, roughness: 0.4 });
  headMat.emissive = new THREE.Color(0xffd9a0);
  headMat.emissiveIntensity = MOODS.twilight.lampGlow * 2.4;
  const plinths = new THREE.InstancedMesh(plinthGeo, poleMat, spots.length);
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, spots.length);
  const heads = new THREE.InstancedMesh(headGeo, headMat, spots.length);
  plinths.castShadow = true;
  poles.castShadow = true;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < spots.length; i += 1) {
    const p = spots[i]!;
    dummy.position.set(p.x, 0, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    plinths.setMatrixAt(i, dummy.matrix);
    poles.setMatrixAt(i, dummy.matrix);
    heads.setMatrixAt(i, dummy.matrix);
  }
  plinths.instanceMatrix.needsUpdate = true;
  poles.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  group.add(plinths, poles, heads);
  return { headMat };
}

export function buildCampusMeshes(layout: CampusLayout): CampusMeshes {
  const group = new THREE.Group();
  group.name = 'campus';

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
  let frontEll: { cx: number; cy: number; a: number; b: number } | null = null;
  if (frontXs.length >= 4) {
    const fx0 = Math.min(...frontXs);
    const fx1 = Math.max(...frontXs);
    const fy0 = Math.min(...frontYs);
    const fy1 = Math.max(...frontYs);
    const pad = 55;
    const cx = (fx0 + fx1) / 2;
    const cy = (fy0 + fy1) / 2;
    const a = (fx1 - fx0) / 2 + pad;
    const b = (fy1 - fy0) / 2 + pad;
    frontEll = { cx, cy, a, b };
    shape.absellipse(cx, cy, a, b, 0, Math.PI * 2, false);
  }
  const groundGeo = new THREE.ExtrudeGeometry(shape, { depth: 16, bevelEnabled: false, steps: 1 });
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate(0, -16, 0);
  // Top face carries the radial texture; the mood system tints this material.
  // ExtrudeGeometry cap UVs are raw shape coordinates, so map the park radius
  // to the texture's full 0..1 extent (ClampToEdge, gradient centred at 0).
  const groundTopMat = std(MOODS.twilight.groundColor, { flat: false });
  const groundTex = makeGroundTexture();
  const groundRange = Math.max(1, (layout.ringRadius || 300) * 1.16);
  groundTex.wrapS = THREE.ClampToEdgeWrapping;
  groundTex.wrapT = THREE.ClampToEdgeWrapping;
  groundTex.repeat.set(1 / groundRange, 1 / groundRange);
  groundTex.offset.set(0.5, 0.5);
  groundTopMat.map = groundTex;
  const groundSideMat = std(COLORS.groundSide, { flat: false });
  const ground = new THREE.Mesh(groundGeo, [groundTopMat, groundSideMat]);
  ground.receiveShadow = true;
  group.add(ground);

  // Terrain skirt beneath the island edge: a flared funnel of soil that
  // starts just inside the ground edge (hidden by the cliff face), darkens
  // into a soft contact shadow right under the island, and fades to full
  // tint at the base — no flat black disc, no hard cut-out. The skirt
  // outline follows the SAME union contour (ring ∪ front ellipse) as the
  // ground, so it hugs the island at every angle.
  const skirtMat = new THREE.MeshStandardMaterial({
    color: MOODS.twilight.groundColor,
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const skirtFadeMat = std(MOODS.twilight.fogColor, { flat: false, roughness: 1 });
  {
    const ringR = layout.ringRadius > 0 ? layout.ringRadius * 1.16 : 0;
    // Farthest union-contour extent along a ray from the origin:
    // max(circle, ellipse) via the ray–ellipse quadratic.
    const extent = (cos: number, sin: number): number => {
      let r = ringR;
      if (frontEll !== null) {
        const a2 = frontEll.a * frontEll.a;
        const b2 = frontEll.b * frontEll.b;
        const A = (cos * cos) / a2 + (sin * sin) / b2;
        const B = 2 * ((-frontEll.cx * cos) / a2 + (-frontEll.cy * sin) / b2);
        const C = (frontEll.cx * frontEll.cx) / a2 + (frontEll.cy * frontEll.cy) / b2;
        const disc = B * B - 4 * A * C;
        if (disc > 0) r = Math.max(r, (-B + Math.sqrt(disc)) / (2 * A));
      }
      return r;
    };
    const SEGS = 160;
    const ROWS = 4;
    const rowY = [0, -9, -18, -34];
    const rowK = [0, 0.28, 0.58, 1]; // 0 = at the cliff, 1 = fully flared
    const rowShade = [0.26, 0.52, 0.8, 1.0]; // contact shadow → soil
    const positions = new Float32Array(SEGS * ROWS * 3);
    const colors = new Float32Array(SEGS * ROWS * 3);
    for (let i = 0; i < ROWS; i += 1) {
      for (let s = 0; s < SEGS; s += 1) {
        const th = (s / SEGS) * Math.PI * 2;
        const cos = Math.cos(th);
        const sin = Math.sin(th);
        const e = extent(cos, sin);
        const k = rowK[i]!;
        const rad = e * (0.995 + k * (2.15 - 0.995)) + 55 * k;
        const vi = (i * SEGS + s) * 3;
        positions[vi] = cos * rad; // shape (x,y) → world (x, 0, -y)
        positions[vi + 1] = rowY[i]!;
        positions[vi + 2] = -sin * rad;
        colors[vi] = rowShade[i]!;
        colors[vi + 1] = rowShade[i]!;
        colors[vi + 2] = rowShade[i]!;
      }
    }
    const indices: number[] = [];
    for (let i = 0; i < ROWS - 1; i += 1) {
      for (let s = 0; s < SEGS; s += 1) {
        const s2 = (s + 1) % SEGS;
        const a = i * SEGS + s;
        const b = i * SEGS + s2;
        const c = (i + 1) * SEGS + s;
        const d = (i + 1) * SEGS + s2;
        indices.push(a, c, b, b, c, d);
      }
    }
    const skirtGeo = new THREE.BufferGeometry();
    skirtGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    skirtGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    skirtGeo.setIndex(indices);
    skirtGeo.computeVertexNormals();
    // Guarantee outward-facing shading regardless of winding.
    const n0 = skirtGeo.getAttribute('normal');
    const p0 = skirtGeo.getAttribute('position');
    if (n0 && p0 && n0.count > 0 && p0.count > 0) {
      const nx = n0.getX(0), nz = n0.getZ(0);
      const px = p0.getX(0), pz = p0.getZ(0);
      const rr = Math.hypot(px, pz);
      if (rr > 1e-6 && (nx * px + nz * pz) / rr < 0) {
        const flipped: number[] = [];
        for (let i = 0; i < indices.length; i += 3) {
          flipped.push(indices[i]!, indices[i + 2]!, indices[i + 1]!);
        }
        skirtGeo.setIndex(flipped);
        skirtGeo.computeVertexNormals();
      }
    }
    const skirt = new THREE.Mesh(skirtGeo, skirtMat);
    skirt.userData.noBounds = true; // excluded from camera framing
    group.add(skirt);

    // Horizon floor: one wide disc under everything, tinted with the FOG
    // colour so its far edge dissolves into the sky instead of showing a
    // seam (or the old black cut-out).
    const floorShape = new THREE.Shape();
    const baseK = rowK[ROWS - 1]!;
    for (let s = 0; s < SEGS; s += 1) {
      const th = (s / SEGS) * Math.PI * 2;
      const cos = Math.cos(th);
      const sin = Math.sin(th);
      const e = extent(cos, sin);
      const rad = e * (0.995 + baseK * (2.15 - 0.995)) + 55 * baseK;
      const x = cos * rad;
      const y = sin * rad; // shape-plane y (world -z)
      if (s === 0) floorShape.moveTo(x, y);
      else floorShape.lineTo(x, y);
    }
    floorShape.closePath();
    const floorGeo = new THREE.ShapeGeometry(floorShape, 8);
    floorGeo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(floorGeo, skirtFadeMat);
    floor.position.y = rowY[ROWS - 1]! - 0.5;
    floor.userData.noBounds = true; // excluded from camera framing
    group.add(floor);
  }

  // Lagoon water — animated shader (ripples, fake reflection band, sparkle,
  // manual fog). Colours are mood-driven uniforms.
  let waterUniforms: MoodHooks['water'] | null = null;
  let waterTime: THREE.IUniform<number> | null = null;
  if (layout.lagoonRadius > 0) {
    const waterGeo = new THREE.CircleGeometry(layout.lagoonRadius, 64);
    waterGeo.rotateX(-Math.PI / 2);
    const { mat: waterMat, uniforms, timeRef } = makeWaterMaterial(layout.lagoonRadius);
    waterUniforms = uniforms;
    waterTime = timeRef;
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.y = 0.7;
    group.add(water);
    // Random twinkle points just above the surface (one draw call).
    const sparkle = makeSparklePoints(layout.lagoonRadius, uniforms, timeRef);
    sparkle.position.y = 0.78;
    group.add(sparkle);
  }

  // Walkways (one mesh per dataset edge), colour + width by class.
  const edges = new Map<string, THREE.Mesh>();
  const edgeByPair = new Map<string, THREE.Mesh>();
  const walkwayMats: THREE.MeshStandardMaterial[] = [];
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
    } else if (e.widthClass === 1) {
      // Promenade class → a gently bowed ribbon that follows the lagoon's
      // curve (endpoints stay exactly on the dataset coordinates; only the
      // visual centreline bows outward, ~5% of the chord).
      const radius = walkwayRadius(e.widthClass) + 0.4; // slightly wider ribbon
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const outward = new THREE.Vector3(mid.x, 0, mid.z);
      if (outward.lengthSq() < 1e-4) outward.crossVectors(dir, UP).normalize();
      else outward.normalize();
      const control = mid.clone().addScaledVector(outward, len * 0.05);
      const curve = new THREE.QuadraticBezierCurve3(a.clone(), control, b.clone());
      const geo = new THREE.TubeGeometry(curve, 24, radius, 10, false);
      m = new THREE.Mesh(geo, std(walkwayBaseColor(e.widthClass), { flat: false, opacity: 0.96 }));
      m.receiveShadow = true;
      edges.set(e.id, m);
      edgeByPair.set(pairKey(e.fromId, e.toId), m);
      group.add(m);
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
    if (m.material instanceof THREE.MeshStandardMaterial) walkwayMats.push(m.material);
  }

  // Phase 1: stone plazas, instanced trees, instanced lamp posts.
  // Phase 3: per-pavilion pennants (recognisable from above, no trademarks).
  addStonePlazas(group, layout);
  addInstancedTrees(group, layout);
  const lamps = addLampPosts(group, layout);
  const pennants = addPennants(group, layout);

  // Engineer "graph" overlay: one weight chip per edge (hidden in Guest mode).
  const weightLabels = new THREE.Group();
  weightLabels.name = 'weight-labels';
  for (const e of layout.edges) {
    const w = makeWeightLabel(String(e.weight));
    w.position.set(
      (e.fromX + e.toX) / 2,
      9,
      -(e.fromY + e.toY) / 2,
    );
    weightLabels.add(w);
  }
  weightLabels.visible = false;
  group.add(weightLabels);

  // Buildings + graph nodes + labels.
  const nodes = new Map<string, THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>>();
  const labels = new Map<string, THREE.Sprite>();
  const nodeMats: THREE.MeshStandardMaterial[] = [];
  let eiffelGlowMat: THREE.MeshStandardMaterial | undefined;
  let spaceshipSheenMat: THREE.MeshStandardMaterial | undefined;
  for (const v of layout.vertices) {
    const p = toWorld(v.x, v.y, 0);
    const building = buildingFor(v.id, v.type);
    if (building !== null) {
      building.position.copy(p);
      building.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.castShadow = true;
      });
      // Landmark glow slots (mood-driven emissive, see SceneManager).
      const um = building.userData as {
        eiffelGlowMat?: THREE.MeshStandardMaterial;
        spaceshipSheenMat?: THREE.MeshStandardMaterial;
      };
      if (um.eiffelGlowMat !== undefined) eiffelGlowMat = um.eiffelGlowMat;
      if (um.spaceshipSheenMat !== undefined) spaceshipSheenMat = um.spaceshipSheenMat;
      group.add(building);
    }
    const nodeY = NODE_HEIGHT[v.id] ?? 30;
    const nodeGeo = new THREE.SphereGeometry(v.type === 'gate' ? 7 : v.type === 'pavilion' ? 6.5 : 5, 18, 12);
    const nodeMat = std(COLORS.node, { metalness: 0.25, roughness: 0.5, flat: false });
    nodeMats.push(nodeMat);
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

  let graphVisibility = false;
  const setGraphVisible = (visible: boolean): void => {
    graphVisibility = visible;
    weightLabels.visible = visible;
    for (const n of nodes.values()) n.visible = visible;
  };

  return {
    group,
    nodes,
    edges,
    edgeByPair,
    labels,
    weightLabels,
    contentBox,
    worldPos,
    setLabelsVisible,
    labelsVisible: () => labelVisibility,
    setGraphVisible,
    graphVisible: () => graphVisibility,
    /** Mood system tint slots (see SceneManager.attachMoodHooks). */
    moodHooks: {
      groundMat: groundTopMat,
      water:
        waterUniforms ??
        ({
          uDeep: { value: new THREE.Color() },
          uShallow: { value: new THREE.Color() },
          uSky: { value: new THREE.Color() },
          uSparkle: { value: 0 },
          uSparkleColor: { value: new THREE.Color() },
          uFogColor: { value: new THREE.Color() },
          uFogNear: { value: 1 },
          uFogFar: { value: 1 },
          uDetail: { value: 1 },
          uDensity: { value: 1 },
        } as MoodHooks['water']),
      skirtMat,
      skirtFadeMat,
      lampHeadMat: lamps.headMat,
      // Optional slots: only present when the dataset has that landmark
      // (exactOptionalPropertyTypes → conditional spread, never `undefined`).
      ...(eiffelGlowMat !== undefined ? { eiffelGlowMat } : {}),
      ...(spaceshipSheenMat !== undefined ? { spaceshipSheenMat } : {}),
      nodeMats,
      walkwayMats,
    },
    /** Low quality → flat water + a fraction of the sparkle points. */
    setWaterDetail(low: boolean): void {
      if (waterUniforms !== null) {
        waterUniforms.uDetail.value = low ? 0 : 1;
        waterUniforms.uDensity.value = low ? 0.4 : 1;
      }
    },
    /** Per-frame animation: water + pennant sway. */
    tick: (t: number): void => {
      if (waterTime !== null) waterTime.value = t;
      for (const s of pennants) {
        s.pennant.rotation.y = s.baseRotY + Math.sin(t * 1.3 + s.phase) * 0.1;
      }
    },
  };
}

/** Sorted undirected pair key — matches the engine's convention. */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}
