import { describe, it, expect } from 'vitest';
import { weekProjectDayGrid } from '../src/billing.js';
import type { ActivityInterval, FolderMapping } from '../src/types.js';

const MIN = 60_000;
const MON = Date.UTC(2026, 5, 8, 0, 0, 0); // Mon 2026-06-08 00:00 UTC (week start)

// startMin measured from Monday 00:00 UTC.
function iv(cwd: string, startMin: number, durMin: number): ActivityInterval {
  const startMs = MON + startMin * MIN;
  const endMs = startMs + durMin * MIN;
  return { sessionId: 's', cwd, startMs, endMs, activeMs: endMs - startMs };
}
const maps: FolderMapping[] = [
  { clientId: 'c', path: '/work/acme', label: 'Acme' },
  { clientId: 'c', path: '/work/beta' },
];

describe('weekProjectDayGrid', () => {
  it('lays out 7 Mon→Sun columns with dates and weekday labels', () => {
    const g = weekProjectDayGrid([], '2026-06-08', 'UTC', maps);
    expect(g.columns.map((c) => c.weekday)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(g.columns[0]!.dayKey).toBe('2026-06-08');
    expect(g.columns[6]!.dayKey).toBe('2026-06-14');
    expect(g.rows).toEqual([]);
    expect(g.grandTotal).toBe(0);
    expect(g.dayTotals).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('buckets hours per project per day and totals them', () => {
    // Acme: 60m Mon (09:00) + 30m Tue (09:00). Beta: 90m Mon.
    const g = weekProjectDayGrid(
      [iv('/work/acme', 9 * 60, 60), iv('/work/acme', 24 * 60 + 9 * 60, 30), iv('/work/beta', 10 * 60, 90)],
      '2026-06-08',
      'UTC',
      maps,
    );
    // rows sorted by label: Acme, then beta's basename
    expect(g.rows.map((r) => r.label)).toEqual(['Acme', 'beta']);
    const acme = g.rows[0]!;
    expect(acme.hoursByDay).toEqual([1, 0.5, 0, 0, 0, 0, 0]);
    expect(acme.total).toBe(1.5);
    const beta = g.rows[1]!;
    expect(beta.hoursByDay[0]).toBe(1.5);
    expect(beta.total).toBe(1.5);
    expect(g.dayTotals[0]).toBe(2.5); // Mon: 1 (acme) + 1.5 (beta)
    expect(g.grandTotal).toBe(3);
  });

  it('splits a session that crosses midnight across two days', () => {
    // Mon 23:30 for 60m -> 30m Mon, 30m Tue
    const g = weekProjectDayGrid([iv('/work/acme', 23 * 60 + 30, 60)], '2026-06-08', 'UTC', maps);
    expect(g.rows[0]!.hoursByDay[0]).toBe(0.5);
    expect(g.rows[0]!.hoursByDay[1]).toBe(0.5);
    expect(g.rows[0]!.total).toBe(1);
  });

  it('labels unmapped folders by basename', () => {
    const g = weekProjectDayGrid([iv('/some/other', 9 * 60, 60)], '2026-06-08', 'UTC', maps);
    expect(g.rows[0]!.label).toBe('other');
  });
});
