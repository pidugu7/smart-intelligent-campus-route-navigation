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
import { TraceReplayer } from '../viz/replay';
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

  // Frame the whole park (initial view) and keep a Box3 for RESET CAMERA.
  const worldBox = new THREE.Box3().setFromObject(meshes.group);
  scene.frameAll(worldBox);

  // Per-frame: route pulse/flash animation + constant-screen-size labels.
  scene.onTick((_dt, _t) => {
    routeLayer.tick(performance.now());
    const cam = scene.camera;
    for (const s of meshes.labels.values()) {
      const base = s.userData.baseScale as THREE.Vector2;
      const d = cam.position.distanceTo(s.position);
      const k = THREE.MathUtils.clamp(d / 1500, 0.55, 2.3);
      s.scale.set(base.x * k, base.y * k, 1);
    }
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

  const stopReplay = (): void => {
    replayer?.pause();
    replayer = null;
    ui.replay.progress.textContent = '0 / 0';
  };

  const startReplay = (result: RouteResult, onDone: (r: RouteResult) => void): void => {
    routeLayer.clearRoutes();
    routeLayer.resetHighlights();
    stopReplay();
    replayer = new TraceReplayer(result.trace, {
      onEvent: (ev) => routeLayer.applyTraceEvent(ev),
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
    startReplay(result, (r) => {
      if (r.status === 'ok') {
        const isBfs = algo === 'bfs';
        const routeLen = isBfs ? pathLengthMeters(r.path, weightOf) : null;
        routeLayer.showRoute(r.path, ROUTE_COLOR, true);
        routeLayer.setTargetState(true);
        renderRouteResult(ui.panels.route, r, ALGO_LABEL[algo], routeLen);
      } else {
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
  };

  // ── blocked-path simulation ───────────────────────────────────────────────
  const rerunWithBlocks = (): void => {
    if (state.from === null || state.to === null || state.from === state.to) return;
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
      onEvent: (ev) => routeLayer.applyTraceEvent(ev),
      onProgress: (i, n) => {
        ui.replay.progress.textContent = `${i} / ${n} (re-route)`;
      },
      onDone: () => {
        if (sim.after.status === 'ok') {
          routeLayer.showRoute(sim.after.path, ROUTE_COLOR, true);
          routeLayer.setTargetState(true);
        } else {
          routeLayer.setTargetState(false);
        }
        renderBlockReport(ui.panels.block, sim.before, sim.after, state.blocks.length);
      },
    });
    replayer.setSpeed(Number(ui.replay.speed.value));
    replayer.play();
  };

  // ── raycasting (block mode + click-to-focus) ──────────────────────────────
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt: { x: number; y: number } | null = null;

  const pick = (clientX: number, clientY: number): THREE.Object3D | null => {
    const rect = scene.renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, scene.camera);
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
  ui.btnCamera.addEventListener('click', () => scene.frameAll(worldBox, true));
  ui.btnSwap.addEventListener('click', () => {
    const f = state.from;
    state.from = state.to;
    state.to = f;
    ui.fromSelect.set(state.from);
    ui.toSelect.set(state.to);
    if (state.from !== null) routeLayer.setStart(state.from);
    if (state.to !== null) routeLayer.setTarget(state.to);
  });
  ui.algorithm.addEventListener('change', () => {
    state.algo = ui.algorithm.value as AlgorithmId;
  });
  ui.labelsToggle.addEventListener('change', () => {
    meshes.setLabelsVisible(ui.labelsToggle.checked);
  });
  ui.blockMode.addEventListener('change', () => {
    scene.renderer.domElement.style.cursor = ui.blockMode.checked ? 'crosshair' : 'grab';
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
        startReplay(r, (res) => {
          if (res.status === 'ok') {
            routeLayer.showRoute(res.path, ROUTE_COLOR, true);
            routeLayer.setTargetState(true);
          } else {
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
  ui.infoButton.addEventListener('click', () => {
    renderProvenanceInfo(ui.infoPanel.querySelector('.prov-info-body') ?? ui.infoPanel);
    ui.infoPanel.hidden = false;
  });

  // ── sensible defaults for the demo (Main Entrance → France) ───────────────
  ui.fromSelect.set('gate-main');
  ui.toSelect.set('pav-france');
  state.from = 'gate-main';
  state.to = 'pav-france';
  routeLayer.setStart('gate-main');
  routeLayer.setTarget('pav-france');
}

main();
