/**
 * app/main.ts
 *
 * Application entry point. Wires:
 *   dataset (src/data) → loader → WeightedGraph
 *   WeightedGraph → engine routing APIs (the ONLY source of route data)
 *   engine results + TraceEvents → viz layers (scene / campus / route / replay)
 *   DOM controls (app/ui) → engine calls
 *
 * No pathfinding logic lives here or anywhere in the UI.
 */

import * as THREE from 'three';
import epcot from '../data/datasets/epcot/dataset.json';
import { loadDataset } from '../data/loader';
import {
  compareAlgorithms,
  findAlternativeRoute,
  findRoute,
  simulateBlockedRoute,
  type AlgorithmId,
  type BlockSpec,
  type RouteResult,
} from '../engine/engine';
import { SceneManager } from '../viz/scene';
import { buildCampusLayout } from '../viz/layout';
import { buildCampusMeshes, pairKey } from '../viz/campus-mesh';
import { RouteLayer, ROUTE_COLOR, ALT_ROUTE_COLOR } from '../viz/route-layer';
import { TraceReplayer, describeTraceEvent } from '../viz/replay';
import { visibleLabelIds, type LabelPlacement, type LabelTier } from '../viz/label-policy';
import { buildControls } from './ui/controls';
import {
  pathLengthMeters,
  renderAlternative,
  renderBlockReport,
  renderComparison,
  renderProvenanceInfo,
  renderRouteResult,
} from './ui/readout';
import type { SearchItem } from './ui/search';
import './style.css';

const ALGO_LABEL: Record<AlgorithmId, string> = {
  dijkstra: 'Dijkstra',
  astar: 'A*',
  bfs: 'BFS',
};

/** BFS reports hops, not metres — the replay readout must say so. */
const ALGO_UNIT: Record<AlgorithmId, string> = {
  dijkstra: 'm',
  astar: 'm',
  bfs: 'hops',
};

/**
 * Label importance tier (drives zoom-aware visibility, see label-policy.ts):
 *   major  — pavilions, gates, areas, front-of-park landmarks (always on)
 *   medium — hubs, plazas and other connector nodes
 *   detail — pavilion-internal attractions / minor landmarks (close zoom only)
 */
function tierOf(v: { major: boolean; type: string }): LabelTier {
  if (v.major) return 'major';
  if (v.type === 'attraction' || v.type === 'landmark') return 'detail';
  return 'medium';
}

function main(): void {
  const appRoot = document.getElementById('app');
  if (appRoot === null) throw new Error('#app missing');

  // ── data → graph (engine is the source of truth) ─────────────────────────
  const loaded = loadDataset(epcot);
  const graph = loaded.graph;
  const edgeWeight = new Map<string, number>();
  for (const e of loaded.dataset.edges) {
    edgeWeight.set(pairKey(e.from, e.to), e.weight);
  }
  const weightOf = (a: string, b: string): number => edgeWeight.get(pairKey(a, b)) ?? 0;
  const nameOf = (id: string): string => loaded.dataset.vertices.find((v) => v.id === id)?.name ?? id;

  // ── controls (sidebar is appended to #app first, before the viewport) ─────
  const items: SearchItem[] = loaded.dataset.vertices.map((v) => ({
    id: v.id,
    label: v.name,
    hint: v.type,
  }));

  const state: { from: string | null; to: string | null; algo: AlgorithmId; blocks: BlockSpec[] } = {
    from: null,
    to: null,
    algo: 'dijkstra',
    blocks: [],
  };
  let replayer: TraceReplayer | null = null;
  let replayUnit = 'm';

  const ui = buildControls(appRoot, {
    items,
    vertexCount: loaded.report.vertexCount,
    edgeCount: loaded.report.edgeCount,
    onPick: (which, id) => {
      if (which === 'from') {
        state.from = id;
        routeLayer.setStart(id);
      } else {
        state.to = id;
        routeLayer.setTarget(id);
      }
      labelsDirty = true; // start/destination labels are essential
      scene.focusOn(meshes.worldPos(id));
    },
  });

  // ── 3D scene (viewport created now, after the sidebar is in the DOM) ──────
  const viewport = document.createElement('main');
  viewport.className = 'viewport';
  appRoot.appendChild(viewport);

  const scene = new SceneManager(viewport);
  const layout = buildCampusLayout(loaded.dataset);
  const meshes = buildCampusMeshes(layout);
  scene.scene.add(meshes.group);
  const routeLayer = new RouteLayer(scene.scene, meshes);

  // Camera framing is derived from the dataset's useful bounds (contentBox),
  // never from a hardcoded pixel-dependent position — generic for any dataset.
  scene.frameAll(meshes.contentBox);

  // Block-mode indicator overlay (top-left of the viewport).
  const blockChipOverlay = document.createElement('div');
  blockChipOverlay.className = 'block-chip';
  blockChipOverlay.hidden = true;

  // Replay readout element lives in the sidebar (ui.replay.readout); the
  // viewport keeps one line of context when a replay is running.
  const replayOverlay = document.createElement('div');
  replayOverlay.className = 'replay-overlay';
  replayOverlay.hidden = true;
  viewport.append(blockChipOverlay, replayOverlay);

  // ── zoom-aware labels ─────────────────────────────────────────────────────
  const labelTiers = new Map<string, LabelTier>();
  for (const v of layout.vertices) labelTiers.set(v.id, tierOf(v));
  let labelsDirty = true;
  let hoveredVertexIds = new Set<string>();
  let lastLabelCamPos = new THREE.Vector3(Infinity, Infinity, Infinity);
  let lastLabelCamTarget = new THREE.Vector3(Infinity, Infinity, Infinity);

  const essentialLabelIds = (): Set<string> => {
    const set = new Set<string>();
    if (state.from !== null) set.add(state.from);
    if (state.to !== null) set.add(state.to);
    for (const id of hoveredVertexIds) set.add(id);
    return set;
  };

  const updateLabels = (): void => {
    if (!meshes.labelsVisible()) return;
    const cam = scene.camera;
    const target = scene.controls.target;
    const camDist = cam.position.distanceTo(target);

    // Recompute placements only when the camera (or essentials) moved.
    const camMoved =
      cam.position.distanceToSquared(lastLabelCamPos) > 0.25 ||
      target.distanceToSquared(lastLabelCamTarget) > 0.25;
    if (!camMoved && !labelsDirty) return;
    lastLabelCamPos.copy(cam.position);
    lastLabelCamTarget.copy(target);
    labelsDirty = false;

    const W = scene.renderer.domElement.clientWidth;
    const H = scene.renderer.domElement.clientHeight;
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const essentials = essentialLabelIds();
    const placements: LabelPlacement[] = [];
    const projected = new THREE.Vector3();

    for (const [id, sprite] of meshes.labels) {
      // Constant-screen-size-ish scaling first (readability), then measure.
      const base = sprite.userData.baseScale as THREE.Vector2;
      const d = cam.position.distanceTo(sprite.position);
      const k = THREE.MathUtils.clamp(d / 1500, 0.55, 2.3);
      sprite.scale.set(base.x * k, base.y * k, 1);

      projected.copy(sprite.position).project(cam);
      if (projected.z > 1) {
        sprite.visible = false;
        continue; // behind the camera
      }
      const px = ((projected.x + 1) / 2) * W;
      const py = ((1 - projected.y) / 2) * H;
      const perUnit = H / (2 * d * tanV); // pixels per world unit at this depth
      const halfW = (sprite.scale.x * perUnit) / 2;
      const halfH = (sprite.scale.y * perUnit) / 2;
      placements.push({
        id,
        tier: labelTiers.get(id) ?? 'medium',
        essential: essentials.has(id),
        distance: d,
        rect: { left: px - halfW, top: py - halfH, right: px + halfW, bottom: py + halfH },
      });
    }

    const visible = visibleLabelIds(placements, camDist);
    for (const [id, sprite] of meshes.labels) {
      const show = visible.has(id);
      sprite.visible = show;
      // Subtle distance fade so far labels recede (visibility, not data, changes).
      const mat = sprite.material as THREE.SpriteMaterial;
      const d = cam.position.distanceTo(sprite.position);
      if (show) {
        const essential = essentials.has(id);
        const tier = labelTiers.get(id) ?? 'medium';
        mat.opacity = essential || tier === 'major' ? 1 : THREE.MathUtils.clamp(1.2 - d / 2200, 0.45, 1);
      }
    }
  };

  // ── hover picking (easier block-mode targeting + hovered label priority) ──
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let pointerPx: { x: number; y: number } | null = null;
  let hoverDirty = false;
  let hoveredEdgeMesh: THREE.Mesh | null = null;
  let downAt: { x: number; y: number } | null = null;

  const pickObject = (): THREE.Object3D | null => {
    if (pointerPx === null) return null;
    const rect = scene.renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((pointerPx.x - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((pointerPx.y - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, scene.camera);
    const hits = raycaster.intersectObjects([...meshes.edges.values(), ...meshes.nodes.values()], false);
    return hits.length > 0 ? hits[0]!.object : null;
  };

  const updateHover = (): void => {
    if (!hoverDirty) return;
    hoverDirty = false;
    if (pointerPx === null) {
      routeLayer.setHoverEdge(null);
      if (hoveredEdgeMesh !== null || hoveredVertexIds.size > 0) {
        hoveredEdgeMesh = null;
        hoveredVertexIds = new Set();
        labelsDirty = true;
      }
      return;
    }
    const hit = pickObject();
    const newEdge: THREE.Mesh | null =
      hit !== null && hit.userData.edgeId !== undefined ? (hit as THREE.Mesh) : null;
    const newVerts = new Set<string>();
    if (newEdge !== null) {
      newVerts.add(newEdge.userData.fromId as string);
      newVerts.add(newEdge.userData.toId as string);
    } else if (hit !== null && hit.userData.vertexId !== undefined) {
      newVerts.add(hit.userData.vertexId as string);
    }
    routeLayer.setHoverEdge(newEdge);
    const changed =
      newEdge !== hoveredEdgeMesh || (newVerts.size === hoveredVertexIds.size && [...newVerts].some((v) => !hoveredVertexIds.has(v)));
    if (changed) {
      hoveredEdgeMesh = newEdge;
      hoveredVertexIds = newVerts;
      labelsDirty = true;
    }
    // Cursor: crosshair over a walkway in block mode; pointer over anything pickable.
    const canvas = scene.renderer.domElement;
    canvas.style.cursor = ui.blockMode.checked && newEdge !== null ? 'crosshair' : hit !== null ? 'pointer' : 'grab';
  };

  scene.renderer.domElement.addEventListener('pointermove', (e: PointerEvent) => {
    pointerPx = { x: e.clientX, y: e.clientY };
    hoverDirty = true;
  });
  scene.renderer.domElement.addEventListener('pointerleave', () => {
    pointerPx = null;
    hoverDirty = true;
  });

  // Per-frame: replay advance (dt seconds), route pulse/flash, hover, labels.
  scene.onTick((dt) => {
    replayer?.tick(dt);
    routeLayer.tick(performance.now());
    updateHover();
    updateLabels();
  });

  const setPanelMessage = (panel: HTMLElement, text: string): void => {
    panel.innerHTML = `<div class="panel-card"><div class="hint">${text}</div></div>`;
  };
  const clearPanel = (panel: HTMLElement): void => {
    panel.innerHTML = '';
  };
  const clearAllPanels = (): void => {
    for (const p of Object.values(ui.panels)) clearPanel(p);
  };

  // ── replay readout (TRACE REPLAY panel) ───────────────────────────────────
  const setReplayReadout = (title: string, stepText: string, kind: string, detail: string, sub: string | null): void => {
    const r = ui.replay.readout;
    r.hidden = false;
    r.innerHTML = '';
    r.appendChild(Object.assign(document.createElement('div'), { className: 'rr-title', textContent: title }));
    r.appendChild(Object.assign(document.createElement('div'), { className: 'rr-step', textContent: stepText }));
    r.appendChild(Object.assign(document.createElement('div'), { className: 'rr-kind', textContent: `Current event: ${kind}` }));
    r.appendChild(Object.assign(document.createElement('div'), { className: 'rr-detail', textContent: detail }));
    if (sub !== null) r.appendChild(Object.assign(document.createElement('div'), { className: 'rr-sub', textContent: sub }));
  };

  const clearReplayReadout = (): void => {
    ui.replay.readout.hidden = true;
    ui.replay.readout.innerHTML = '';
  };

  const stopReplay = (): void => {
    replayer?.pause();
    replayer = null;
    ui.replay.progress.textContent = '0 / 0';
    replayOverlay.hidden = true;
    clearReplayReadout();
  };

  const startReplay = (
    result: RouteResult,
    title: string,
    onDone: (r: RouteResult) => void,
  ): void => {
    routeLayer.clearRoutes();
    routeLayer.resetHighlights();
    stopReplay();
    replayUnit = ALGO_UNIT[state.algo];
    replayer = new TraceReplayer(result.trace, {
      onEvent: (ev, i, n) => {
        routeLayer.applyTraceEvent(ev);
        const desc = describeTraceEvent(ev, nameOf, replayUnit);
        setReplayReadout(title, `Step ${i + 1} / ${n}`, desc.kind, desc.detail, desc.sub ?? null);
        replayOverlay.hidden = false;
        replayOverlay.textContent = `REPLAY · ${title} · ${i + 1}/${n} · ${desc.kind}`;
      },
      onProgress: (i, n) => {
        ui.replay.progress.textContent = `${i} / ${n}`;
      },
      onDone: () => onDone(result),
    });
    replayer.setSpeed(Number(ui.replay.speed.value));
    replayer.play();
  };

  const ready = (): string | null => {
    if (state.from === null || state.to === null) return 'Pick a start and a destination first.';
    if (state.from === state.to) return 'Start and destination must differ.';
    return null;
  };

  // ── FIND ROUTE ────────────────────────────────────────────────────────────
  const doFindRoute = (): void => {
    const problem = ready();
    if (problem !== null || state.from === null || state.to === null) {
      setPanelMessage(ui.panels.route, problem ?? '');
      return;
    }
    const { from, to, algo } = state;
    clearPanel(ui.panels.compare);
    clearPanel(ui.panels.alternative);
    clearPanel(ui.panels.block);
    const result = findRoute(graph, from, to, algo);
    startReplay(result, ALGO_LABEL[algo], (r) => {
      if (r.status === 'ok') {
        const isBfs = algo === 'bfs';
        const routeLen = isBfs ? pathLengthMeters(r.path, weightOf) : null;
        routeLayer.showRoute(r.path, ROUTE_COLOR, true);
        routeLayer.applyRouteEmphasis([r.path]);
        routeLayer.setTargetState(true);
        renderRouteResult(ui.panels.route, r, ALGO_LABEL[algo], routeLen);
      } else {
        routeLayer.clearEmphasis();
        routeLayer.setTargetState(false);
        renderRouteResult(ui.panels.route, r, ALGO_LABEL[algo], null);
      }
    });
  };

  // ── COMPARE DIJKSTRA vs A* ────────────────────────────────────────────────
  const doCompare = (): void => {
    const problem = ready();
    if (problem !== null || state.from === null || state.to === null) {
      setPanelMessage(ui.panels.compare, problem ?? '');
      return;
    }
    const cmp = compareAlgorithms(graph, state.from, state.to);
    renderComparison(ui.panels.compare, cmp);
  };

  // ── FIND ALTERNATIVE ──────────────────────────────────────────────────────
  const doAlternative = (): void => {
    const problem = ready();
    if (problem !== null || state.from === null || state.to === null) {
      setPanelMessage(ui.panels.alternative, problem ?? '');
      return;
    }
    const alt = findAlternativeRoute(graph, state.from, state.to, 'dijkstra');
    if (alt.status === 'ok' && alt.primary !== null) {
      stopReplay();
      routeLayer.clearRoutes();
      routeLayer.resetHighlights();
      routeLayer.showRoute(alt.primary.path, ROUTE_COLOR, false);
      if (alt.alternative !== null) {
        routeLayer.showRoute(alt.alternative.path, ALT_ROUTE_COLOR, true);
        routeLayer.applyRouteEmphasis([alt.primary.path, alt.alternative.path]);
      } else {
        routeLayer.applyRouteEmphasis([alt.primary.path]);
      }
    }
    renderAlternative(ui.panels.alternative, alt);
  };

  // ── RESET ─────────────────────────────────────────────────────────────────
  const doReset = (): void => {
    state.blocks = [];
    stopReplay();
    routeLayer.clearAll();
    clearAllPanels();
    updateBlockChip();
  };

  // ── blocked-path simulation ───────────────────────────────────────────────
  const rerunWithBlocks = (): void => {
    if (state.from === null || state.to === null || state.from === state.to) return;
    updateBlockChip();
    if (state.blocks.length === 0) {
      clearPanel(ui.panels.block);
      doFindRoute();
      return;
    }
    const sim = simulateBlockedRoute(graph, state.from, state.to, state.blocks, 'dijkstra');
    routeLayer.clearRoutes();
    routeLayer.resetHighlights();
    stopReplay();
    replayer = new TraceReplayer(sim.after.trace, {
      onEvent: (ev, i, n) => {
        routeLayer.applyTraceEvent(ev);
        const desc = describeTraceEvent(ev, nameOf, 'm');
        setReplayReadout('RE-ROUTE (Dijkstra)', `Step ${i + 1} / ${n}`, desc.kind, desc.detail, desc.sub ?? null);
        replayOverlay.hidden = false;
        replayOverlay.textContent = `REPLAY · RE-ROUTE · ${i + 1}/${n} · ${desc.kind}`;
      },
      onProgress: (i, n) => {
        ui.replay.progress.textContent = `${i} / ${n} (re-route)`;
      },
      onDone: () => {
        if (sim.after.status === 'ok') {
          routeLayer.showRoute(sim.after.path, ROUTE_COLOR, true);
          routeLayer.applyRouteEmphasis([sim.after.path]);
          routeLayer.setTargetState(true);
        } else {
          routeLayer.clearEmphasis();
          routeLayer.setTargetState(false);
        }
        renderBlockReport(ui.panels.block, sim.before, sim.after, state.blocks.length);
      },
    });
    replayer.setSpeed(Number(ui.replay.speed.value));
    replayer.play();
  };

  // Block chips: sidebar count + viewport overlay.
  const updateBlockChip = (): void => {
    const n = state.blocks.length;
    ui.blockChip.hidden = n === 0;
    ui.blockChip.textContent = n === 1 ? '1 WALKWAY BLOCKED' : `${n} WALKWAYS BLOCKED`;
    blockChipOverlay.hidden = !ui.blockMode.checked;
    blockChipOverlay.textContent =
      ui.blockMode.checked
        ? `⛔ BLOCK MODE${n > 0 ? ` · ${n} blocked` : ''} — click a walkway to block it · click a red one to unblock`
        : '';
  };

  // ── raycast click (block mode + click-to-focus) ──────────────────────────
  const pick = (clientX: number, clientY: number): THREE.Object3D | null => {
    const rect = scene.renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, scene.camera);
    const hits = raycaster.intersectObjects([...meshes.edges.values(), ...meshes.nodes.values()], false);
    return hits.length > 0 ? hits[0]!.object : null;
  };

  const isEdge = (o: THREE.Object3D): boolean => o.userData.edgeId !== undefined;

  scene.renderer.domElement.addEventListener('pointerdown', (e: PointerEvent) => {
    downAt = { x: e.clientX, y: e.clientY };
  });
  scene.renderer.domElement.addEventListener('pointerup', (e: PointerEvent) => {
    if (downAt === null) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > 6) return; // it was a drag (orbit), not a click
    const hit = pick(e.clientX, e.clientY);
    if (hit === null) return;

    if (ui.blockMode.checked) {
      if (!isEdge(hit)) return;
      const edgeId = hit.userData.edgeId as string;
      const fromId = hit.userData.fromId as string;
      const toId = hit.userData.toId as string;
      const spec: BlockSpec = { from: fromId, to: toId };
      const idx = state.blocks.findIndex((b) => pairKey(b.from, b.to) === pairKey(fromId, toId));
      if (idx >= 0) {
        state.blocks.splice(idx, 1);
        routeLayer.setBlocked(edgeId, false);
      } else {
        state.blocks.push(spec);
        routeLayer.setBlocked(edgeId, true);
      }
      rerunWithBlocks();
    } else if (!isEdge(hit)) {
      const vertexId = hit.userData.vertexId as string | undefined;
      if (vertexId !== undefined) {
        scene.focusOn(meshes.worldPos(vertexId));
      }
    }
  });

  // ── wire buttons ──────────────────────────────────────────────────────────
  ui.btnFindRoute.addEventListener('click', doFindRoute);
  ui.btnCompare.addEventListener('click', doCompare);
  ui.btnAlternative.addEventListener('click', doAlternative);
  ui.btnReset.addEventListener('click', doReset);
  ui.btnCamera.addEventListener('click', () => scene.frameAll(meshes.contentBox, true));
  ui.btnSwap.addEventListener('click', () => {
    const f = state.from;
    state.from = state.to;
    state.to = f;
    ui.fromSelect.set(state.from);
    ui.toSelect.set(state.to);
    if (state.from !== null) routeLayer.setStart(state.from);
    if (state.to !== null) routeLayer.setTarget(state.to);
    labelsDirty = true;
  });
  const updateAlgoNotes = (): void => {
    for (const note of ui.algoNotes.querySelectorAll<HTMLElement>('.algo-note')) {
      note.classList.toggle('active', note.dataset.algo === state.algo);
    }
  };
  ui.algorithm.addEventListener('change', () => {
    state.algo = ui.algorithm.value as AlgorithmId;
    updateAlgoNotes();
  });
  ui.labelsToggle.addEventListener('change', () => {
    meshes.setLabelsVisible(ui.labelsToggle.checked);
    labelsDirty = true;
  });
  ui.blockMode.addEventListener('change', () => {
    updateBlockChip();
    hoverDirty = true; // refresh cursor immediately
  });
  scene.renderer.domElement.style.cursor = 'grab';

  // replay controls
  ui.replay.btnPlay.addEventListener('click', () => replayer?.play());
  ui.replay.btnPause.addEventListener('click', () => replayer?.pause());
  ui.replay.btnReplayReset.addEventListener('click', () => {
    if (replayer !== null) {
      stopReplay();
      routeLayer.resetHighlights();
      routeLayer.clearRoutes();
      if (state.from !== null && state.to !== null && state.from !== state.to) {
        const r = findRoute(graph, state.from, state.to, state.algo);
        startReplay(r, ALGO_LABEL[state.algo], (res) => {
          if (res.status === 'ok') {
            routeLayer.showRoute(res.path, ROUTE_COLOR, true);
            routeLayer.applyRouteEmphasis([res.path]);
            routeLayer.setTargetState(true);
          } else {
            routeLayer.clearEmphasis();
            routeLayer.setTargetState(false);
          }
          renderRouteResult(
            ui.panels.route,
            res,
            ALGO_LABEL[state.algo],
            res.status === 'ok' && state.algo === 'bfs' ? pathLengthMeters(res.path, weightOf) : null,
          );
        });
      }
    }
  });
  ui.replay.speed.addEventListener('input', () => {
    replayer?.setSpeed(Number(ui.replay.speed.value));
  });

  // provenance info
  const openInfoPanel = (): void => {
    renderProvenanceInfo(ui.infoPanel.querySelector('.prov-info-body') ?? ui.infoPanel);
    ui.infoPanel.hidden = false;
  };
  ui.infoButton.addEventListener('click', openInfoPanel);

  // ── sensible defaults for the demo (Main Entrance → France) ───────────────
  ui.fromSelect.set('gate-main');
  ui.toSelect.set('pav-france');
  state.from = 'gate-main';
  state.to = 'pav-france';
  routeLayer.setStart('gate-main');
  routeLayer.setTarget('pav-france');
  updateAlgoNotes();
  labelsDirty = true;
}

main();
