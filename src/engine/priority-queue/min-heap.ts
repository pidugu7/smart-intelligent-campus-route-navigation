/** Ordering predicate: returns < 0 if `a` should come out of the heap before `b`. */
export type Comparator<T> = (a: T, b: T) => number;

/** Comparator for plain numbers (ascending). */
export function numericComparator(a: number, b: number): number {
  return a - b;
}

/**
 * Binary min-heap backed by a plain JavaScript array, written from scratch
 * with no dependencies. This is the priority queue used by Dijkstra (and,
 * in Phase 2, by A*) — implemented by hand on purpose so its internals are
 * examinable and directly testable.
 *
 * Layout (0-indexed storage, classic binary-heap indexing):
 *   parent(i) = (i - 1) >> 1
 *   left(i)   = 2*i + 1
 *   right(i)  = 2*i + 2
 *
 * Heap invariant: for every i > 0, compare(items[parent(i)], items[i]) <= 0.
 * The minimum element is therefore always items[0].
 *
 * Complexity (n = current size):
 *   push   O(log n)  — one sift-up along the root path
 *   pop    O(log n)  — move the last element to the root, sift down
 *   peek   O(1)      — the minimum is always items[0]
 *   space  O(n)
 *
 * The heap does NOT deduplicate: duplicate entries are legal and are the
 * basis of Dijkstra's "lazy deletion" strategy — stale entries are simply
 * skipped when popped (see algorithms/dijkstra.ts).
 *
 * No DOM, no browser APIs: this class runs identically in Node (tests) and
 * in the browser (Phase 4).
 */
export class MinHeap<T> {
  private readonly items: T[] = [];
  private readonly compare: Comparator<T>;

  constructor(compare: Comparator<T>) {
    this.compare = compare;
  }

  /** Current number of stored elements. O(1). */
  get size(): number {
    return this.items.length;
  }

  /** Whether the heap is empty. O(1). */
  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * The smallest element without removing it. O(1).
   * @returns undefined when the heap is empty.
   */
  peek(): T | undefined {
    return this.items[0];
  }

  /**
   * Insert an element, restoring the heap invariant by sifting it up.
   * O(log n) time.
   */
  push(item: T): void {
    this.items.push(item);
    this.siftUp(this.items.length - 1);
  }

  /**
   * Remove and return the smallest element, restoring the invariant.
   * O(log n) time.
   * @returns undefined when the heap is empty.
   */
  pop(): T | undefined {
    const n = this.items.length;
    if (n === 0) {
      return undefined;
    }
    const top = this.items[0]!;
    const last = this.items.pop()!;
    if (n > 1) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  /**
   * A copy of the internal storage in heap order (NOT sorted). Exposed for
   * white-box tests and debugging only. O(n).
   */
  toArray(): T[] {
    return [...this.items];
  }

  /** compare(items[i], items[j]) < 0. Indices are always valid at the call sites. */
  private less(i: number, j: number): boolean {
    return this.compare(this.items[i]!, this.items[j]!) < 0;
  }

  private swap(i: number, j: number): void {
    const tmp = this.items[i]!;
    this.items[i] = this.items[j]!;
    this.items[j] = tmp;
  }

  /** Move the element at index i up toward the root until the invariant holds. O(log n). */
  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(i, parent)) {
        this.swap(i, parent);
        i = parent;
      } else {
        break;
      }
    }
  }

  /** Move the element at index i down toward the leaves until the invariant holds. O(log n). */
  private siftDown(i: number): void {
    const n = this.items.length;
    for (;;) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      if (left < n && this.less(left, smallest)) {
        smallest = left;
      }
      if (right < n && this.less(right, smallest)) {
        smallest = right;
      }
      if (smallest === i) {
        break;
      }
      this.swap(i, smallest);
      i = smallest;
    }
  }
}
