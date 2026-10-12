/**
 * app/ui/palette.ts
 *
 * Command palette (Ctrl/Cmd+K): type a place name, jump to it. A small
 * dependency-free overlay with keyboard navigation. "Jump to" = the caller
 * decides what happens with the picked id (focus the camera, set as
 * destination, …).
 *
 * Behaviour contract:
 *   - CLOSED on creation. It opens ONLY via the Ctrl/Cmd+K key handler
 *     (preventDefault'd) and never restores a persisted open state — there
 *     is no persistence anywhere in this module.
 *   - Closes on Esc, on a backdrop click, and on selecting a result; focus
 *     returns to the element that had it when the palette opened.
 *   - Background scroll is locked only while open (the app normally has
 *     none — this keeps the guarantee true even if that changes).
 *   - Never open while the first-run tour is active (the `blocked` getter),
 *     so the two full-screen overlays never share the screen.
 *   - The document key listener is registered exactly once and removed by
 *     `dispose()` — safe under HMR / repeated app boots.
 */

import type { SearchItem } from './search';

export interface PaletteHandle {
  root: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Remove the global key listener (HMR / teardown safety). */
  dispose(): void;
}

export interface PaletteOptions {
  /** Suggested places for the empty query (ids, dataset order). Shown as
   *  the default list so the first Ctrl/Cmd+K is already useful. */
  suggest?: readonly string[];
  /** While it returns true the palette refuses to open (tour active). */
  blocked?: () => boolean;
}

const MAX_RESULTS = 12;

export function buildPalette(
  parent: HTMLElement,
  items: readonly SearchItem[],
  onPick: (id: string) => void,
  options: PaletteOptions = {},
): PaletteHandle {
  const root = document.createElement('div');
  root.className = 'palette-overlay';
  root.hidden = true; // must win over `display: flex` — see style.css [hidden] rule

  const box = document.createElement('div');
  box.className = 'palette-box';
  const input = document.createElement('input');
  input.className = 'palette-input';
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'Jump to a place…';
  input.setAttribute('aria-label', 'Command palette — jump to a place');
  const list = document.createElement('ul');
  list.className = 'palette-list';
  list.setAttribute('role', 'listbox');
  const hint = document.createElement('div');
  hint.className = 'palette-hint';
  hint.textContent = '↑↓ to move · Enter to go · Esc to close';
  box.append(input, list, hint);
  root.appendChild(box);
  parent.appendChild(root);

  let active = -1;
  let results: SearchItem[] = [];
  let open = false;
  let lastFocused: HTMLElement | null = null;
  let prevOverflow = '';

  // Suggested ids (order preserved); unknown ids are ignored.
  const byId = new Map(items.map((i) => [i.id, i]));
  const suggested = (options.suggest ?? [])
    .map((id) => byId.get(id))
    .filter((i): i is SearchItem => i !== undefined);

  const rank = (q: string, item: SearchItem): number => {
    const label = item.label.toLowerCase();
    if (q.length === 0) return 1;
    if (label.startsWith(q)) return 0;
    if (label.includes(q)) return 1;
    if (item.id.toLowerCase().includes(q)) return 2;
    if (item.hint !== undefined && item.hint.toLowerCase().includes(q)) return 3;
    return -1;
  };

  /** Render one name with the case-insensitive match wrapped in <mark>. */
  const nameNode = (item: SearchItem): HTMLElement => {
    const span = document.createElement('span');
    const q = input.value.trim().toLowerCase();
    const label = item.label;
    const idx = q.length > 0 ? label.toLowerCase().indexOf(q) : -1;
    if (idx < 0) {
      span.textContent = label;
    } else {
      span.append(
        document.createTextNode(label.slice(0, idx)),
        Object.assign(document.createElement('mark'), {
          textContent: label.slice(idx, idx + q.length),
        }),
        document.createTextNode(label.slice(idx + q.length)),
      );
    }
    return span;
  };

  const render = (): void => {
    const q = input.value.trim().toLowerCase();
    let pool: readonly SearchItem[];
    if (q.length === 0) {
      // Empty state: suggested places (main entrances, major pavilions,
      // key landmarks — dataset order), then the rest alphabetically.
      pool =
        suggested.length > 0
          ? [...suggested, ...items.filter((i) => !suggested.includes(i))]
          : [...items].sort((a, b) => a.label.localeCompare(b.label));
    } else {
      const scored: Array<{ item: SearchItem; score: number }> = [];
      for (const item of items) {
        const score = rank(q, item);
        if (score >= 0) scored.push({ item, score });
      }
      scored.sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label));
      pool = scored.map((s) => s.item);
    }
    results = pool.slice(0, MAX_RESULTS);
    list.innerHTML = '';
    active = results.length > 0 ? 0 : -1;
    results.forEach((item, i) => {
      const li = document.createElement('li');
      li.className = 'palette-item' + (i === active ? ' active' : '');
      li.setAttribute('role', 'option');
      li.dataset.index = String(i);
      li.append(nameNode(item));
      const tag = document.createElement('span');
      tag.className = 'palette-tag';
      tag.textContent = item.hint ?? '';
      li.appendChild(tag);
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(i);
      });
      list.appendChild(li);
    });
    // ONE footer hint, always — it doubles as the empty state.
    hint.hidden = false;
    if (results.length === 0 && q.length > 0) {
      hint.textContent = `No places match “${input.value.trim()}”`;
    } else if (q.length === 0) {
      hint.textContent = 'Suggested places — ↑↓ to move · Enter to go · Esc to close';
    } else {
      hint.textContent = `${results.length} place${results.length === 1 ? '' : 's'} — ↑↓ to move · Enter to go`;
    }
  };

  const pick = (i: number): void => {
    const item = results[i];
    if (item === undefined) return;
    closeFn(); // (NOT the global window.close!)
    onPick(item.id);
  };

  const openFn = (): void => {
    if (open) return;
    if ((options.blocked?.() ?? false)) return; // tour is on screen — stay closed
    open = true;
    lastFocused = (document.activeElement as HTMLElement | null) ?? null;
    // Lock background scroll only while open.
    prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    root.hidden = false;
    input.value = '';
    render();
    window.setTimeout(() => input.focus(), 0);
  };

  const closeFn = (): void => {
    if (!open) return;
    open = false;
    root.hidden = true;
    input.blur();
    document.documentElement.style.overflow = prevOverflow;
    if (lastFocused !== null && document.contains(lastFocused)) {
      lastFocused.focus();
    }
    lastFocused = null;
  };

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length > 0) {
        active = (active + 1) % results.length;
        render();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length > 0) {
        active = (active - 1 + results.length) % results.length;
        render();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFn();
    }
  });
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root) closeFn();
  });

  // Global Ctrl/Cmd+K — registered ONCE; `dispose()` removes it.
  const onKey = (e: KeyboardEvent): void => {
    const isK = e.key === 'k' || e.key === 'K' || e.code === 'KeyK';
    if ((e.metaKey || e.ctrlKey) && isK) {
      e.preventDefault();
      if (open) closeFn();
      else openFn();
      return;
    }
    if (e.key === 'Escape' && open) closeFn();
  };
  document.addEventListener('keydown', onKey);

  return {
    root,
    open: openFn,
    close: closeFn,
    isOpen: () => open,
    dispose: () => {
      document.removeEventListener('keydown', onKey);
    },
  };
}
