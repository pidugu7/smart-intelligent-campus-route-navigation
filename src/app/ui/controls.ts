/**
 * app/ui/controls.ts
 *
 * Builds ALL interactive chrome, once, for BOTH modes (same scene, same
 * state — never duplicated applications):
 *
 *   - mode toggle: GUEST / ENGINEER (Guest is the default)
 *   - route card: From / To / swap / Find Route (+ algorithm & demo in
 *     Engineer mode only)
 *   - Guest: a compact floating card + bottom dock (Block Path, Compare,
 *     Alternative, replay timeline) + on-map HUD
 *   - Engineer: the full sidebar (dataset, results, advanced block/view/
 *     replay, algorithm notes, provenance)
 *   - canvas toolbar (both modes): labels, reset camera, day/night,
 *     quality, fullscreen — icon buttons with labels + tooltips
 *   - provenance badge + info panel (both modes)
 *
 * Shared elements (compare / alternative / block / timeline) are built
 * once and re-parented between the dock (Guest) and the sidebar
 * (Engineer) on mode switch.
 *
 * Pure DOM construction + references — all behaviour is wired in main.ts.
 */

import { createSearchSelect, type SearchItem, type SearchSelect } from './search';
import { icon, type IconName } from './icons';

export type AppMode = 'guest' | 'engineer';

export interface AppControls {
  root: HTMLElement; // the sidebar / guest-card container
  // route form (both modes)
  fromSelect: SearchSelect;
  toSelect: SearchSelect;
  btnSwap: HTMLButtonElement;
  algorithm: HTMLSelectElement;
  btnFindRoute: HTMLButtonElement;
  btnDemo: HTMLButtonElement;
  // shared actions (re-parented per mode)
  btnCompare: HTMLButtonElement;
  btnAlternative: HTMLButtonElement;
  btnReset: HTMLButtonElement;
  btnBlock: HTMLButtonElement;
  blockChip: HTMLElement;
  // engineer-only
  labelsToggle: HTMLInputElement;
  btnCamera: HTMLButtonElement;
  btnProvenance: HTMLButtonElement;
  replay: { readout: HTMLElement; timelineSlot: HTMLElement };
  algoNotes: HTMLElement;
  panels: {
    route: HTMLElement;
    compare: HTMLElement;
    alternative: HTMLElement;
    block: HTMLElement;
  };
  datasetStats: HTMLElement;
  // guest
  guestSummary: HTMLElement;
  /** Re-parent slots for shared controls (dock vs sidebar) on mode switch. */
  slots: {
    dockRow: HTMLElement;
    compareAltRow: HTMLElement;
    blockRow: HTMLElement;
  };
  // phase 6 chrome
  modeToggle: { root: HTMLElement; setMode(mode: AppMode): void };
  toolbar: {
    root: HTMLElement;
    btnLabels: HTMLButtonElement;
    btnCamera: HTMLButtonElement;
    btnDayNight: HTMLButtonElement;
    btnQuality: HTMLButtonElement;
    btnFullscreen: HTMLButtonElement;
  };
  dock: { root: HTMLElement; timelineSlot: HTMLElement };
  hudSlot: HTMLElement;
  badge: HTMLElement;
  infoButton: HTMLButtonElement;
  infoPanel: HTMLElement;
}

const ALGORITHMS: Array<[string, string]> = [
  ['dijkstra', 'Dijkstra'],
  ['astar', 'A* (Euclidean)'],
  ['bfs', 'BFS (fewest hops)'],
];

const ALGO_NOTES: Array<{ id: string; title: string; lines: string[] }> = [
  {
    id: 'dijkstra',
    title: 'Dijkstra',
    lines: [
      'Weighted shortest path with a min-priority queue: repeatedly extract the closest unsettled node and relax its outgoing edges. Optimal for non-negative weights.',
    ],
  },
  {
    id: 'astar',
    title: 'A*',
    lines: [
      'Same graph and weights as Dijkstra, but the queue is ordered by f = g + h, where h is the straight-line distance to the destination. Often expands fewer nodes — not guaranteed on every graph.',
    ],
  },
  {
    id: 'bfs',
    title: 'BFS',
    lines: ['Fewest-hop traversal with a FIFO queue, level by level. Its cost is edge count, not distance.'],
  },
  {
    id: 'dfs',
    title: 'DFS',
    lines: ['Depth-first traversal with an explicit stack. A traversal technique, not a shortest-path algorithm.'],
  },
];

function iconBtn(name: IconName, label: string, cls = 'tool-btn'): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.type = 'button';
  b.appendChild(icon(name));
  return b;
}

export function buildControls(
  container: HTMLElement,
  opts: { items: SearchItem[]; vertexCount: number; edgeCount: number; onPick: (which: 'from' | 'to', id: string) => void },
): AppControls {
  // ══ Sidebar / guest card (one container, two looks) ═════════════════════
  const root = document.createElement('aside');
  root.className = 'sidebar';

  // ── mode toggle ─────────────────────────────────────────────────────────
  const modeToggle = document.createElement('div');
  modeToggle.className = 'mode-toggle';
  modeToggle.setAttribute('role', 'group');
  modeToggle.setAttribute('aria-label', 'Interface mode');
  const modeBtns = new Map<AppMode, HTMLButtonElement>();
  for (const m of ['guest', 'engineer'] as const) {
    const b = document.createElement('button');
    b.className = 'mode-btn';
    b.type = 'button';
    b.textContent = m === 'guest' ? 'Guest' : 'Engineer';
    b.title = m === 'guest' ? 'Clean map view — routes and navigation' : 'Full technical view — graph, algorithms, traces';
    b.setAttribute('aria-pressed', 'false');
    modeBtns.set(m, b);
    modeToggle.appendChild(b);
  }
  const setModePressed = (mode: AppMode): void => {
    for (const [m, b] of modeBtns) b.setAttribute('aria-pressed', String(m === mode));
  };
  root.appendChild(modeToggle);

  // ── route card (both modes) ─────────────────────────────────────────────
  const routeCard = document.createElement('section');
  routeCard.className = 'route-card';

  routeCard.appendChild(tag('From'));
  const fromSelect = createSearchSelect(opts.items, 'Search start location…', (id) => opts.onPick('from', id));
  fromSelect.el.dataset.which = 'from'; // tour target hook
  routeCard.appendChild(fromSelect.el);

  const swapRow = document.createElement('div');
  swapRow.className = 'swap-row';
  const btnSwap = iconBtn('swap', 'Swap start and destination', 'btn btn-ghost btn-swap');
  swapRow.appendChild(btnSwap);
  routeCard.appendChild(swapRow);

  routeCard.appendChild(tag('To'));
  const toSelect = createSearchSelect(opts.items, 'Search destination…', (id) => opts.onPick('to', id));
  toSelect.el.dataset.which = 'to'; // tour target hook
  routeCard.appendChild(toSelect.el);

  const algorithm = document.createElement('select');
  algorithm.className = 'select algo-select'; // hidden in Guest mode by CSS
  for (const [value, label] of ALGORITHMS) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    algorithm.appendChild(o);
  }
  const algoTagRow = document.createElement('div');
  algoTagRow.className = 'algo-row';
  algoTagRow.appendChild(tag('Algorithm'));
  algoTagRow.appendChild(algorithm);
  routeCard.appendChild(algoTagRow);

  const btnFindRoute = document.createElement('button');
  btnFindRoute.className = 'btn btn-primary btn-block btn-find-route';
  btnFindRoute.type = 'button';
  btnFindRoute.appendChild(icon('route', 16));
  btnFindRoute.appendChild(document.createTextNode('Find Route'));
  routeCard.appendChild(btnFindRoute);

  const btnDemo = document.createElement('button');
  btnDemo.className = 'btn btn-secondary btn-block btn-demo';
  btnDemo.type = 'button';
  btnDemo.title = 'Loads the predefined showcase query: Germany → Morocco with Dijkstra';
  btnDemo.textContent = 'Demo: Germany → Morocco';
  routeCard.appendChild(btnDemo);

  root.appendChild(routeCard);

  // ── guest summary strip (Guest mode only, filled by main.ts) ────────────
  const guestSummary = document.createElement('div');
  guestSummary.className = 'guest-summary';
  guestSummary.hidden = true;
  root.appendChild(guestSummary);

  // ── engineer-only stack ─────────────────────────────────────────────────
  const engineer = document.createElement('div');
  engineer.className = 'engineer-only';

  // 1 · Dataset
  const datasetCard = collapsible('Dataset', true);
  const prov = document.createElement('dl');
  prov.className = 'dataset-prov';
  const provLine = (k: string, v: string): void => {
    const div = document.createElement('div');
    div.className = 'prov-line';
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    div.append(dt, dd);
    prov.appendChild(div);
  };
  provLine('Data source', 'Public 2026 EPCOT map');
  provLine('Confidence', 'Approximate digitized geometry');
  datasetCard.body.appendChild(prov);
  const datasetStats = document.createElement('div');
  datasetStats.className = 'dataset-stats';
  datasetStats.textContent = `${opts.vertexCount} locations · ${opts.edgeCount} connections · distances in metres`;
  datasetCard.body.appendChild(datasetStats);
  engineer.appendChild(datasetCard.card);

  // 2 · Results
  const resultsCard = collapsible('Result', true);
  const results = document.createElement('section');
  results.className = 'results-stack';
  const mkPanel = (cls: string): HTMLElement => {
    const p = document.createElement('div');
    p.className = `result-slot ${cls}`;
    return p;
  };
  const panels = {
    route: mkPanel('route'),
    compare: mkPanel('compare'),
    alternative: mkPanel('alternative'),
    block: mkPanel('block'),
  };
  for (const p of Object.values(panels)) results.appendChild(p);
  resultsCard.body.appendChild(results);

  const row2 = document.createElement('div');
  row2.className = 'btn-row';
  const btnCompare = document.createElement('button');
  btnCompare.className = 'btn btn-secondary';
  btnCompare.type = 'button';
  btnCompare.textContent = 'Compare Algorithms';
  const btnAlternative = document.createElement('button');
  btnAlternative.className = 'btn btn-secondary';
  btnAlternative.type = 'button';
  btnAlternative.textContent = 'Find Alternative';
  row2.append(btnCompare, btnAlternative);
  const btnReset = document.createElement('button');
  btnReset.className = 'btn btn-ghost btn-block';
  btnReset.type = 'button';
  btnReset.textContent = 'Reset';
  resultsCard.body.append(row2, btnReset);
  engineer.appendChild(resultsCard.card);

  // 3 · Advanced (block / view / replay)
  const advCard = collapsible('Advanced', false);
  const advBody = advCard.body;

  const blockGroup = document.createElement('div');
  blockGroup.className = 'adv-group';
  blockGroup.appendChild(groupTag('Block path'));
  const blockBtnRow = document.createElement('div');
  blockBtnRow.className = 'block-btn-row';
  const btnBlock = document.createElement('button');
  btnBlock.className = 'btn btn-secondary btn-block-tool';
  btnBlock.type = 'button';
  btnBlock.appendChild(icon('block', 16));
  btnBlock.appendChild(document.createTextNode('Block Path'));
  blockBtnRow.appendChild(btnBlock);
  const blockChip = document.createElement('span');
  blockChip.className = 'block-status block-status-idle';
  blockChip.textContent = 'No closures';
  blockBtnRow.appendChild(blockChip);
  blockGroup.appendChild(blockBtnRow);
  const blockHint = document.createElement('div');
  blockHint.className = 'hint';
  blockHint.textContent =
    'Activate, then click a walkway in the 3D scene to close it (click a closed one to reopen). Routing re-runs automatically on a cloned graph — the original graph is never mutated.';
  blockGroup.appendChild(blockHint);
  advBody.appendChild(blockGroup);

  // View
  const viewGroup = document.createElement('div');
  viewGroup.className = 'adv-group';
  viewGroup.appendChild(groupTag('View'));
  const labelRow = document.createElement('label');
  labelRow.className = 'toggle-row';
  const labelsToggle = document.createElement('input');
  labelsToggle.type = 'checkbox';
  labelsToggle.checked = true;
  labelRow.appendChild(labelsToggle);
  const labelSwitch = document.createElement('span');
  labelSwitch.className = 'toggle';
  labelRow.appendChild(labelSwitch);
  labelRow.appendChild(document.createTextNode('Location labels'));
  const btnCamera = document.createElement('button');
  btnCamera.className = 'btn btn-ghost btn-block';
  btnCamera.type = 'button';
  btnCamera.textContent = 'Reset camera';
  const viewHint = document.createElement('div');
  viewHint.className = 'hint';
  viewHint.textContent = 'Labels appear in stages as you zoom in (far → major only · close → all). Drag to orbit · scroll to zoom · right-drag to pan.';
  viewGroup.append(labelRow, btnCamera, viewHint);
  advBody.appendChild(viewGroup);

  // Replay (timeline lives here in Engineer mode)
  const replayGroup = document.createElement('div');
  replayGroup.className = 'adv-group';
  replayGroup.appendChild(groupTag('Replay'));
  const readout = document.createElement('div');
  readout.className = 'replay-readout';
  readout.hidden = true;
  const replayHint = document.createElement('div');
  replayHint.className = 'hint';
  replayHint.textContent =
    'Replays the engine’s TraceEvent log (start → visit → relax → finalize) on the 3D scene. The algorithm itself already ran to completion.';
  replayGroup.append(readout, replayHint);
  advBody.appendChild(replayGroup);
  engineer.appendChild(advCard.card);

  // 4 · Algorithm notes
  const algoCard = collapsible('Algorithm notes', false);
  const algoNotes = document.createElement('div');
  algoNotes.className = 'algo-notes';
  for (const n of ALGO_NOTES) {
    const note = document.createElement('div');
    note.className = 'algo-note';
    note.dataset.algo = n.id;
    const title = document.createElement('div');
    title.className = 'algo-note-title';
    title.textContent = n.title;
    note.appendChild(title);
    for (const line of n.lines) {
      const li = document.createElement('div');
      li.className = 'algo-note-line';
      li.textContent = line;
      note.appendChild(li);
    }
    algoNotes.appendChild(note);
  }
  algoCard.body.appendChild(algoNotes);
  engineer.appendChild(algoCard.card);

  // Provenance
  const btnProvenance = document.createElement('button');
  btnProvenance.className = 'btn btn-ghost btn-block btn-provenance';
  btnProvenance.type = 'button';
  btnProvenance.appendChild(icon('info', 15));
  btnProvenance.appendChild(document.createTextNode('Data provenance'));
  engineer.appendChild(btnProvenance);

  root.appendChild(engineer);
  container.appendChild(root);

  // ══ Canvas toolbar (both modes, on the map) ═════════════════════════════
  const toolbar = document.createElement('div');
  toolbar.className = 'canvas-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Map tools');
  const btnLabelsT = iconBtn('labels', 'Toggle location labels', 'tool-btn');
  const btnCameraT = iconBtn('camera-reset', 'Reset camera', 'tool-btn');
  const btnDayNight = iconBtn('moon', 'Switch to night view', 'tool-btn');
  const btnQuality = iconBtn('quality', 'Toggle render quality', 'tool-btn');
  const btnFullscreen = iconBtn('fullscreen', 'Toggle fullscreen', 'tool-btn');
  toolbar.append(btnLabelsT, btnCameraT, btnDayNight, btnQuality, btnFullscreen);
  container.appendChild(toolbar);

  // ══ Bottom dock (Guest mode) ════════════════════════════════════════════
  const dock = document.createElement('div');
  dock.className = 'dock';
  const dockRow = document.createElement('div');
  dockRow.className = 'dock-row';
  // (btnBlock / btnCompare / btnAlternative / blockChip are re-parented here in Guest)
  dockRow.append(btnBlock, blockChip, btnCompare, btnAlternative);
  const timelineSlot = document.createElement('div');
  timelineSlot.className = 'dock-timeline';
  dock.append(dockRow, timelineSlot);
  container.appendChild(dock);

  // ══ HUD slot (both modes, bottom-left of the map) ═══════════════════════
  const hudSlot = document.createElement('div');
  hudSlot.className = 'hud-slot';
  container.appendChild(hudSlot);

  // ══ Provenance badge (kept, small, bottom-left) ═════════════════════════
  const badge = document.createElement('div');
  badge.className = 'prov-badge';
  badge.title = 'Digitized from a public 2026 EPCOT map — approximate geometry (full details in Data provenance)';
  badge.appendChild(document.createTextNode('Digitized from a public 2026 EPCOT map'));
  const infoButton = iconBtn('info', 'Data provenance', 'prov-info-btn');
  badge.appendChild(infoButton);
  container.appendChild(badge);

  const infoPanel = document.createElement('div');
  infoPanel.className = 'prov-info-panel';
  infoPanel.hidden = true;
  const infoClose = document.createElement('button');
  infoClose.className = 'btn btn-ghost btn-block';
  infoClose.type = 'button';
  infoClose.textContent = 'Close';
  infoPanel.appendChild(infoClose);
  const infoBody = document.createElement('div');
  infoBody.className = 'prov-info-body';
  infoPanel.appendChild(infoBody);
  container.appendChild(infoPanel);
  const closeInfo = (): void => {
    infoPanel.hidden = true;
  };
  infoClose.addEventListener('click', closeInfo);
  btnProvenance.addEventListener('click', () => {
    infoPanel.hidden = !infoPanel.hidden;
  });
  infoButton.addEventListener('click', () => {
    infoPanel.hidden = false;
  });

  return {
    root,
    fromSelect,
    toSelect,
    btnSwap,
    algorithm,
    btnFindRoute,
    btnDemo,
    btnCompare,
    btnAlternative,
    btnReset,
    btnBlock,
    blockChip,
    labelsToggle,
    btnCamera,
    btnProvenance,
    replay: {
      readout,
      timelineSlot: (() => {
        // The Engineer sidebar hosts the timeline inside the replay group.
        const slot = document.createElement('div');
        slot.className = 'replay-timeline-slot';
        replayGroup.insertBefore(slot, replayHint);
        return slot;
      })(),
    },
    algoNotes,
    panels,
    datasetStats,
    guestSummary,
    slots: {
      dockRow,
      compareAltRow: row2,
      blockRow: blockBtnRow,
    },
    modeToggle: {
      root: modeToggle,
      setMode: setModePressed,
    },
    toolbar: {
      root: toolbar,
      btnLabels: btnLabelsT,
      btnCamera: btnCameraT,
      btnDayNight,
      btnQuality,
      btnFullscreen,
    },
    dock: {
      root: dock,
      timelineSlot,
    },
    hudSlot,
    badge,
    infoButton,
    infoPanel,
  };
}

// Collapsible section helper: .panel-card > .panel-head (button) + .panel-body
function collapsible(title: string, open: boolean): { card: HTMLElement; body: HTMLElement } {
  const card = document.createElement('section');
  card.className = 'panel-card collapsible';
  const head = document.createElement('button');
  head.className = 'panel-head';
  head.type = 'button';
  head.setAttribute('aria-expanded', String(open));
  const titleEl = document.createElement('span');
  titleEl.className = 'panel-title';
  titleEl.textContent = title;
  const chevron = document.createElement('span');
  chevron.className = 'chevron';
  chevron.textContent = '▾';
  head.append(titleEl, chevron);
  const body = document.createElement('div');
  body.className = 'panel-body';
  if (!open) card.classList.add('collapsed');
  head.addEventListener('click', () => {
    const collapsed = card.classList.toggle('collapsed');
    head.setAttribute('aria-expanded', String(!collapsed));
  });
  card.append(head, body);
  return { card, body };
}

function tag(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'field-tag';
  d.textContent = text;
  return d;
}

function groupTag(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'group-tag';
  d.textContent = text;
  return d;
}
