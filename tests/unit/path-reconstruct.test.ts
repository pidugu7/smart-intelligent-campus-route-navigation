import { describe, expect, it } from 'vitest';
import { reconstructPath } from '../../src/engine/routing/path-reconstruct';

function parentMap(entries: Array<[string, string | null]>): Map<string, string | null> {
  return new Map(entries);
}

describe('reconstructPath (predecessor-map backtracking)', () => {
  it('walks the parent chain backwards and returns walking order', () => {
    const parent = parentMap([
      ['a', null],
      ['b', 'a'],
      ['c', 'b'],
    ]);
    expect(reconstructPath(parent, 'a', 'c')).toEqual(['a', 'b', 'c']);
  });

  it('returns the single vertex when source === target', () => {
    expect(reconstructPath(new Map<string, string | null>(), 'a', 'a')).toEqual(['a']);
    expect(reconstructPath(parentMap([['a', null]]), 'a', 'a')).toEqual(['a']);
  });

  it('returns null when the target was never reached by the search', () => {
    const parent = parentMap([
      ['a', null],
      ['b', 'a'],
    ]);
    expect(reconstructPath(parent, 'a', 'z')).toBeNull();
  });

  it('returns null when the chain dead-ends at null before reaching the source', () => {
    const parent = parentMap([
      ['a', null],
      ['b', null], // malformed: b claims to be a root but is not the source
      ['c', 'b'],
    ]);
    expect(reconstructPath(parent, 'a', 'c')).toBeNull();
  });

  it('returns null on a cyclic parent map instead of looping forever', () => {
    const parent = parentMap([
      ['a', null],
      ['b', 'c'],
      ['c', 'b'], // b <-> c cycle
    ]);
    expect(reconstructPath(parent, 'a', 'b')).toBeNull();
  });

  it('reconstructs long chains correctly', () => {
    const parent = new Map<string, string | null>();
    parent.set('v0', null);
    for (let i = 1; i < 100; i += 1) {
      parent.set(`v${i}`, `v${i - 1}`);
    }
    const path = reconstructPath(parent, 'v0', 'v99');
    expect(path).not.toBeNull();
    expect(path).toHaveLength(100);
    expect(path![0]).toBe('v0');
    expect(path![99]).toBe('v99');
  });

  it('works on a branched parent map (only the chosen branch matters)', () => {
    // a's best path is a-b-d; the search also discovered c, which is a dead end.
    const parent = parentMap([
      ['a', null],
      ['b', 'a'],
      ['c', 'a'],
      ['d', 'b'],
    ]);
    expect(reconstructPath(parent, 'a', 'd')).toEqual(['a', 'b', 'd']);
  });
});
