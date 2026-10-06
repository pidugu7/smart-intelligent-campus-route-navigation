/**
 * app/ui/controls.ts
 *
 * Builds the navigation control panel (sidebar) and the on-viewport
 * provenance badge / info panel. Pure DOM construction + references —
 * all behaviour (engine calls, scene updates) is wired in app/main.ts.
 *
 * Sidebar order (spec): DATASET → FROM/TO/ALGORITHM → FIND ROUTE →
 * RESULT → advanced collapsibles (BLOCK PATH, VIEW, REPLAY) →
 * ALGORITHM NOTES → PROVENANCE.
 */

import { createSearchSelect, type SearchItem, type SearchSelect } from './search';

export interface AppControls {
  root: HTMLElement;
  fromSelect: SearchSelect;
  toSelect: SearchSelect;
  btnSwap: HTMLButtonElement;
  algorithm: HTMLSelectElement;
  btnFindRoute: HTMLButtonElement;
  btnCompare: HTMLButtonElement;
  btnAlternative: HTMLButtonElement;
  btnReset: HTMLButtonElement;
  blockMode: HTMLInputElement;
  blockChip: HTMLElement;
  labelsToggle: HTMLInputElement;
  btnCamera: HTMLButtonElement;
  btnProvenance: HTMLButtonElement;
  replay: {
    bar: HTMLElement;
    btnPlay: HTMLButtonElement;
    btnPause: HTMLButtonElement;
    btnReplayReset: HTMLButtonElement;
    speed: HTMLInputElement;
    progress: HTMLSpanElement;
    readout: HTMLElement;
  };
  algoNotes: HTMLElement;
  panels: {
    route: HTMLElement;
    compare: HTMLElement;
    alternative: HTMLElement;
    block: HTMLElement;
  };
  datasetStats: HTMLElement;
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
    title: 'Dijkstra — weighted shortest path',
    lines: [
      'Maintains the best-known distance to every node and a min-priority queue.',
      'Repeatedly extracts the closest unsettled node (extract-min) and relaxes each outgoing edge: if going through it improves the neighbour’s distance, update it.',
      'With non-negative weights the result is the provably optimal path. Explores roughly evenly in all directions.',
    ],
  },
  {
    id: 'astar',
    title: 'A* — weighted shortest path with a heuristic',
    lines: [
      'Orders the queue by f = g + h: g is the cost so far, h is the straight-line (Euclidean) distance from the node to the destination.',
      'Same graph, same weights, same optimal guarantee as Dijkstra — the heuristic only changes which node is examined next.',
      'When the heuristic guides well, it often reaches the destination before exploring the whole graph; on some graphs/queries the saving is small (or none), which the comparison panel shows honestly.',
    ],
  },
  {
    id: 'bfs',
    title: 'BFS — fewest hops, unweighted',
    lines: [
      'Traverses the graph level by level with a FIFO queue: everything 1 hop away, then 2, then 3…',
      'Guarantees the fewest number of edges (hops) between two nodes — it completely ignores edge distances, so its “cost” is hop count, not metres.',
      'Useful as a baseline: on this network it returns a different, usually longer, route than Dijkstra.',
    ],
  },
  {
    id: 'dfs',
    title: 'DFS — graph traversal demo (not for routing)',
    lines: [
      'Uses an explicit stack: push a node’s unvisited neighbours, pop the top, repeat.',
      'It is a traversal technique, not a shortest-path algorithm — its visit order is deep and arbitrary, and the path it finds is not shortest.',
      'Included to contrast a pure traversal (DFS) with searches that actually optimise (Dijkstra, A*, BFS).',
    ],
  },
];

export function buildControls(
  container: HTMLElement,
  opts: { items: SearchItem[]; vertexCount: number; edgeCount: number; onPick: (which: 'from' | 'to', id: string) => void },
): AppControls {
  const root = document.createElement('aside');
  root.className = 'sidebar';

  // ── Header ────────────────────────────────────────────────────────────
  const header = document.createElement('header');
  header.className = 'side-header';
  header.innerHTML = `
    <div class="brand">
      <span class="brand-mark">▣</span>
      <div>
        <div class="brand-title">Campus Route Navigation</div>
        <div class="brand-sub">DSA engine · Dijkstra · A* · BFS · DFS</div>
      </div>
    </div>`;
  root.appendChild(header);

  // ── 1 · Dataset ───────────────────────────────────────────────────────
  const datasetCard = collapsible('DATASET', true);
  const datasetStats = document.createElement('div');
  datasetStats.className = 'dataset-stats';
  datasetStats.textContent = `EPCOT · Walt Disney World — ${opts.vertexCount} locations · ${opts.edgeCount} walkable connections`;
  const datasetSub = document.createElement('div');
  datasetSub.className = 'dataset-sub';
  datasetSub.textContent = 'Digitized approximate geometry — all distances are in metres.';
  datasetCard.body.append(datasetStats, datasetSub);
  root.appendChild(datasetCard.card);

  // ── 2 · Route form: From / To / Algorithm / FIND ROUTE ────────────────
  const formCard = collapsible('ROUTE', true);
  const form = document.createElement('section');
  form.className = 'form-body';
  form.appendChild(tag('From'));
  const fromSelect = createSearchSelect(opts.items, 'Search start location…', (id) => opts.onPick('from', id));
  form.appendChild(fromSelect.el);
  const swapRow = document.createElement('div');
  swapRow.className = 'swap-row';
  const btnSwap = document.createElement('button');
  btnSwap.className = 'btn btn-ghost btn-swap';
  btnSwap.title = 'Swap start and destination';
  btnSwap.textContent = '⇅ swap';
  swapRow.appendChild(btnSwap);
  form.appendChild(swapRow);
  form.appendChild(tag('To'));
  const toSelect = createSearchSelect(opts.items, 'Search destination…', (id) => opts.onPick('to', id));
  form.appendChild(toSelect.el);

  form.appendChild(tag('Algorithm'));
  const algorithm = document.createElement('select');
  algorithm.className = 'select';
  for (const [value, label] of ALGORITHMS) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    algorithm.appendChild(o);
  }
  form.appendChild(algorithm);

  const btnFindRoute = document.createElement('button');
  btnFindRoute.className = 'btn btn-primary btn-block';
  btnFindRoute.textContent = 'FIND ROUTE';
  form.appendChild(btnFindRoute);
  formCard.body.appendChild(form);
  root.appendChild(formCard.card);

  // ── 3 · Results (route / comparison / alternative / block) ───────────
  const resultsCard = collapsible('RESULT', true);
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
  btnCompare.className = 'btn btn-ghost';
  btnCompare.textContent = 'COMPARE DIJKSTRA vs A*';
  const btnAlternative = document.createElement('button');
  btnAlternative.className = 'btn btn-ghost';
  btnAlternative.textContent = 'FIND ALTERNATIVE';
  row2.append(btnCompare, btnAlternative);
  const btnReset = document.createElement('button');
  btnReset.className = 'btn btn-ghost btn-block';
  btnReset.textContent = 'RESET';
  resultsCard.body.append(row2, btnReset);
  root.appendChild(resultsCard.card);

  // ── 4 · Advanced (collapsed): Block path / View / Replay ─────────────
  const advCard = collapsible('ADVANCED', false);
  const advBody = advCard.body;

  // Block-path simulation
  const blockGroup = document.createElement('div');
  blockGroup.className = 'adv-group';
  blockGroup.appendChild(groupTag('Blocked-path simulation'));
  const blockRow = document.createElement('label');
  blockRow.className = 'toggle-row';
  const blockMode = document.createElement('input');
  blockMode.type = 'checkbox';
  blockRow.appendChild(blockMode);
  const blockSwitch = document.createElement('span');
  blockSwitch.className = 'toggle';
  blockRow.appendChild(blockSwitch);
  blockRow.appendChild(document.createTextNode('Block path mode'));
  const blockChip = document.createElement('span');
  blockChip.className = 'count-chip';
  blockChip.hidden = true;
  blockGroup.append(blockRow, blockChip);
  const blockHint = document.createElement('div');
  blockHint.className = 'hint';
  blockHint.textContent =
    'Enable, then click a walkway in the 3D scene to block it (click a red walkway to unblock). Routing re-runs automatically on a cloned graph — the original graph is never mutated.';
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
  btnCamera.textContent = 'RESET CAMERA';
  const viewHint = document.createElement('div');
  viewHint.className = 'hint';
  viewHint.textContent = 'Labels appear in stages as you zoom in (far → major only · close → all). Drag to orbit · scroll to zoom · right-drag to pan.';
  viewGroup.append(labelRow, btnCamera, viewHint);
  advBody.appendChild(viewGroup);

  // Replay
  const replayGroup = document.createElement('div');
  replayGroup.className = 'adv-group';
  replayGroup.appendChild(groupTag('Algorithm replay'));
  const replayBar = document.createElement('div');
  replayBar.className = 'replay-bar';
  const btnPlay = document.createElement('button');
  btnPlay.className = 'btn btn-replay';
  btnPlay.textContent = '▶ Play';
  const btnPause = document.createElement('button');
  btnPause.className = 'btn btn-replay';
  btnPause.textContent = '⏸ Pause';
  const btnReplayReset = document.createElement('button');
  btnReplayReset.className = 'btn btn-replay';
  btnReplayReset.textContent = '⟲ Reset';
  replayBar.appendChild(btnPlay);
  replayBar.appendChild(btnPause);
  replayBar.appendChild(btnReplayReset);
  const progress = document.createElement('span');
  progress.className = 'replay-progress';
  progress.textContent = '0 / 0';
  replayBar.appendChild(progress);
  replayGroup.appendChild(replayBar);
  const speedRow = document.createElement('div');
  speedRow.className = 'speed-row';
  speedRow.appendChild(document.createTextNode('Speed'));
  const speed = document.createElement('input');
  speed.type = 'range';
  speed.min = '2';
  speed.max = '48';
  speed.value = '14';
  speedRow.appendChild(speed);
  const speedLabel = document.createElement('span');
  speedLabel.className = 'speed-label';
  speedLabel.textContent = '14 ev/s';
  speed.addEventListener('input', () => {
    speedLabel.textContent = `${speed.value} ev/s`;
  });
  speedRow.appendChild(speedLabel);
  replayGroup.appendChild(speedRow);
  const readout = document.createElement('div');
  readout.className = 'replay-readout';
  readout.hidden = true;
  replayGroup.appendChild(readout);
  const replayHint = document.createElement('div');
  replayHint.className = 'hint';
  replayHint.textContent =
    'Replays the engine’s TraceEvent log (start → visit → relax → finalize) on the 3D scene. The algorithm itself already ran to completion.';
  replayGroup.appendChild(replayHint);
  advBody.appendChild(replayGroup);
  root.appendChild(advCard.card);

  // ── 5 · Algorithm notes ───────────────────────────────────────────────
  const algoCard = collapsible('ALGORITHM NOTES', false);
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
  root.appendChild(algoCard.card);

  // ── Provenance ────────────────────────────────────────────────────────
  const btnProvenance = document.createElement('button');
  btnProvenance.className = 'btn btn-ghost btn-block btn-provenance';
  btnProvenance.textContent = 'ⓘ DATA PROVENANCE';
  root.appendChild(btnProvenance);

  container.appendChild(root);

  // On-viewport provenance badge (kept small, bottom-left)
  const badge = document.createElement('div');
  badge.className = 'prov-badge';
  badge.appendChild(document.createTextNode('Digitized from public 2026 EPCOT map — approximate geometry'));
  const infoButton = document.createElement('button');
  infoButton.className = 'prov-info-btn';
  infoButton.title = 'Data provenance';
  infoButton.textContent = 'ⓘ';
  badge.appendChild(infoButton);
  container.appendChild(badge);

  const infoPanel = document.createElement('div');
  infoPanel.className = 'prov-info-panel';
  infoPanel.hidden = true;
  const infoClose = document.createElement('button');
  infoClose.className = 'btn btn-ghost btn-block';
  infoClose.textContent = 'CLOSE';
  infoPanel.appendChild(infoClose);
  const infoBody = document.createElement('div');
  infoBody.className = 'prov-info-body';
  infoPanel.appendChild(infoBody);
  container.appendChild(infoPanel);
  const closeInfo = () => {
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
    btnCompare,
    btnAlternative,
    btnReset,
    blockMode,
    blockChip,
    labelsToggle,
    btnCamera,
    btnProvenance,
    replay: { bar: replayBar, btnPlay, btnPause, btnReplayReset, speed, progress, readout },
    algoNotes,
    panels,
    datasetStats,
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
