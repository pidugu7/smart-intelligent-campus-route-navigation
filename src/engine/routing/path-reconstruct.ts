/**
 * Reconstruct an ordered walking path from the predecessor (parent) map
 * that a graph search fills in while it relaxes edges.
 *
 * `parent.get(v)` is the vertex immediately before `v` on the best known
 * path from the source; the source itself maps to `null`.
 *
 * Algorithm: walk the parent pointers from target back to source, then
 * reverse the chain.
 *
 * Complexity: O(k) time and space where k is the number of vertices on the
 * path — each hop is a single O(1) hash-map lookup.
 *
 * Totality: the `visited` set is a cycle guard, so even a malformed parent
 * map cannot make this function loop forever — it returns null instead.
 *
 * @param parent   Predecessor map from a search run (sourceId maps to null).
 * @param sourceId Start of the desired walk.
 * @param targetId End of the desired walk.
 * @returns Vertex ids in walking order (source first, target last), or null
 *          when targetId has no predecessor chain back to sourceId.
 */
export function reconstructPath(
  parent: ReadonlyMap<string, string | null>,
  sourceId: string,
  targetId: string,
): string[] | null {
  const chain: string[] = [];
  const visited = new Set<string>();
  let cursor: string | null | undefined = targetId;

  while (cursor !== null && cursor !== undefined) {
    // Note: Set.prototype.add() returns the set itself (truthy), so the
    // duplicate check MUST go through has() — a classic footgun the
    // cycle test in path-reconstruct.test.ts guards against.
    if (visited.has(cursor)) {
      return null; // cycle in a malformed parent map
    }
    visited.add(cursor);
    chain.push(cursor);
    if (cursor === sourceId) {
      return chain.reverse();
    }
    cursor = parent.get(cursor);
  }
  // target was never entered by the search, or its chain does not reach source.
  return null;
}
