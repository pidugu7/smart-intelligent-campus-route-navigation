import { describe, expect, it } from 'vitest';
import { MinHeap, numericComparator } from '../../src/engine/priority-queue/min-heap';
import { dijkstraComparator, type DijkstraHeapEntry } from '../../src/engine/algorithms/dijkstra';

/** Deterministic PRNG (mulberry32) so stress tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** White-box check: the parent <= child invariant over the raw array. */
function expectHeapInvariant<T>(heap: MinHeap<T>, compare: (x: T, y: T) => number): void {
  const items = heap.toArray();
  for (let i = 1; i < items.length; i += 1) {
    const parent = items[(i - 1) >> 1]!;
    const child = items[i]!;
    expect(compare(parent, child), `heap invariant violated at index ${i}`).toBeLessThanOrEqual(0);
  }
}

describe('MinHeap (binary min-heap, from scratch)', () => {
  it('starts empty', () => {
    const heap = new MinHeap<number>(numericComparator);
    expect(heap.size).toBe(0);
    expect(heap.isEmpty).toBe(true);
    expect(heap.peek()).toBeUndefined();
    expect(heap.pop()).toBeUndefined();
    expect(heap.toArray()).toEqual([]);
  });

  it('peek returns the minimum without removing it', () => {
    const heap = new MinHeap<number>(numericComparator);
    heap.push(5);
    heap.push(2);
    heap.push(9);
    expect(heap.peek()).toBe(2);
    expect(heap.size).toBe(3); // unchanged
    expect(heap.peek()).toBe(2);
  });

  it('pops elements in ascending order (shuffled input)', () => {
    const values = Array.from({ length: 50 }, (_, i) => i + 1);
    // deterministic shuffle
    const rand = mulberry32(42);
    for (let i = values.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [values[i], values[j]] = [values[j]!, values[i]!];
    }
    const heap = new MinHeap<number>(numericComparator);
    for (const v of values) heap.push(v);

    const popped: number[] = [];
    while (!heap.isEmpty) {
      popped.push(heap.pop()!);
    }
    expect(popped).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it('maintains the heap invariant after every single push', () => {
    const heap = new MinHeap<number>(numericComparator);
    const rand = mulberry32(7);
    for (let i = 0; i < 200; i += 1) {
      heap.push(Math.floor(rand() * 1000));
      expectHeapInvariant(heap, numericComparator);
    }
  });

  it('maintains the heap invariant under interleaved push/pop', () => {
    const heap = new MinHeap<number>(numericComparator);
    const rand = mulberry32(1337);
    const pushed: number[] = [];
    const popped: number[] = [];
    for (let i = 0; i < 500; i += 1) {
      if (rand() < 0.6) {
        const v = Math.floor(rand() * 100);
        pushed.push(v);
        heap.push(v);
      } else {
        const v = heap.pop();
        if (v !== undefined) popped.push(v);
      }
      // The per-step contract is the heap invariant itself. (The full popped
      // sequence is NOT required to be non-decreasing under interleaving: a
      // smaller value may be pushed after a larger value was already popped.)
      expectHeapInvariant(heap, numericComparator);
    }
    while (!heap.isEmpty) popped.push(heap.pop()!);
    // Conservation: exactly the pushed multiset comes back out.
    const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
    expect(sorted(popped)).toEqual(sorted(pushed));
  });

  it('supports duplicate entries (required by lazy deletion)', () => {
    const heap = new MinHeap<number>(numericComparator);
    for (const v of [3, 1, 3, 2, 3, 1]) heap.push(v);
    expect(heap.size).toBe(6);
    const popped: number[] = [];
    while (!heap.isEmpty) popped.push(heap.pop()!);
    expect(popped).toEqual([1, 1, 2, 3, 3, 3]);
  });

  it('empties cleanly: last real pop followed by undefined', () => {
    const heap = new MinHeap<number>(numericComparator);
    heap.push(1);
    expect(heap.pop()).toBe(1);
    expect(heap.isEmpty).toBe(true);
    expect(heap.pop()).toBeUndefined();
    expect(heap.size).toBe(0);
  });

  it('works with an arbitrary custom comparator (strings by length)', () => {
    const heap = new MinHeap<string>((a, b) => a.length - b.length);
    for (const s of ['gamma', 'a', 'epsilon', 'ab', 'x']) heap.push(s);
    const popped: string[] = [];
    while (!heap.isEmpty) popped.push(heap.pop()!);
    // lengths must come out non-decreasing: a(1), x(1), ab(2), gamma(5), epsilon(7)
    expect(popped.map((s) => s.length)).toEqual([1, 1, 2, 5, 7]);
  });

  it('orders (distance, id) pairs: smaller id wins ties', () => {
    const heap = new MinHeap<DijkstraHeapEntry>(dijkstraComparator);
    const entries: DijkstraHeapEntry[] = [
      { key: 5, id: 'b' },
      { key: 1, id: 'z' },
      { key: 5, id: 'a' },
      { key: 2, id: 'm' },
    ];
    for (const e of entries) heap.push(e);
    const order: string[] = [];
    while (!heap.isEmpty) order.push(heap.pop()!.id);
    expect(order).toEqual(['z', 'm', 'a', 'b']);
  });

  it('stress: 10,000 random pushes then a fully sorted drain', () => {
    const heap = new MinHeap<number>(numericComparator);
    const rand = mulberry32(2026);
    const source: number[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      const v = Math.floor(rand() * 10_000);
      source.push(v);
      heap.push(v);
    }
    const expected = [...source].sort((a, b) => a - b);
    const popped: number[] = [];
    while (!heap.isEmpty) popped.push(heap.pop()!);
    expect(popped).toEqual(expected);
  });
});
