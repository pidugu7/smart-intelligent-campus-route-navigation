/**
 * app/ui/hud.ts
 *
 * Compact on-map HUD (replaces the old "Replaying…" pill).
 *
 *   REPLAYING · A* · Event 17 / 64   [progress ring]
 *   “Found a shorter path to Japan.”
 *
 * and, when the replay finishes:
 *
 *   ROUTE FOUND
 *   1.01 km · ≈ 12 min · A*
 *
 * Progress ring is a small SVG circle driven by stroke-dashoffset.
 */

import { icon } from './icons';

export interface HudRefs {
  root: HTMLElement;
  /** 'replaying' | 'paused' | 'done' | 'hidden'. */
  setState(state: 'replaying' | 'paused' | 'done' | 'hidden'): void;
  setAlgorithm(label: string): void;
  /** i = current event index, n = total. */
  setEvent(index: number, total: number): void;
  setCaption(text: string): void;
  /** Final summary line (distance · walk time · algorithm). */
  setSummary(text: string): void;
}

const RING_R = 8;
const RING_C = 2 * Math.PI * RING_R;

export function buildHud(): HudRefs {
  const root = document.createElement('div');
  root.className = 'hud';
  root.hidden = true;
  root.setAttribute('aria-live', 'polite');

  const topRow = document.createElement('div');
  topRow.className = 'hud-top';

  const status = document.createElement('span');
  status.className = 'hud-status';
  status.appendChild(icon('route', 14));
  status.appendChild(document.createTextNode('REPLAYING'));

  const algo = document.createElement('span');
  algo.className = 'hud-algo';

  const event = document.createElement('span');
  event.className = 'hud-event';

  const ringWrap = document.createElement('span');
  ringWrap.className = 'hud-ring';
  ringWrap.setAttribute('aria-hidden', 'true');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  const bg = document.createElementNS(ns, 'circle');
  bg.setAttribute('cx', '10');
  bg.setAttribute('cy', '10');
  bg.setAttribute('r', String(RING_R));
  bg.setAttribute('fill', 'none');
  bg.setAttribute('stroke', 'rgba(255,255,255,0.14)');
  bg.setAttribute('stroke-width', '2.4');
  const fg = document.createElementNS(ns, 'circle');
  fg.setAttribute('cx', '10');
  fg.setAttribute('cy', '10');
  fg.setAttribute('r', String(RING_R));
  fg.setAttribute('fill', 'none');
  fg.setAttribute('stroke', '#f5b942');
  fg.setAttribute('stroke-width', '2.4');
  fg.setAttribute('stroke-linecap', 'round');
  fg.setAttribute('stroke-dasharray', String(RING_C));
  fg.setAttribute('stroke-dashoffset', String(RING_C));
  fg.setAttribute('transform', 'rotate(-90 10 10)');
  svg.append(bg, fg);
  ringWrap.appendChild(svg);

  topRow.append(status, algo, event, ringWrap);

  const caption = document.createElement('div');
  caption.className = 'hud-caption';

  const summary = document.createElement('div');
  summary.className = 'hud-summary';

  root.append(topRow, caption, summary);

  let totalShown = 0;

  return {
    root,
    setState(state): void {
      if (state === 'hidden') {
        root.hidden = true;
        return;
      }
      root.hidden = false;
      root.classList.toggle('done', state === 'done');
      root.classList.toggle('paused', state === 'paused');
      status.childNodes[1]!.textContent =
        state === 'replaying' ? 'REPLAYING' : state === 'paused' ? 'PAUSED' : 'ROUTE FOUND';
      if (state === 'done') summary.style.display = '';
    },
    setAlgorithm(label): void {
      algo.textContent = label;
    },
    setEvent(index, total): void {
      totalShown = total;
      event.textContent = total > 0 ? `Event ${Math.min(index, total)} / ${total}` : '';
      const frac = total > 0 ? Math.min(index, total) / total : 0;
      fg.setAttribute('stroke-dashoffset', String(RING_C * (1 - frac)));
    },
    setCaption(text): void {
      caption.textContent = text;
      caption.style.display = text ? '' : 'none';
    },
    setSummary(text): void {
      summary.textContent = text;
      if (!text) summary.style.display = 'none';
      if (totalShown === 0) event.textContent = '';
    },
  };
}
