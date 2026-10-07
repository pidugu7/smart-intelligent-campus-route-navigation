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
 *
 * Phase 6 additions: Guest/Engineer modes (one scene, one state), canvas
 * toolbar, bottom dock, replay timeline + HUD + plain-English narrator,
 * first-run tour, boot sequence, cinematic route intro (reduced-motion
 * aware), block-path tool with detour status, priority-aware labels.
 */

import * as THREE from 'three';
import epcot from '../data/datasets/epcot/dataset.json';
import { loadDataset } from '../data/loader';
import {
  compareAlgorithms,
  estimateWalkTime,
  findAlternativeRoute,
  findRoute,
  simulateBlockedRoute,
  type AlgorithmId,
  type BlockSpec,
  type RouteResult,
} from '../engine/engine';
import { SceneManager, type RenderQuality, type TimeOfDay } from '../viz/scene';
import { buildCampusLayout } from '../viz/layout';
import { buildCampusMeshes, pairKey } from '../viz/campus-mesh';
import {
  RouteLayer,
  ROUTE_COLOR,
  ALT_ROUTE_COLOR,
  PRIMARY_ROUTE_RADIUS,
  ALT_ROUTE_RADIUS,
} from '../viz/route-layer';
import { TraceReplayer, describeTraceEvent } from '../viz/replay';
import { resolveLabels, type LabelContext, type LabelPlacement, type LabelTier } from '../viz/label-policy';
import { buildControls, type AppMode } from './ui/controls';
import {
  pathLengthMeters,
  renderAlternative,
  renderBlockReport,
  renderComparison,
  renderGuestSummary,
  renderProvenanceInfo,
  renderRouteResult,
  fmtDistance,
  fmtTime,
} from './ui/readout';
import { buildTimeline } from './ui/timeline';
import { buildHud } from './ui/hud';
import { buildTour, hasCompletedTour } from './ui/tour';
import { icon } from './ui/icons';
import { narrateEvent, technicalEventKind } from './narrator';
import type { SearchItem } from './ui/search';
import './style.css';

const ALGO_LABEL: Record<AlgorithmId, string> = {
  dijkstra: 'Dijkstra',
  astar: 'A*',
  bfs: 'BFS',
};

/** Base replay pace (events/sec) for the 1× speed preset. */
const BASE_EVENTS_PER_SEC = 14;

const REDUCED_MOTION =
  typeof window !== 'undefined' && window.matchMedia !== undefined
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

function tierOf(v: { major: boolean; type: string }): LabelTier {
  if (v.major) return 'major';
  if (v.type === 'attraction' || v.type === 'landmark') return 'detail';
  return 'medium';
}

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

async function main(): Promise<void> {
  const appRoot = document.getElementById('app');
  if (appRoot === null) throw new Error('#app missing');

  // ── boot overlay (real steps only — no fake percentages) ────────────────
  const boot = document.getElementById('boot') as HTMLElement | null;
  const bootStep = (name: 'map' | 'locations' | 'graph', state: 'active' | 'ok'): void => {
    const el = boot?.querySelector<HTMLElement>(`.boot-step[data-step="${name}"]`);
    if (el === undefined || el === null) return;
    el.classList.toggle('active', state === 'active');
    el.classList.toggle('ok', state === 'ok');
  };
  const finishBoot = (): void => {
    bootStep('graph', 'ok');
    boot?.classList.add('done');
    window.setTimeout(() => boot?.remove(), 600);
  };

  // ── data → graph (engine is the source of truth) ─────────────────────────
  const loaded = loadDataset(epcot);
  const graph = loaded.graph;
  const edgeWeight = new Map<string, number>();
  for (const e of loaded.dataset.edges) {
    edgeWeight.set(pairKey(e.from, e.to), e.weight);
  }
  const weightOf = (a: string, b: string): number => edgeWeight.get(pairKey(a, b)) ?? 0;
  const nameOf = (id: string): string => loaded.dataset.vertices.find((v) => v.id === id)?.name ?? id;

  // ── shared state (ONE for both modes) ────────────────────────────────────
  const state: {
    from: string | null;
    to: string | null;
    algo: AlgorithmId;
    blocks: BlockSpec[];
    routePath: readonly string[] | null;
    blockActive: boolean;
  } = {
    from: null,
    to: null,
    algo: 'dijkstra',
    blocks: [],
    routePath: null,
    blockActive: false,
  };

  const items: SearchItem[] = loaded.dataset.vertices.map((v) => ({
    id: v.id,
    label: v.name,
    hint: v.type,
  }));

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
      labelsDirty = true;
      scene.focusOn(meshes.worldPos(id));
      renderGuestSummaryNow();
    },
  });

  // ── 3D scene ─────────────────────────────────────────────────────────────
  const viewport = document.createElement('main');
  viewport.className = 'viewport';
  appRoot.appendChild(viewport);
  // Map overlays position relative to the viewport (the map area).
  viewport.append(ui.toolbar.root, ui.dock.root, ui.hudSlot, ui.badge, ui.infoPanel);

  bootStep('map', 'active');
  await nextFrame();

  const scene = new SceneManager(viewport);
  const layout = buildCampusLayout(loaded.dataset);
  const meshes = buildCampusMeshes(layout);
  scene.scene.add(meshes.group);
  const routeLayer = new RouteLayer(scene.scene, meshes);
  scene.frameAll(meshes.contentBox);

  bootStep('map', 'ok');
  bootStep('locations', 'active');
  await nextFrame();

  // ── HUD (both modes, replaces the old "Replaying…" pill) ─────────────────
  const hud = buildHud();
  ui.hudSlot.appendChild(hud.root);

  // ── timeline (shared: dock in Guest, sidebar in Engineer) ────────────────
  const timeline = buildTimeline({
    onPlayPause: () => {
      if (replayer === null) return;
      if (replayer.isPlaying) replayer.pause();
      else replayer.play();
      setReplayPlayingUi(replayer.isPlaying);
    },
    onRestart: () => {
      if (lastResult !== null) restartReplay(lastResult, ALGO_LABEL[replayAlgo]);
    },
    onStepBack: () => {
      if (replayer === null) return;
      seekTo(Math.max(0, replayer.currentIndex - 1));
    },
    onStepForward: () => {
      if (replayer === null) return;
      seekTo(Math.min(replayer.totalEvents, replayer.currentIndex + 1));
    },
    onSeek: (i) => {
      if (replayer !== null) seekTo(i);
    },
    onSpeed: (m) => {
      replayer?.setSpeed(BASE_EVENTS_PER_SEC * m);
    },
  });
  ui.dock.timelineSlot.appendChild(timeline.root); // Guest is the default
  timeline.setEnabled(false); // no replay loaded yet

  // ── zoom-aware priority labels ───────────────────────────────────────────
  const labelTiers = new Map<string, LabelTier>();
  for (const v of layout.vertices) labelTiers.set(v.id, tierOf(v));
  const labelBasePos = new Map<string, THREE.Vector3>();
  for (const [id, sprite] of meshes.labels) labelBasePos.set(id, sprite.position.clone());
  const leaderLines = new Map<string, THREE.Line>();
  let labelsDirty = true;
  let hoveredVertexIds = new Set<string>();
  let lastLabelCamPos = new THREE.Vector3(Infinity, Infinity, Infinity);
  let lastLabelCamTarget = new THREE.Vector3(Infinity, Infinity, Infinity);

  const leaderLine = (id: string, sprite: THREE.Sprite, base: THREE.Vector3): THREE.Line => {
    let line = leaderLines.get(id);
    if (line === undefined) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({ color: 0x5b7aa5, transparent: true, opacity: 0.55, depthTest: false });
      line = new THREE.Line(geo, mat);
      line.renderOrder = 18;
      line.visible = false;
      meshes.group.add(line);
      leaderLines.set(id, line);
    }
    const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, base.x, base.y, base.z);
    pos.setXYZ(1, sprite.position.x, sprite.position.y, sprite.position.z);
    pos.needsUpdate = true;
    line.visible = true;
    return line;
  };

  const hideLeaderLine = (id: string): void => {
    const line = leaderLines.get(id);
    if (line !== undefined) line.visible = false;
  };

  const updateLabels = (): void => {
    if (!meshes.labelsVisible()) return;
    const cam = scene.camera;
    const target = scene.controls.target;
    const camDist = cam.position.distanceTo(target);

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
    const placements: LabelPlacement[] = [];
    const projected = new THREE.Vector3();

    for (const [id, sprite] of meshes.labels) {
      const base = sprite.userData.baseScale as THREE.Vector2;
      const d = cam.position.distanceTo(sprite.position);
      const k = THREE.MathUtils.clamp(d / 1500, 0.55, 2.3);
      sprite.scale.set(base.x * k, base.y * k, 1);

      projected.copy(sprite.position).project(cam);
      if (projected.z > 1) {
        sprite.visible = false;
        hideLeaderLine(id);
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
        essential: id === state.from || id === state.to,
        distance: d,
        rect: { left: px - halfW, top: py - halfH, right: px + halfW, bottom: py + halfH },
      });
      sprite.userData.perUnit = perUnit;
    }

    const ctx: LabelContext = {
      hoveredId: hoveredVertexIds.values().next().value ?? null,
      selectedId: null,
      originId: state.from,
      destinationId: state.to,
      ...(state.routePath !== null ? { routeIds: state.routePath } : {}),
    };
    const decisions = resolveLabels(placements, camDist, ctx);

    for (const [id, sprite] of meshes.labels) {
      const decision = decisions.get(id);
      const base = labelBasePos.get(id);
      if (decision === undefined || base === undefined) continue;
      const tier = labelTiers.get(id) ?? 'medium';
      const essential = id === state.from || id === state.to || hoveredVertexIds.has(id);

      if (decision.verdict === 'hide') {
        sprite.visible = false;
        hideLeaderLine(id);
        continue;
      }

      sprite.visible = true;
      // Reset to base, then apply the vertical offset (screen px → world).
      sprite.position.copy(base);
      if (decision.verdict === 'offset') {
        const perUnit = sprite.userData.perUnit ?? 1;
        sprite.position.y += decision.offsetY / perUnit; // +px = up
        leaderLine(id, sprite, base);
      } else {
        hideLeaderLine(id);
      }
      const mat = sprite.material as THREE.SpriteMaterial;
      const d = cam.position.distanceTo(sprite.position);
      if (decision.verdict === 'fade') {
        mat.opacity = 0.24;
      } else if (decision.emphasis === 1) {
        mat.opacity = 1; // route stops: full emphasis
      } else {
        mat.opacity = essential || tier === 'major' ? 1 : THREE.MathUtils.clamp(1.2 - d / 2200, 0.45, 1);
      }
    }
  };

  // ── hover picking ────────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let pointerPx: { x: number; y: number } | null = null;
  let hoverDirty = false;
  let hoveredEdgeMesh: THREE.Mesh | null = null;
  let downAt: { x: number; y: number } | null = null;

  const pickObject = (clientX: number, clientY: number): THREE.Object3D | null => {
    const rect = scene.renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
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
    const hit = pickObject(pointerPx.x, pointerPx.y);
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
    const canvas = scene.renderer.domElement;
    canvas.style.cursor = state.blockActive && newEdge !== null ? 'crosshair' : hit !== null ? 'pointer' : 'grab';
  };

  scene.renderer.domElement.addEventListener('pointermove', (e: PointerEvent) => {
    pointerPx = { x: e.clientX, y: e.clientY };
    hoverDirty = true;
  });
  scene.renderer.domElement.addEventListener('pointerleave', () => {
    pointerPx = null;
    hoverDirty = true;
  });

  // Per-frame: replay advance (dt seconds), route pulse/chevrons, hover, labels.
  scene.onTick((dt) => {
    replayer?.tick(dt);
    routeLayer.tick(performance.now());
    updateHover();
    updateLabels();
  });

  // ── panels ───────────────────────────────────────────────────────────────
  const setPanelMessage = (panel: HTMLElement, text: string): void => {
    panel.innerHTML = `<div class="panel-card"><div class="hint">${text}</div></div>`;
  };
  const clearPanel = (panel: HTMLElement): void => {
    panel.innerHTML = '';
  };
  const clearAllPanels = (): void => {
    for (const p of Object.values(ui.panels)) clearPanel(p);
  };

  // ── replay readout (Engineer sidebar: technical) ─────────────────────────
  const setReplayReadout = (title: string, stepText: string, kind: string, detail: string, sub: string | null): void => {
    const r = ui.replay.readout;
    r.hidden = false;
    r.innerHTML = '';
    r.appendChild(Object.assign(document.createElement('div'), { className: 'rr-title', textContent: `Trace replay · ${title}` }));
    r.appendChild(Object.assign(document.createElement('div'), { className: 'rr-step', textContent: stepText }));
    r.appendChild(Object.assign(document.createElement('div'), { className: 'rr-kind', textContent: `Current event: ${kind}` }));
    r.appendChild(Object.assign(document.createElement('div'), { className: 'rr-detail', textContent: detail }));
    if (sub !== null) r.appendChild(Object.assign(document.createElement('div'), { className: 'rr-sub', textContent: sub }));
  };

  const clearReplayReadout = (): void => {
    ui.replay.readout.hidden = true;
    ui.replay.readout.innerHTML = '';
  };

  let replayer: TraceReplayer | null = null;
  let lastResult: RouteResult | null = null;
  let replayAlgo: AlgorithmId = 'dijkstra';

  const setReplayPlayingUi = (playing: boolean): void => {
    timeline.setPlaying(playing);
    if (playing) hud.setState('replaying');
    else if (replayer !== null && replayer.state === 'done') hud.setState('done');
    else if (replayer !== null) hud.setState('paused');
    else hud.setState('hidden');
  };

  /** Scrub the timeline: re-derive cumulative scene state for the prefix. */
  const seekTo = (i: number): void => {
    if (replayer === null) return;
    const total = replayer.totalEvents;
    const clamped = Math.max(0, Math.min(i, total));
    const wasPlaying = replayer.isPlaying;
    replayer.seekTo(clamped);
    routeLayer.resetHighlights();
    for (let j = 0; j < clamped; j += 1) {
      routeLayer.applyTraceEvent(replayer.eventAt(j));
    }
    timeline.setProgress(clamped, total);
    hud.setEvent(clamped, total);
    if (clamped > 0) {
      const ev = replayer.eventAt(clamped - 1);
      hud.setCaption(narrateEvent(ev, nameOf, replayAlgo));
    } else {
      hud.setCaption('');
    }
    if (wasPlaying) replayer.pause();
    setReplayPlayingUi(false);
    if (clamped === total && total > 0) completeOnScrubEnd();
  };

  const stopReplay = (): void => {
    replayer?.pause();
    replayer = null;
    timeline.setEnabled(false);
    timeline.setPlaying(false);
    clearReplayReadout();
  };

  /**
   * Begin (or restart) replaying a finished run. Auto-starts (Phase 6) —
   * the user does not need to press Play. Deterministic: the trace is the
   * engine's exact event log; the replayer only schedules it.
   */
  const startReplay = (
    result: RouteResult,
    title: string,
    onDone: (r: RouteResult) => void,
  ): void => {
    routeLayer.clearRoutes();
    routeLayer.resetHighlights();
    stopReplay();
    state.routePath = result.status === 'ok' ? result.path : null;
    labelsDirty = true;
    replayAlgo = state.algo;
    lastResult = result;

    timeline.buildMarkers(result.trace);
    timeline.setEnabled(true);
    timeline.setProgress(0, result.trace.length);
    hud.setAlgorithm(title);
    hud.setEvent(0, result.trace.length);
    hud.setCaption('');

    replayer = new TraceReplayer(result.trace, {
      onEvent: (ev, i, n) => {
        routeLayer.applyTraceEvent(ev);
        timeline.setProgress(i + 1, n);
        hud.setEvent(i + 1, n);
        hud.setCaption(narrateEvent(ev, nameOf, replayAlgo)); // plain English, both modes
        if (mode === 'engineer') {
          const desc = describeTraceEvent(ev, nameOf, replayAlgo === 'bfs' ? 'hops' : 'm');
          setReplayReadout(title, `Step ${i + 1} of ${n}`, technicalEventKind(ev), desc.detail, desc.sub ?? null);
        }
      },
      onDone: () => {
        setReplayPlayingUi(false);
        onDone(result);
      },
    });
    replayer.setSpeed(BASE_EVENTS_PER_SEC);
    replayer.play();
    setReplayPlayingUi(true);
  };

  /** Complete a replay early when the user scrubs the timeline to the end. */
  const completeOnScrubEnd = (): void => {
    if (lastResult !== null) completeReplay(lastResult, false);
  };

  const ready = (): string | null => {
    if (state.from === null || state.to === null) return 'Pick a start and a destination first.';
    if (state.from === state.to) return 'Start and destination must differ.';
    return null;
  };

  /** HUD summary line after a successful replay (both modes). */
  const finishReplayHud = (r: RouteResult): void => {
    if (r.status !== 'ok') {
      hud.setSummary('No route — destination unreachable');
      return;
    }
    const isBfs = replayAlgo === 'bfs';
    const meters = isBfs ? pathLengthMeters(r.path, weightOf) : r.totalDistance;
    const walk = fmtTime(estimateWalkTime(meters).estimatedSeconds);
    hud.setSummary(`${isBfs ? `${r.totalDistance} stops · ` : ''}${fmtDistance(meters)} · ≈ ${walk} · ${ALGO_LABEL[replayAlgo]}`);
  };

  /**
   * Show the finished result everywhere (route ribbon, panels, guest
   * strip, HUD summary) + optional cinematic intro. Used both when
   * playback reaches the end naturally AND when the user scrubs there.
   */
  const completeReplay = (r: RouteResult, allowCinematic: boolean): void => {
    if (r.status === 'ok') {
      const isBfs = replayAlgo === 'bfs';
      const routeLen = isBfs ? pathLengthMeters(r.path, weightOf) : null;
      routeLayer.showRoute(r.path, ROUTE_COLOR, { pulse: true, chevrons: true, radius: PRIMARY_ROUTE_RADIUS });
      routeLayer.applyRouteEmphasis([r.path]);
      routeLayer.setTargetState(true);
      renderRouteResult(ui.panels.route, r, ALGO_LABEL[replayAlgo], routeLen);
    } else {
      routeLayer.clearEmphasis();
      routeLayer.setTargetState(false);
      state.routePath = null;
      renderRouteResult(ui.panels.route, r, ALGO_LABEL[replayAlgo], null);
    }
    renderGuestSummaryNow();
    finishReplayHud(r);
    if (allowCinematic) cinematicIntro(r);
  };

  // ── FIND ROUTE ────────────────────────────────────────────────────────────
  const doFindRoute = (): void => {
    const problem = ready();
    if (problem !== null || state.from === null || state.to === null) {
      if (mode === 'engineer') setPanelMessage(ui.panels.route, problem ?? '');
      else flashGuestCard();
      return;
    }
    const { from, to, algo } = state;
    clearPanel(ui.panels.compare);
    clearPanel(ui.panels.alternative);
    clearPanel(ui.panels.block);
    const result = findRoute(graph, from, to, algo);
    startReplay(result, ALGO_LABEL[algo], (r) => completeReplay(r, true));
  };

  const restartReplay = (result: RouteResult, title: string): void => {
    state.algo = replayAlgo;
    ui.algorithm.value = replayAlgo;
    startReplay(result, title, (r) => completeReplay(r, false));
  };

  // ── COMPARE (engineer panel; guest gets the same card in dock context) ───
  const doCompare = (): void => {
    const problem = ready();
    if (problem !== null || state.from === null || state.to === null) {
      if (mode === 'engineer') setPanelMessage(ui.panels.compare, problem ?? '');
      else flashGuestCard();
      return;
    }
    const cmp = compareAlgorithms(graph, state.from, state.to);
    renderComparison(ui.panels.compare, cmp);
    mirrorToGuest(ui.panels.compare);
  };

  // ── FIND ALTERNATIVE ──────────────────────────────────────────────────────
  const doAlternative = (): void => {
    const problem = ready();
    if (problem !== null || state.from === null || state.to === null) {
      if (mode === 'engineer') setPanelMessage(ui.panels.alternative, problem ?? '');
      else flashGuestCard();
      return;
    }
    const alt = findAlternativeRoute(graph, state.from, state.to, 'dijkstra');
    if (alt.status === 'ok' && alt.primary !== null) {
      stopReplay();
      routeLayer.clearRoutes();
      routeLayer.resetHighlights();
      state.routePath = alt.primary.path;
      routeLayer.showRoute(alt.primary.path, ROUTE_COLOR, { pulse: true, radius: PRIMARY_ROUTE_RADIUS });
      if (alt.alternative !== null) {
        routeLayer.showRoute(alt.alternative.path, ALT_ROUTE_COLOR, { radius: ALT_ROUTE_RADIUS });
        routeLayer.applyRouteEmphasis([alt.primary.path, alt.alternative.path]);
      } else {
        routeLayer.applyRouteEmphasis([alt.primary.path]);
      }
      labelsDirty = true;
    }
    renderAlternative(ui.panels.alternative, alt);
    mirrorToGuest(ui.panels.alternative);
  };

  // ── RESET ─────────────────────────────────────────────────────────────────
  const doReset = (): void => {
    state.blocks = [];
    state.routePath = null;
    stopReplay();
    hud.setState('hidden');
    hud.setCaption('');
    routeLayer.clearAll();
    clearAllPanels();
    renderGuestSummaryNow();
    updateBlockStatus();
    labelsDirty = true;
  };

  // ── blocked-path simulation ───────────────────────────────────────────────
  const rerunWithBlocks = (): void => {
    if (state.from === null || state.to === null || state.from === state.to) return;
    updateBlockStatus();
    if (state.blocks.length === 0) {
      clearPanel(ui.panels.block);
      doFindRoute();
      return;
    }
    const sim = simulateBlockedRoute(graph, state.from, state.to, state.blocks, 'dijkstra');
    routeLayer.clearRoutes();
    routeLayer.resetHighlights();
    stopReplay();
    replayAlgo = 'dijkstra';
    lastResult = sim.after;
    replayer = new TraceReplayer(sim.after.trace, {
      onEvent: (ev, i, n) => {
        routeLayer.applyTraceEvent(ev);
        timeline.setProgress(i + 1, n);
        hud.setEvent(i + 1, n);
        hud.setCaption(narrateEvent(ev, nameOf, 'dijkstra'));
        if (mode === 'engineer') {
          const desc = describeTraceEvent(ev, nameOf, 'm');
          setReplayReadout('Re-route (Dijkstra)', `Step ${i + 1} of ${n}`, technicalEventKind(ev), desc.detail, desc.sub ?? null);
        }
      },
      onDone: () => {
        setReplayPlayingUi(false);
        completeReplay(sim.after, true);
        renderBlockReport(ui.panels.block, sim.before, sim.after, state.blocks.length);
        updateBlockStatus(sim);
      },
    });
    replayer.setSpeed(BASE_EVENTS_PER_SEC);
    replayer.play();
    timeline.buildMarkers(sim.after.trace);
    timeline.setEnabled(true);
    setReplayPlayingUi(true);
  };

  /** Block tool status chip: neutral when clear, amber/red only when blocked. */
  const updateBlockStatus = (sim?: ReturnType<typeof simulateBlockedRoute>): void => {
    const n = state.blocks.length;
    const chip = ui.blockChip;
    chip.classList.remove('block-status-idle', 'block-status-detour', 'block-status-none');
    if (n === 0) {
      chip.classList.add('block-status-idle');
      chip.textContent = 'No closures';
      return;
    }
    if (sim !== undefined) {
      if (sim.after.status === 'unreachable') {
        chip.classList.add('block-status-none');
        chip.textContent = 'PATH CLOSED · no route remains';
      } else if (sim.before.status === 'ok') {
        const delta = sim.after.totalDistance - sim.before.totalDistance;
        if (delta > 0.5) {
          chip.classList.add('block-status-detour');
          const dt = estimateWalkTime(sim.after.totalDistance).estimatedSeconds - estimateWalkTime(sim.before.totalDistance).estimatedSeconds;
          chip.textContent = `PATH CLOSED · Detour +${fmtDistance(delta)} · +${fmtTime(dt)}`;
        } else {
          chip.classList.add('block-status-idle');
          chip.textContent = 'PATH CLOSED · no impact on route';
        }
      }
    } else {
      chip.classList.add('block-status-detour');
      chip.textContent = n === 1 ? 'PATH CLOSED · 1 walkway' : `PATH CLOSED · ${n} walkways`;
    }
  };

  // ── raycast click (block tool + click-to-focus) ──────────────────────────
  scene.renderer.domElement.addEventListener('pointerdown', (e: PointerEvent) => {
    downAt = { x: e.clientX, y: e.clientY };
  });
  scene.renderer.domElement.addEventListener('pointerup', (e: PointerEvent) => {
    if (downAt === null) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > 6) return; // orbit drag, not a click
    const hit = pickObject(e.clientX, e.clientY);
    if (hit === null) return;

    if (state.blockActive) {
      if (hit.userData.edgeId === undefined) return;
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
    } else if (hit.userData.edgeId === undefined) {
      const vertexId = hit.userData.vertexId as string | undefined;
      if (vertexId !== undefined) scene.focusOn(meshes.worldPos(vertexId));
    }
  });

  // ── cinematic route intro (skipped under prefers-reduced-motion) ─────────
  const cinematicIntro = (r: RouteResult): void => {
    if (r.status !== 'ok' || REDUCED_MOTION) return;
    const pts = r.path.map((id) => meshes.worldPos(id));
    if (pts.length < 2) return;
    scene.flyAlong(pts, { duration: Math.min(8, 3.5 + (r.path.length - 1) * 0.35) });
  };

  // ── Guest summary strip ───────────────────────────────────────────────────
  const renderGuestSummaryNow = (sim?: ReturnType<typeof simulateBlockedRoute>): void => {
    ui.guestSummary.classList.remove('guest-output');
    let result: RouteResult | null = lastResult;
    if (sim !== undefined) result = sim.after;
    if (result === null) {
      ui.guestSummary.hidden = true;
      return;
    }
    const isBfs = (sim !== undefined ? 'dijkstra' : state.algo) === 'bfs';
    const bfsLen = isBfs && result.status === 'ok' ? pathLengthMeters(result.path, weightOf) : null;
    renderGuestSummary(ui.guestSummary, result, ALGO_LABEL[sim !== undefined ? 'dijkstra' : state.algo], bfsLen);
  };

  /**
   * Guest mode: the compare / alternative cards live in the (hidden)
   * engineer stack — mirror a copy of their output into the guest card so
   * the result is visible in both modes.
   */
  const mirrorToGuest = (panel: HTMLElement): void => {
    if (mode !== 'guest') return;
    const box = ui.guestSummary;
    box.hidden = false;
    box.classList.remove('attention');
    box.classList.add('guest-output');
    box.innerHTML = '';
    for (const child of Array.from(panel.children)) box.appendChild(child.cloneNode(true));
  };

  let flashTimer = 0;
  const flashGuestCard = (): void => {
    // Visible, gentle hint in the guest strip (no dev terminology).
    const box = ui.guestSummary;
    box.hidden = false;
    box.classList.remove('guest-output');
    box.classList.add('attention');
    box.innerHTML = '';
    const hint = document.createElement('div');
    hint.className = 'gs-hint';
    hint.textContent = 'Choose a start and a destination, then press Find Route.';
    box.appendChild(hint);
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => {
      box.classList.remove('attention');
      if (lastResult === null) box.hidden = true;
    }, 2600);
  };

  // ── mode switch (one scene, one state — chrome only) ────────────────────
  let mode: AppMode = 'guest';

  const applyMode = (m: AppMode): void => {
    mode = m;
    appRoot.setAttribute('data-mode', m);
    ui.modeToggle.setMode(m);
    const guest = m === 'guest';
    // Re-parent shared controls between dock (Guest) and sidebar (Engineer).
    if (guest) {
      ui.dock.timelineSlot.appendChild(timeline.root);
      ui.slots.dockRow.append(ui.btnBlock, ui.blockChip, ui.btnCompare, ui.btnAlternative);
    } else {
      ui.replay.timelineSlot.appendChild(timeline.root);
      ui.slots.compareAltRow.append(ui.btnCompare, ui.btnAlternative);
      ui.slots.blockRow.append(ui.btnBlock, ui.blockChip);
    }
    // Graph overlay: nodes + edge weights are engineer-only.
    meshes.setGraphVisible(!guest);
    timeline.setShowEventCount(!guest);
    if (guest) ui.guestSummary.hidden = lastResult === null;
  };

  ui.modeToggle.root.querySelectorAll<HTMLButtonElement>('.mode-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const m = b.textContent === 'Engineer' ? 'engineer' : 'guest';
      if (m !== mode) applyMode(m);
    });
  });

  // ── canvas toolbar ────────────────────────────────────────────────────────
  const toolbar = ui.toolbar;
  const syncLabelsUi = (on: boolean): void => {
    toolbar.btnLabels.setAttribute('aria-pressed', String(on));
    ui.labelsToggle.checked = on;
  };
  toolbar.btnLabels.setAttribute('aria-pressed', 'true');
  toolbar.btnLabels.addEventListener('click', () => {
    const next = !meshes.labelsVisible();
    meshes.setLabelsVisible(next);
    syncLabelsUi(next);
    labelsDirty = true;
  });
  toolbar.btnCamera.addEventListener('click', () => scene.frameAll(meshes.contentBox, true));
  ui.btnCamera.addEventListener('click', () => scene.frameAll(meshes.contentBox, true));

  let timeOfDay: TimeOfDay = 'day';
  toolbar.btnDayNight.addEventListener('click', () => {
    timeOfDay = timeOfDay === 'day' ? 'night' : 'day';
    scene.setTimeOfDay(timeOfDay);
    const toNight = timeOfDay === 'night';
    toolbar.btnDayNight.innerHTML = '';
    toolbar.btnDayNight.appendChild(icon(toNight ? 'sun' : 'moon'));
    toolbar.btnDayNight.title = toNight ? 'Switch to day view' : 'Switch to night view';
    toolbar.btnDayNight.setAttribute('aria-label', toNight ? 'Switch to day view' : 'Switch to night view');
    toolbar.btnDayNight.setAttribute('aria-pressed', String(toNight));
  });

  let quality: RenderQuality = 'high';
  toolbar.btnQuality.addEventListener('click', () => {
    quality = quality === 'high' ? 'low' : 'high';
    scene.setQuality(quality);
    toolbar.btnQuality.setAttribute('aria-pressed', String(quality === 'low'));
    toolbar.btnQuality.title = quality === 'low' ? 'Switch to high render quality' : 'Switch to low render quality (performance)';
  });

  const toggleFullscreen = async (): Promise<void> => {
    try {
      if (document.fullscreenElement === null) await appRoot.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      /* sandboxed iframes may disallow fullscreen — non-fatal */
    }
  };
  toolbar.btnFullscreen.addEventListener('click', toggleFullscreen);

  // ── block tool (button, not a hidden toggle) ─────────────────────────────
  const syncBlockUi = (): void => {
    ui.btnBlock.classList.toggle('active', state.blockActive);
    ui.btnBlock.setAttribute('aria-pressed', String(state.blockActive));
  };
  ui.btnBlock.addEventListener('click', () => {
    state.blockActive = !state.blockActive;
    syncBlockUi();
    updateBlockStatus();
    hoverDirty = true;
  });
  scene.renderer.domElement.style.cursor = 'grab';

  // ── labels toggle (engineer sidebar) ─────────────────────────────────────
  ui.labelsToggle.addEventListener('change', () => {
    meshes.setLabelsVisible(ui.labelsToggle.checked);
    syncLabelsUi(ui.labelsToggle.checked);
    labelsDirty = true;
  });

  // ── algorithm select (engineer) ──────────────────────────────────────────
  const updateAlgoNotes = (): void => {
    for (const note of ui.algoNotes.querySelectorAll<HTMLElement>('.algo-note')) {
      note.classList.toggle('active', note.dataset.algo === state.algo);
    }
  };
  ui.algorithm.addEventListener('change', () => {
    state.algo = ui.algorithm.value as AlgorithmId;
    updateAlgoNotes();
  });

  // ── shared action buttons ────────────────────────────────────────────────
  ui.btnFindRoute.addEventListener('click', doFindRoute);
  ui.btnCompare.addEventListener('click', doCompare);
  ui.btnAlternative.addEventListener('click', doAlternative);
  ui.btnReset.addEventListener('click', doReset);
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

  // Demo (Engineer only, hidden in Guest): sets UI inputs only, then runs
  // the real algorithm via doFindRoute — no bypass.
  ui.btnDemo.addEventListener('click', () => {
    state.from = 'pav-germany';
    state.to = 'pav-morocco';
    state.algo = 'dijkstra';
    ui.fromSelect.set('pav-germany');
    ui.toSelect.set('pav-morocco');
    ui.algorithm.value = 'dijkstra';
    updateAlgoNotes();
    routeLayer.setStart('pav-germany');
    routeLayer.setTarget('pav-morocco');
    labelsDirty = true;
    doFindRoute();
  });

  // provenance info
  const openInfoPanel = (): void => {
    renderProvenanceInfo(ui.infoPanel.querySelector('.prov-info-body') ?? ui.infoPanel);
    ui.infoPanel.hidden = false;
  };
  ui.infoButton.addEventListener('click', openInfoPanel);

  // ── sensible defaults (Main Entrance → France) ────────────────────────────
  ui.fromSelect.set('gate-main');
  ui.toSelect.set('pav-france');
  state.from = 'gate-main';
  state.to = 'pav-france';
  routeLayer.setStart('gate-main');
  routeLayer.setTarget('pav-france');
  updateAlgoNotes();
  labelsDirty = true;

  applyMode('guest'); // default mode (re-parents shared controls to the dock)

  // ── boot: mark the graph ready, then fade in ─────────────────────────────
  bootStep('locations', 'ok');
  bootStep('graph', 'active');
  await nextFrame();
  finishBoot();

  // ── first-run tour (never forced after dismissal) ─────────────────────────
  const tour = buildTour([
    {
      target: '.search[data-which="from"]',
      title: 'Choose your start',
      text: 'Search for where you want to begin — a pavilion, a gate or a landmark.',
    },
    {
      target: '.search[data-which="to"]',
      title: 'Choose your destination',
      text: 'Search for where you want to go. You can swap them with one tap.',
    },
    {
      target: '.btn-find-route',
      title: 'Find your route',
      text: 'Find the best route using a graph algorithm — Dijkstra, A* or BFS.',
    },
    {
      target: '.timeline',
      title: 'Watch it explore',
      text: 'The route replay starts automatically. Scrub the timeline or pause it any time.',
    },
    {
      target: '.mode-toggle',
      title: 'Engineer mode',
      text: 'Switch to Engineer mode to inspect the graph, algorithm metrics, traces and provenance.',
    },
  ]);
  appRoot.appendChild(tour.root);
  if (!hasCompletedTour()) {
    // Start after the boot fade so the tour targets are already laid out.
    window.setTimeout(() => tour.start(), REDUCED_MOTION ? 100 : 700);
  }
}

void main();
