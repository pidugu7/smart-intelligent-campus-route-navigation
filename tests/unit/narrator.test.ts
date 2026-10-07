/**
 * Unit tests for the plain-English narrator (app/narrator.ts).
 *
 * Guarantees:
 *   - every caption is derived only from the TraceEvent schema + names;
 *   - Guest mode never sees developer wording (no RELAX / FINALIZE /
 *     TRACE_EVENT / event-kind constants / "expanded" etc.);
 *   - the technical kind (Engineer mode) matches the schema exactly.
 */

import { describe, expect, it } from 'vitest';
import type { TraceEvent } from '../../src/engine/engine';
import {
  ALGO_PLAIN_DESCRIPTION,
  DFS_PLAIN_DESCRIPTION,
  narrateEvent,
  technicalEventKind,
} from '../../src/app/narrator';

const nameOf = (id: string): string =>
  ({ 'gate-main': 'Main Entrance', 'fountain-garden': 'Fountain Garden', 'pav-france': 'France' } as Record<string, string>)[id] ?? id;

const DEV_WORDS = [
  'relax',
  'RELAX',
  'finalize',
  'FINALIZE',
  'trace_event',
  'TRACE_EVENT',
  'TraceEvent',
  'visit',
  'VISIT',
  'abort',
  'ABORT',
  'start event',
  'expanded',
  'priority queue',
  'edge weight',
];

describe('narrateEvent — captions are plain English', () => {
  it('narrates the start event', () => {
    const ev: TraceEvent = { type: 'start', sourceId: 'gate-main' };
    expect(narrateEvent(ev, nameOf, 'dijkstra')).toBe('Starting from Main Entrance.');
  });

  it('narrates a Dijkstra visit with the running distance', () => {
    const ev: TraceEvent = { type: 'visit', vertexId: 'fountain-garden', bestDistance: 420 };
    expect(narrateEvent(ev, nameOf, 'dijkstra')).toBe(
      'Confirming the shortest known way to Fountain Garden: 420 m.',
    );
  });

  it('narrates an A* visit with different phrasing', () => {
    const ev: TraceEvent = { type: 'visit', vertexId: 'fountain-garden', bestDistance: 420 };
    expect(narrateEvent(ev, nameOf, 'astar')).toBe(
      'Locking in Fountain Garden — running total 420 m.',
    );
  });

  it('narrates a BFS visit in stops, not metres', () => {
    const ev: TraceEvent = { type: 'visit', vertexId: 'fountain-garden', bestDistance: 4 };
    expect(narrateEvent(ev, nameOf, 'bfs')).toBe(
      'Exploring Fountain Garden — 4 stops from the start.',
    );
    const one: TraceEvent = { type: 'visit', vertexId: 'fountain-garden', bestDistance: 1 };
    expect(narrateEvent(one, nameOf, 'bfs')).toBe(
      'Exploring Fountain Garden — 1 stop from the start.',
    );
  });

  it('narrates an improving relax as good news', () => {
    const ev: TraceEvent = {
      type: 'relax',
      fromId: 'fountain-garden',
      toId: 'pav-france',
      oldDistance: 900,
      newDistance: 780,
      improved: true,
    };
    expect(narrateEvent(ev, nameOf, 'dijkstra')).toBe('Found a shorter path to France.');
  });

  it('narrates a first sighting of a location', () => {
    const ev: TraceEvent = {
      type: 'relax',
      fromId: 'fountain-garden',
      toId: 'pav-france',
      oldDistance: null,
      newDistance: 540,
      improved: true,
    };
    expect(narrateEvent(ev, nameOf, 'dijkstra')).toBe('Noted the first route to France.');
  });

  it('narrates a non-improving relax without jargon', () => {
    const ev: TraceEvent = {
      type: 'relax',
      fromId: 'fountain-garden',
      toId: 'pav-france',
      oldDistance: 540,
      newDistance: 660,
      improved: false,
    };
    expect(narrateEvent(ev, nameOf, 'dijkstra')).toBe(
      'Checking Fountain Garden → France: the known route is still better.',
    );
  });

  it('narrates finalize with the total distance', () => {
    const ev: TraceEvent = { type: 'finalize', targetId: 'pav-france', totalDistance: 1010 };
    expect(narrateEvent(ev, nameOf, 'dijkstra')).toBe('Final route found: 1.01 km.');
  });

  it('narrates BFS finalize in stops', () => {
    const ev: TraceEvent = { type: 'finalize', targetId: 'pav-france', totalDistance: 10 };
    expect(narrateEvent(ev, nameOf, 'bfs')).toBe('Fewest-stop route found — 10 stops.');
  });

  it('narrates abort honestly', () => {
    const ev: TraceEvent = { type: 'abort', reason: 'unreachable' };
    expect(narrateEvent(ev, nameOf, 'dijkstra')).toBe(
      'No route found — the destination cannot be reached from here.',
    );
  });

  it('falls back to the raw id for unknown vertices (no fabrication)', () => {
    const ev: TraceEvent = { type: 'start', sourceId: 'mystery-node' };
    expect(narrateEvent(ev, nameOf, 'dijkstra')).toBe('Starting from mystery-node.');
  });
});

describe('narrateEvent — no developer wording leaks to Guest mode', () => {
  const events: TraceEvent[] = [
    { type: 'start', sourceId: 'gate-main' },
    { type: 'visit', vertexId: 'fountain-garden', bestDistance: 420 },
    {
      type: 'relax',
      fromId: 'fountain-garden',
      toId: 'pav-france',
      oldDistance: 900,
      newDistance: 780,
      improved: true,
    },
    {
      type: 'relax',
      fromId: 'fountain-garden',
      toId: 'pav-france',
      oldDistance: 540,
      newDistance: 660,
      improved: false,
    },
    { type: 'finalize', targetId: 'pav-france', totalDistance: 1010 },
    { type: 'abort', reason: 'unreachable' },
  ];

  for (const algo of ['dijkstra', 'astar', 'bfs'] as const) {
    it(`never mentions technical terms (${algo})`, () => {
      for (const ev of events) {
        const caption = narrateEvent(ev, nameOf, algo);
        for (const word of DEV_WORDS) {
          expect(caption.toLowerCase(), `${algo} caption "${caption}"` + ` must not contain "${word}"`).not.toContain(word.toLowerCase());
        }
      }
    });
  }
});

describe('technicalEventKind — schema-exact for Engineer mode', () => {
  it('matches every TraceEvent variant', () => {
    expect(technicalEventKind({ type: 'start', sourceId: 'a' })).toBe('START');
    expect(technicalEventKind({ type: 'visit', vertexId: 'a', bestDistance: 1 })).toBe('VISIT');
    expect(
      technicalEventKind({ type: 'relax', fromId: 'a', toId: 'b', oldDistance: null, newDistance: 1, improved: true }),
    ).toBe('RELAX');
    expect(technicalEventKind({ type: 'finalize', targetId: 'a', totalDistance: 5 })).toBe('FINALIZE');
    expect(technicalEventKind({ type: 'abort', reason: 'unreachable' })).toBe('ABORT');
  });
});

describe('algorithm flavor lines', () => {
  it('describes each routing algorithm in plain English', () => {
    expect(ALGO_PLAIN_DESCRIPTION.dijkstra).toBe('Selecting the closest unexplored location.');
    expect(ALGO_PLAIN_DESCRIPTION.astar).toBe('Choosing the location with the lowest estimated total cost.');
    expect(ALGO_PLAIN_DESCRIPTION.bfs).toBe('Exploring locations level by level.');
    expect(DFS_PLAIN_DESCRIPTION).toBe('Following this branch before backtracking.');
  });
});
