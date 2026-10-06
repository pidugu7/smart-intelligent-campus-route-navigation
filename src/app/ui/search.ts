/**
 * app/ui/search.ts
 *
 * createSearchSelect — a small dependency-free searchable dropdown
 * (typeahead with keyboard support) used for the From / To location picks.
 */

export interface SearchItem {
  id: string;
  label: string;
  hint?: string;
}

export interface SearchSelect {
  /** Set the selected value (also updates the input text). */
  set(id: string | null): void;
  get(): string | null;
  el: HTMLDivElement;
}

const MAX_RESULTS = 14;

let listIdCounter = 0;

export function createSearchSelect(
  items: readonly SearchItem[],
  placeholder: string,
  onPick: (id: string) => void,
): SearchSelect {
  const byId = new Map(items.map((i) => [i.id, i]));
  let selected: string | null = null;

  const el = document.createElement('div');
  el.className = 'search';
  el.innerHTML = `
    <div class="search-input-wrap">
      <span class="search-icon" aria-hidden="true">⌕</span>
      <input class="search-input" type="text" autocomplete="off" spellcheck="false" placeholder="${placeholder}">
    </div>
    <ul class="search-list" role="listbox" hidden></ul>
  `;
  const input = el.querySelector<HTMLInputElement>('.search-input')!;
  const list = el.querySelector<HTMLElement>('.search-list')!;
  // Accessible name + combobox semantics (placeholder alone is not reliable).
  listIdCounter += 1;
  const listId = `search-list-${listIdCounter}`;
  input.setAttribute('aria-label', placeholder);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', listId);
  list.id = listId;
  list.setAttribute('aria-label', placeholder);
  let activeIndex = -1;

  function renderResults(query: string): SearchItem[] {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return items.slice(0, MAX_RESULTS);
    const scored: Array<{ item: SearchItem; score: number }> = [];
    for (const item of items) {
      const label = item.label.toLowerCase();
      const id = item.id.toLowerCase();
      let score = -1;
      if (label.startsWith(q)) score = 0;
      else if (label.includes(q)) score = 1;
      else if (id.includes(q)) score = 2;
      if (score >= 0) scored.push({ item, score });
    }
    scored.sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label));
    return scored.slice(0, MAX_RESULTS).map((s) => s.item);
  }

  function highlight(label: string, query: string): string {
    const q = query.trim();
    if (q.length === 0) return escapeHtml(label);
    const idx = label.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return escapeHtml(label);
    return `${escapeHtml(label.slice(0, idx))}<mark>${escapeHtml(label.slice(idx, idx + q.length))}</mark>${escapeHtml(label.slice(idx + q.length))}`;
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function openList(results: SearchItem[], query: string): void {
    if (results.length === 0) {
      // Graceful empty state for a query that matches no location.
      list.innerHTML = `<li class="search-empty" aria-disabled="true"><span class="search-label">No locations match “${escapeHtml(query.trim())}”</span></li>`;
    } else {
      list.innerHTML = results
        .map(
          (r, i) => `<li role="option" id="${listId}-opt-${i}" data-id="${escapeHtml(r.id)}" aria-selected="${r.id === selected}" class="${i === activeIndex ? 'active' : ''} ${r.id === selected ? 'selected' : ''}">
          <span class="search-label">${highlight(r.label, query)}</span>
          ${r.hint !== undefined ? `<span class="search-hint">${escapeHtml(r.hint)}</span>` : ''}
        </li>`,
        )
        .join('');
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant',
      activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : '',
    );
  }

  function closeList(): void {
    list.hidden = true;
    activeIndex = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function pick(id: string): void {
    const item = byId.get(id);
    if (item === undefined) return;
    selected = id;
    input.value = item.label;
    closeList();
    input.blur();
    onPick(id);
  }

  input.addEventListener('input', () => {
    const q = input.value;
    selected = normalize(q);
    activeIndex = -1;
    openList(renderResults(q), q);
  });

  function normalize(text: string): string | null {
    const t = text.trim().toLowerCase();
    if (t.length === 0) return null;
    for (const item of items) {
      if (item.label.toLowerCase() === t) return item.id;
    }
    return null;
  }

  input.addEventListener('focus', () => {
    openList(renderResults(input.value), input.value);
  });

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    const results = renderResults(input.value);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length === 0) return;
      activeIndex =
        e.key === 'ArrowDown'
          ? (activeIndex + 1) % results.length
          : (activeIndex - 1 + results.length) % results.length;
      openList(results, input.value);
      const li = list.children[activeIndex] as HTMLElement | undefined;
      li?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = activeIndex >= 0 ? results[activeIndex] : results[0];
      if (target !== undefined) pick(target.id);
    } else if (e.key === 'Escape') {
      closeList();
      input.blur();
    }
  });

  list.addEventListener('mousedown', (e: MouseEvent) => {
    const li = (e.target as HTMLElement).closest<HTMLLIElement>('li[data-id]');
    if (li !== null) {
      e.preventDefault(); // keep input focus flow stable
      pick(li.dataset.id!);
    }
  });

  // 'focusout' (unlike 'blur') bubbles, so it fires when the input loses
  // focus — closing the dropdown on any outside click.
  el.addEventListener('focusout', () => {
    window.setTimeout(() => closeList(), 120);
  });

  return {
    set(id: string | null): void {
      selected = id;
      const item = id !== null ? byId.get(id) : undefined;
      input.value = item?.label ?? '';
      if (id !== null) closeList();
    },
    get(): string | null {
      return selected;
    },
    el,
  };
}
