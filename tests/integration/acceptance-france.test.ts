/**
 * Acceptance anchor — the user-specified "no-regression" pin for the visual
 * overhaul work (and the default demo query):
 *
 *   Dijkstra, Main Entrance (gate-main) → France Pavilion (pav-france)
 *     - distance 874 m
 *     - 27 nodes expanded
 *     - 62 trace events
 *     - 9 edges on the path (10 vertices)
 *
 * If this test fails, routing behaviour changed — that is a defect for the
 * visual work (the engine and dataset are frozen).
 */

import { describe, expect, it } from 'vitest';
import epcot from '../../src/data/datasets/epcot/dataset.json';
import { loadDataset } from '../../src/data/loader';
import { dijkstra, findRoute } from '../../src/engine/engine';

const loaded = loadDataset(epcot);
const graph = loaded.graph;

describe('acceptance anchor: gate-main → pav-france (Dijkstra)', () => {
  it('pins 874 m / 27 expansions / 62 trace events / 9 edges', () => {
    const run = dijkstra(graph, 'gate-main', { targetId: 'pav-france' });

    expect(run.distances.get('pav-france')).toBe(874);
    expect(run.nodesExpanded).toBe(27);
    expect(run.trace.length).toBe(62);

    // Reconstruct the path and count edges.
    const path: string[] = [];
    let cur: string | undefined = 'pav-france';
    while (cur !== undefined) {
      path.unshift(cur);
      if (cur === 'gate-main') break;
      cur = run.parent.get(cur) ?? undefined;
    }
    expect(path[0]).toBe('gate-main');
    expect(path[path.length - 1]).toBe('pav-france');
    expect(path.length - 1).toBe(9); // 9 edges

    // The public routing API agrees (same cost, same path).
    const result = findRoute(graph, 'gate-main', 'pav-france', 'dijkstra');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.path.join(' ')).toBe(path.join(' '));
    }
  });
});
