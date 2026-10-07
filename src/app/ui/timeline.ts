/**
 * app/ui/timeline.ts
 *
 * The replay timeline (replaces the old play/pause/reset + events-per-second
 * slider). A scrubbable track with per-event markers coloured by event kind
 * (START / VISIT / RELAX / FINALIZE / ABORT), step buttons and discrete
 * speed presets (0.5× / 1× / 2× / 4×). No raw "events/sec" is exposed to
 * the user; the engineer mode may show the raw event count separately.
 *
 * Pure DOM construction + events — playback math stays in viz/replay.ts.
 */

import type { TraceEvent } from '../../engine/engine';
import { icon, iconFilled, type IconName } from './icons';

export interface TimelineHandlers {
  onPlayPause(): void;
  onRestart(): void;
  onStepBack(): void;
  onStepForward(): void;
  /** Absolute event index the user scrubbed to (0..total). */
  onSeek(index: number): void;
  /** Speed preset multiplier: 0.5 | 1 | 2 | 4. */
  onSpeed(multiplier: number): void;
}

export interface TimelineRefs {
  root: HTMLElement;
  /** (Re)build the marker strip for a new trace. */
  buildMarkers(trace: readonly TraceEvent[]): void;
  /** Move the handle + fill to event index (0..total). */
  setProgress(index: number, total: number): void;
  /** Reflect the play/pause state on the toggle button. */
  setPlaying(playing: boolean): void;
  /** Enable/disable the whole timeline (no replay loaded). */
  setEnabled(enabled: boolean): void;
  /** Engineer mode: show the raw "i / n" event counter. */
  setShowEventCount(show: boolean): void;
}

const SPEEDS = [0.5, 1, 2, 4] as const;

/** Marker colour per event kind — restrained, colour-blind-considerate set. */
export function markerColorFor(ev: TraceEvent): string {
  switch (ev.type) {
    case 'start':
      return '#4ade80'; // green
    case 'visit':
      return '#5b9bd5'; // steel blue
    case 'relax':
      return '#e0b34c'; // amber
    case 'finalize':
      return '#f5b942'; // gold
    case 'abort':
      return '#e57373'; // soft red
  }
}

function iconButton(
  name: IconName,
  label: string,
  filled = false,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'tl-btn';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.type = 'button';
  b.appendChild(filled ? iconFilled(name as 'play' | 'pause') : icon(name));
  return b;
}

export function buildTimeline(handlers: TimelineHandlers): TimelineRefs {
  const root = document.createElement('div');
  root.className = 'timeline';

  // ── controls row ────────────────────────────────────────────────────────
  const controls = document.createElement('div');
  controls.className = 'tl-controls';

  const btnRestart = iconButton('restart', 'Restart replay');
  btnRestart.addEventListener('click', handlers.onRestart);

  const btnStepBack = iconButton('step-back', 'Previous event');
  btnStepBack.addEventListener('click', handlers.onStepBack);

  const btnPlayPause = document.createElement('button');
  btnPlayPause.className = 'tl-btn tl-btn-play';
  btnPlayPause.title = 'Play';
  btnPlayPause.setAttribute('aria-label', 'Play');
  btnPlayPause.type = 'button';
  btnPlayPause.appendChild(iconFilled('play'));
  btnPlayPause.addEventListener('click', handlers.onPlayPause);

  const btnStepForward = iconButton('step-forward', 'Next event');
  btnStepForward.addEventListener('click', handlers.onStepForward);

  controls.append(btnRestart, btnStepBack, btnPlayPause, btnStepForward);

  // ── track ───────────────────────────────────────────────────────────────
  const track = document.createElement('div');
  track.className = 'tl-track';
  track.setAttribute('role', 'slider');
  track.setAttribute('aria-label', 'Replay position');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '0');
  track.setAttribute('aria-valuenow', '0');
  track.tabIndex = 0;

  const markers = document.createElement('div');
  markers.className = 'tl-markers';
  const fill = document.createElement('div');
  fill.className = 'tl-fill';
  const handle = document.createElement('div');
  handle.className = 'tl-handle';
  track.append(markers, fill, handle);

  // ── meta row: speed presets + (engineer) event counter ─────────────────
  const meta = document.createElement('div');
  meta.className = 'tl-meta';
  const speedGroup = document.createElement('div');
  speedGroup.className = 'tl-speeds';
  speedGroup.setAttribute('role', 'group');
  speedGroup.setAttribute('aria-label', 'Replay speed');
  for (const s of SPEEDS) {
    const b = document.createElement('button');
    b.className = `tl-speed${s === 1 ? ' active' : ''}`;
    b.type = 'button';
    b.textContent = s === 1 ? '1×' : `${s}×`;
    b.title = `Speed ${s}×`;
    b.setAttribute('aria-label', `Speed ${s} times`);
    b.setAttribute('aria-pressed', s === 1 ? 'true' : 'false');
    b.addEventListener('click', () => {
      for (const el of speedGroup.querySelectorAll<HTMLElement>('.tl-speed')) {
        const isThis = el === b;
        el.classList.toggle('active', isThis);
        el.setAttribute('aria-pressed', String(isThis));
      }
      handlers.onSpeed(s);
    });
    speedGroup.appendChild(b);
  }
  const eventCount = document.createElement('span');
  eventCount.className = 'tl-eventcount';
  eventCount.hidden = true;
  eventCount.textContent = '0 / 0';
  meta.append(speedGroup, eventCount);

  root.append(controls, track, meta);

  // ── scrubbing (pointer) ─────────────────────────────────────────────────
  let dragging = false;
  const seekFromPointer = (clientX: number): void => {
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const total = Number(track.getAttribute('aria-valuemax')) || 0;
    handlers.onSeek(Math.round(frac * total));
  };
  track.addEventListener('pointerdown', (e) => {
    dragging = true;
    track.setPointerCapture(e.pointerId);
    seekFromPointer(e.clientX);
  });
  track.addEventListener('pointermove', (e) => {
    if (dragging) seekFromPointer(e.clientX);
  });
  const endDrag = (e: PointerEvent): void => {
    dragging = false;
    if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);

  // Keyboard scrubbing (slider semantics).
  track.addEventListener('keydown', (e) => {
    const total = Number(track.getAttribute('aria-valuemax')) || 0;
    const now = Number(track.getAttribute('aria-valuenow')) || 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      handlers.onSeek(Math.min(total, now + 1));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      handlers.onSeek(Math.max(0, now - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      handlers.onSeek(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      handlers.onSeek(total);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      handlers.onPlayPause();
    }
  });

  let total = 0;

  return {
    root,
    buildMarkers(trace): void {
      total = trace.length;
      track.setAttribute('aria-valuemax', String(total));
      markers.innerHTML = '';
      if (total === 0) return;
      for (let i = 0; i < total; i += 1) {
        const ev = trace[i]!;
        const dot = document.createElement('span');
        const terminal = ev.type === 'start' || ev.type === 'finalize' || ev.type === 'abort';
        dot.className = `tl-dot${terminal ? ' tl-dot-term' : ''}`;
        dot.style.left = `${total === 1 ? 50 : (i / (total - 1)) * 100}%`;
        dot.style.background = markerColorFor(ev);
        dot.title = `${ev.type.toUpperCase()} — step ${i + 1} of ${total}`;
        markers.appendChild(dot);
      }
    },
    setProgress(index, totalNow): void {
      total = totalNow;
      track.setAttribute('aria-valuemax', String(totalNow));
      track.setAttribute('aria-valuenow', String(index));
      const frac = totalNow > 0 ? index / totalNow : 0;
      fill.style.width = `${frac * 100}%`;
      handle.style.left = `${frac * 100}%`;
      if (!eventCount.hidden) eventCount.textContent = `${index} / ${totalNow}`;
    },
    setPlaying(playing): void {
      btnPlayPause.innerHTML = '';
      btnPlayPause.appendChild(playing ? iconFilled('pause') : iconFilled('play'));
      btnPlayPause.title = playing ? 'Pause' : 'Play';
      btnPlayPause.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    },
    setEnabled(enabled): void {
      root.classList.toggle('disabled', !enabled);
      for (const b of [btnRestart, btnStepBack, btnPlayPause, btnStepForward]) b.disabled = !enabled;
      track.tabIndex = enabled ? 0 : -1;
    },
    setShowEventCount(show): void {
      eventCount.hidden = !show;
    },
  };
}
