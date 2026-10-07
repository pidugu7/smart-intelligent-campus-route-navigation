/**
 * app/ui/tour.ts
 *
 * Lightweight first-run onboarding (5 steps). A small floating card with
 * step progress + Skip / Next / Finish, and a soft highlight ring around
 * the relevant UI element when one exists. The tour is stored per browser
 * (localStorage) and is never shown again once dismissed or completed.
 *
 * No new dependencies, no full-screen takeover — the map stays visible
 * and interactive behind the card.
 */

import { icon } from './icons';

const STORAGE_KEY = 'scrn-tour-v1-done';

export interface TourStep {
  /** CSS selector of the element to highlight (or null for a free-standing card). */
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

export function buildTour(steps: readonly TourStep[]): TourRef {
  const root = document.createElement('div');
  root.className = 'tour';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-label', 'Welcome tour');

  const highlight = document.createElement('div');
  highlight.className = 'tour-highlight';
  highlight.hidden = true;

  const card = document.createElement('div');
  card.className = 'tour-card';
  card.appendChild(Object.assign(document.createElement('div'), { className: 'tour-stepno', textContent: '1 / 5' }));
  const title = document.createElement('div');
  title.className = 'tour-title';
  const text = document.createElement('div');
  text.className = 'tour-text';
  const actions = document.createElement('div');
  actions.className = 'tour-actions';
  const btnSkip = document.createElement('button');
  btnSkip.className = 'btn btn-ghost';
  btnSkip.type = 'button';
  btnSkip.textContent = 'Skip';
  const btnNext = document.createElement('button');
  btnNext.className = 'btn btn-primary';
  btnNext.type = 'button';
  const nextLabel = Object.assign(document.createElement('span'), { textContent: 'Next' });
  const nextIcon = Object.assign(document.createElement('span'), { className: 'tour-next-icon' });
  btnNext.append(nextLabel, nextIcon);
  actions.append(btnSkip, btnNext);
  card.append(title, text, actions);

  root.append(highlight, card);

  let index = -1;

  const positionHighlight = (sel: string | null): void => {
    if (sel === null) {
      highlight.hidden = true;
      return;
    }
    const el = document.querySelector<HTMLElement>(sel);
    if (el === null) {
      highlight.hidden = true;
      return;
    }
    const r = el.getBoundingClientRect();
    highlight.hidden = false;
    highlight.style.left = `${r.left - 6}px`;
    highlight.style.top = `${r.top - 6}px`;
    highlight.style.width = `${r.width + 12}px`;
    highlight.style.height = `${r.height + 12}px`;
  };

  const render = (): void => {
    const step = steps[index]!;
    card.querySelector<HTMLElement>('.tour-stepno')!.textContent = `${index + 1} / ${steps.length}`;
    title.textContent = step.title;
    text.textContent = step.text;
    nextLabel.textContent = index === steps.length - 1 ? 'Finish' : 'Next';
    nextIcon.replaceChildren();
    if (index < steps.length - 1) nextIcon.appendChild(icon('step-forward', 14));
    positionHighlight(step.target);
  };

  const close = (): void => {
    root.hidden = true;
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

  return {
    root,
    start(): void {
      if (index >= 0 || hasCompletedTour()) return;
      index = 0;
      root.hidden = false;
      render();
      // Reposition the highlight if the layout settles (fonts, etc.).
      window.setTimeout(() => positionHighlight(steps[index]!.target), 150);
    },
  };
}
