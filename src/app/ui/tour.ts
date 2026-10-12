/**
 * app/ui/tour.ts
 *
 * First-run onboarding — SPOTLIGHT style (Phase 4): the page dims and a
 * single element is lit at a time; a tooltip card explains it. The tooltip
 * is placed below the target, or above when there is no room (so it never
 * covers the bottom dock), and is clamped inside the viewport.
 *
 * Stored per browser (localStorage); never shown again once dismissed.
 * No new dependencies.
 */

import { icon } from './icons';

const STORAGE_KEY = 'scrn-tour-v1-done';

export interface TourStep {
  /** CSS selector of the element to spotlight (or null for a free-standing card). */
  target: string | null;
  title: string;
  text: string;
}

export interface TourRef {
  root: HTMLElement;
  start(): void;
}

export function hasCompletedTour(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false; // storage unavailable (private mode) → just don't force it again
  }
}

function markTourDone(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* ignore */
  }
}

const PAD = 8; // spotlight padding around the target
const MARGIN = 12; // viewport margin for the tooltip
const BOTTOM_SAFE = 120; // keep the tooltip out of the bottom dock zone

export function buildTour(steps: readonly TourStep[]): TourRef {
  const root = document.createElement('div');
  root.className = 'tour';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Welcome tour');

  // One element does the dimming AND the hole: a huge box-shadow ring.
  const spot = document.createElement('div');
  spot.className = 'tour-spot';
  spot.hidden = true;

  const card = document.createElement('div');
  card.className = 'tour-card';
  const stepno = document.createElement('div');
  stepno.className = 'tour-stepno';
  const title = document.createElement('div');
  title.className = 'tour-title';
  const text = document.createElement('div');
  text.className = 'tour-text';
  const actions = document.createElement('div');
  actions.className = 'tour-actions';
  const btnSkip = document.createElement('button');
  btnSkip.className = 'btn btn-ghost btn-sm';
  btnSkip.type = 'button';
  btnSkip.textContent = 'Skip tour';
  const btnNext = document.createElement('button');
  btnNext.className = 'btn btn-primary btn-sm';
  btnNext.type = 'button';
  const nextLabel = Object.assign(document.createElement('span'), { textContent: 'Next' });
  const nextIcon = Object.assign(document.createElement('span'), { className: 'tour-next-icon' });
  btnNext.append(nextLabel, nextIcon);
  actions.append(btnSkip, btnNext);
  card.append(stepno, title, text, actions);

  root.append(spot, card);

  let index = -1;
  let active = false;

  const targetEl = (sel: string | null): HTMLElement | null => {
    if (sel === null) return null;
    return document.querySelector<HTMLElement>(sel);
  };

  /** Position the spotlight hole + tooltip for the current step. */
  const place = (): void => {
    const step = steps[index]!;
    const el = targetEl(step.target);
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Tooltip metrics (rendered first, measured, then positioned).
    card.style.visibility = 'hidden';
    card.style.left = '0px';
    card.style.top = '0px';
    const cardW = card.offsetWidth;
    const cardH = card.offsetHeight;
    card.style.visibility = '';

    if (el === null) {
      // Free-standing: centered card, full dim (no hole).
      spot.hidden = true;
      card.style.left = `${Math.max(MARGIN, (vw - cardW) / 2)}px`;
      card.style.top = `${Math.max(MARGIN, (vh - cardH) / 2)}px`;
      return;
    }

    const r = el.getBoundingClientRect();
    spot.hidden = false;
    spot.style.left = `${r.left - PAD}px`;
    spot.style.top = `${r.top - PAD}px`;
    spot.style.width = `${r.width + PAD * 2}px`;
    spot.style.height = `${r.height + PAD * 2}px`;
    spot.style.borderRadius = '14px';

    // Prefer BELOW the target; flip above if it would cover the dock zone.
    let top = r.bottom + PAD + 10;
    if (top + cardH > vh - BOTTOM_SAFE) {
      top = r.top - PAD - 10 - cardH;
    }
    if (top < MARGIN) top = MARGIN;
    const left = Math.min(Math.max(MARGIN, r.left + r.width / 2 - cardW / 2), vw - cardW - MARGIN);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  };

  const render = (): void => {
    const step = steps[index]!;
    stepno.textContent = `${index + 1} / ${steps.length}`;
    title.textContent = step.title;
    text.textContent = step.text;
    nextLabel.textContent = index === steps.length - 1 ? 'Finish' : 'Next';
    nextIcon.replaceChildren();
    if (index < steps.length - 1) nextIcon.appendChild(icon('step-forward', 14));
    place();
  };

  const close = (): void => {
    root.hidden = true;
    active = false;
    index = -1;
    markTourDone();
  };

  btnSkip.addEventListener('click', close);
  btnNext.addEventListener('click', () => {
    if (index >= steps.length - 1) {
      close();
    } else {
      index += 1;
      render();
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  const onResize = (): void => {
    if (active) place();
  };
  window.addEventListener('resize', onResize);

  return {
    root,
    start(): void {
      if (index >= 0 || hasCompletedTour()) return;
      index = 0;
      active = true;
      root.hidden = false;
      render();
      // Reposition once the layout settles (fonts, images).
      window.setTimeout(() => {
        if (active) place();
      }, 180);
      // Remove the resize listener if the tour is torn down early.
      root.dataset.tourActive = '1';
      window.setTimeout(() => {
        if (!root.isConnected) window.removeEventListener('resize', onResize);
      }, 30000);
    },
  };
}
