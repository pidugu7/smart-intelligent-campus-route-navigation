/**
 * app/ui/palette.ts
 *
 * Command palette (Ctrl/Cmd+K): type a place name, jump to it. A small
 * dependency-free overlay with keyboard navigation. "Jump to" = the caller
 * decides what happens with the picked id (focus the camera, set as
 * destination, …).
 */

import type { SearchItem } from './search';

export interface PaletteHandle {
  root: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
}

const MAX_RESULTS = 12;

export function buildPalette(
  parent: HTMLElement,
  items: readonly SearchItem[],
  onPick: (id: string) => void,
): PaletteHandle {
  const root = document.createElement('div');
  root.className = 'palette-overlay';
  root.hidden = true;

  const box = document.createElement('div');
  box.className = 'palette-box';
  const input = document.createElement('input');
  input.className = 'palette-input';
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'Jump to a place… (↑↓ to move, Enter to go, Esc to close)';
  input.setAttribute('aria-label', 'Command palette — jump to a place');
  const list = document.createElement('ul');
  list.className = 'palette-list';
  list.setAttribute('role', 'listbox');
  const hint = document.createElement('div');
  hint.className = 'palette-hint';
  hint.textContent = 'Ctrl / ⌘ + K anywhere';
  box.append(input, list, hint);
  root.appendChild(box);
  parent.appendChild(root);

  let active = -1;
  let results: SearchItem[] = [];
  let open = false;

  const rank = (q: string, item: SearchItem): number => {
    const label = item.label.toLowerCase();
    if (q.length === 0) return 1;
    if (label.startsWith(q)) return 0;
    if (label.includes(q)) return 1;
    if (item.id.toLowerCase().includes(q)) return 2;
    if (item.hint !== undefined && item.hint.toLowerCase().includes(q)) return 3;
    return -1;
  };

  const render = (): void => {
    const q = input.value.trim().toLowerCase();
    const scored: Array<{ item: SearchItem; score: number }> = [];
    for (const item of items) {
      const score = rank(q, item);
      if (score >= 0) scored.push({ item, score });
    }
    scored.sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label));
    results = scored.slice(0, MAX_RESULTS).map((s) => s.item);
    list.innerHTML = '';
    active = results.length > 0 ? 0 : -1;
    results.forEach((item, i) => {
      const li = document.createElement('li');
      li.className = 'palette-item' + (i === active ? ' active' : '');
      li.setAttribute('role', 'option');
      li.dataset.index = String(i);
      const name = document.createElement('span');
      name.className = 'palette-name';
      name.textContent = item.label;
      const tag = document.createElement('span');
      tag.className = 'palette-tag';
      tag.textContent = item.hint ?? '';
      li.append(name, tag);
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(i);
      });
      list.appendChild(li);
    });
    hint.hidden = results.length === 0;
    if (results.length === 0 && q.length > 0) {
      hint.hidden = false;
      hint.textContent = `No places match “${input.value.trim()}”`;
    } else if (results.length > 0) {
      hint.textContent = `${results.length} place${results.length === 1 ? '' : 's'} — ↑↓ to move, Enter to go`;
    }
  };

  const pick = (i: number): void => {
    const item = results[i];
    if (item === undefined) return;
    close();
    onPick(item.id);
  };

  const openFn = (): void => {
    if (open) return;
    open = true;
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

  // Global Ctrl/Cmd+K.
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (open) closeFn();
      else openFn();
    } else if (e.key === 'Escape' && open) {
      closeFn();
    }
  });

  return { root, open: openFn, close: closeFn, isOpen: () => open };
}
