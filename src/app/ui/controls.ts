/**
 * app/ui/controls.ts
 *
 * Builds the navigation control panel (sidebar) and the on-viewport
 * provenance badge / info panel. Pure DOM construction + references —
 * all behaviour (engine calls, scene updates) is wired in app/main.ts.
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
  labelsToggle: HTMLInputElement;
  btnCamera: HTMLButtonElement;
  replay: {
    bar: HTMLElement;
    btnPlay: HTMLButtonElement;
    btnPause: HTMLButtonElement;
    btnReplayReset: HTMLButtonElement;
    speed: HTMLInputElement;
    progress: HTMLSpanElement;
  };
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

export function buildControls(
  container: HTMLElement,
  opts: { items: SearchItem[]; vertexCount: number; edgeCount: number; onPick: (which: 'from' | 'to', id: string) => void },
): AppControls {
  const root = document.createElement('aside');
  root.className = 'sidebar';

  // Header
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

  // Dataset card
  const datasetCard = document.createElement('section');
  datasetCard.className = 'panel-card';
  const datasetStats = document.createElement('div');
  datasetStats.className = 'dataset-stats';
  datasetCard.innerHTML = '<div class="panel-title">Dataset</div><div class="dataset-name">EPCOT</div>';
  datasetCard.appendChild(datasetStats);
  datasetStats.textContent = `Walt Disney World · ${opts.vertexCount} locations · ${opts.edgeCount} connections`;
  root.appendChild(datasetCard);

  // Route form
  const form = document.createElement('section');
  form.className = 'panel-card';
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

  const row2 = document.createElement('div');
  row2.className = 'btn-row';
  const btnCompare = document.createElement('button');
  btnCompare.className = 'btn btn-ghost';
  btnCompare.textContent = 'COMPARE DIJKSTRA vs A*';
  const btnAlternative = document.createElement('button');
  btnAlternative.className = 'btn btn-ghost';
  btnAlternative.textContent = 'FIND ALTERNATIVE';
  row2.appendChild(btnCompare);
  row2.appendChild(btnAlternative);
  form.appendChild(row2);

  const btnReset = document.createElement('button');
  btnReset.className = 'btn btn-ghost btn-block';
  btnReset.textContent = 'RESET';
  form.appendChild(btnReset);
  root.appendChild(form);

  // Block-path mode
  const blockCard = document.createElement('section');
  blockCard.className = 'panel-card';
  blockCard.appendChild(tag('Blocked-path simulation'));
  const blockRow = document.createElement('label');
  blockRow.className = 'toggle-row';
  const blockMode = document.createElement('input');
  blockMode.type = 'checkbox';
  blockRow.appendChild(blockMode);
  const blockSwitch = document.createElement('span');
  blockSwitch.className = 'toggle';
  blockRow.appendChild(blockSwitch);
  blockRow.appendChild(document.createTextNode('Block path mode'));
  blockCard.appendChild(blockRow);
  const blockHint = document.createElement('div');
  blockHint.className = 'hint';
  blockHint.textContent = 'Enable, then click a walkway in the 3D scene to block it (click a blocked walkway to unblock). Routing re-runs automatically on a cloned graph.';
  blockCard.appendChild(blockHint);
  root.appendChild(blockCard);

  // View
  const viewCard = document.createElement('section');
  viewCard.className = 'panel-card';
  viewCard.appendChild(tag('View'));
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
  viewCard.appendChild(labelRow);
  const btnCamera = document.createElement('button');
  btnCamera.className = 'btn btn-ghost btn-block';
  btnCamera.textContent = 'RESET CAMERA';
  viewCard.appendChild(btnCamera);
  const viewHint = document.createElement('div');
  viewHint.className = 'hint';
  viewHint.textContent = 'Drag to orbit · scroll to zoom · right-drag to pan.';
  viewCard.appendChild(viewHint);
  root.appendChild(viewCard);

  // Replay
  const replayCard = document.createElement('section');
  replayCard.className = 'panel-card replay-card';
  replayCard.appendChild(tag('Algorithm replay'));
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
  replayCard.appendChild(replayBar);
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
  replayCard.appendChild(speedRow);
  const replayHint = document.createElement('div');
  replayHint.className = 'hint';
  replayHint.textContent = 'Replays the engine’s TraceEvent log (start → visit → relax → finalize). The algorithm itself already ran to completion.';
  replayCard.appendChild(replayHint);
  root.appendChild(replayCard);

  // Results (stack)
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
  root.appendChild(results);

  container.appendChild(root);

  // Provenance badge + info panel (overlay the viewport, not the sidebar)
  const badge = document.createElement('div');
  badge.className = 'prov-badge';
  badge.appendChild(
    document.createTextNode('Spatial data: digitized from public 2026 EPCOT map — approximate'),
  );
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
  infoClose.addEventListener('click', () => {
    infoPanel.hidden = true;
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
    labelsToggle,
    btnCamera,
    replay: { bar: replayBar, btnPlay, btnPause, btnReplayReset, speed, progress },
    panels,
    datasetStats,
    badge,
    infoButton,
    infoPanel,
  };
}

function tag(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'field-tag';
  d.textContent = text;
  return d;
}
