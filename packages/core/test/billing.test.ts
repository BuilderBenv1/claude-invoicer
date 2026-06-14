import { describe, it, expect } from 'vitest';
import {
  roundMinutesUp,
  weekStartKey,
  weekRange,
  aggregateIntervals,
  buildInvoiceLines,
  invoiceSubtotal,
  activeAfter,
  applyFolderCutoffs,
  intervalsForClient,
  unassignedFolders,
} from '../src/billing.js';
import type { ActivityInterval, FolderMapping } from '../src/types.js';

const MIN = 60_000;
const HOUR = 3_600_000;
const MON = Date.UTC(2026, 5, 8, 9, 0, 0); // Mon 2026-06-08 09:00 UTC

function interval(cwd: string, startMin: number, durMin: number, sessionId = 's'): ActivityInterval {
  const startMs = MON + startMin * MIN;
  const endMs = startMs + durMin * MIN;
  return { sessionId, cwd, startMs, endMs, activeMs: endMs - startMs };
}

describe('roundMinutesUp', () => {
  it('rounds any nonzero time up to the next increment', () => {
    expect(roundMinutesUp(1, 15)).toBe(15);
    expect(roundMinutesUp(16 * MIN, 15)).toBe(30);
    expect(roundMinutesUp(15 * MIN, 15)).toBe(15);
    expect(roundMinutesUp(0, 15)).toBe(0);
  });
  it('returns raw minutes when increment is 0 (no rounding)', () => {
    expect(roundMinutesUp(10 * MIN, 0)).toBe(10);
  });
});

describe('weekStartKey', () => {
  it('maps any day of the week to that week\'s Monday', () => {
    expect(weekStartKey(Date.UTC(2026, 5, 13, 23, 0), 'UTC')).toBe('2026-06-08'); // Sat
    expect(weekStartKey(Date.UTC(2026, 5, 14, 1, 0), 'UTC')).toBe('2026-06-08'); // Sun
    expect(weekStartKey(Date.UTC(2026, 5, 8, 0, 0), 'UTC')).toBe('2026-06-08'); // Mon
    expect(weekStartKey(Date.UTC(2026, 5, 15, 0, 0), 'UTC')).toBe('2026-06-15'); // next Mon
  });
});

describe('weekRange', () => {
  it('returns Mon 00:00 to next Mon 00:00 in UTC', () => {
    const { startMs, endMs } = weekRange('2026-06-08', 'UTC');
    expect(startMs).toBe(Date.UTC(2026, 5, 8, 0, 0, 0));
    expect(endMs).toBe(Date.UTC(2026, 5, 15, 0, 0, 0));
    expect(endMs - startMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('honors a non-UTC timezone (week starts at local midnight)', () => {
    // Asia/Jerusalem is UTC+3 in June (DST) -> local Mon 00:00 is Sun 21:00 UTC.
    const { startMs } = weekRange('2026-06-08', 'Asia/Jerusalem');
    expect(startMs).toBe(Date.UTC(2026, 5, 7, 21, 0, 0));
  });

  it('an interval is billable only within its week window', () => {
    const { startMs, endMs } = weekRange('2026-06-08', 'UTC');
    const inWeek = interval('C:/a', 0, 60); // Mon 09:00 UTC, inside
    const lines = buildInvoiceLines([inWeek], {
      ratePerHour: 60,
      roundIncrementMin: 1,
      billedThroughMs: startMs,
      cutoffMs: endMs,
      groupBy: 'total',
    });
    expect(lines[0]!.rawMs).toBe(60 * MIN);
  });
});

describe('aggregateIntervals', () => {
  it('computes the unbilled balance after the reset mark, splitting at the cutoff', () => {
    const it1 = interval('C:/a', 0, 60); // 09:00-10:00
    const billedThroughMs = MON + 30 * MIN; // 09:30 -> half is unbilled
    const agg = aggregateIntervals([it1], { billedThroughMs, timeZone: 'UTC' });
    expect(agg.unbilledMs).toBe(30 * MIN);
    expect(agg.totalMs).toBe(60 * MIN);
  });

  it('buckets active time by week', () => {
    const thisWeek = interval('C:/a', 0, 60); // week of 06-08
    const nextWeek = interval('C:/a', 7 * 24 * 60, 30); // +7 days -> week of 06-15
    const agg = aggregateIntervals([thisWeek, nextWeek], { billedThroughMs: 0, timeZone: 'UTC' });
    expect(agg.byWeek['2026-06-08']).toBe(60 * MIN);
    expect(agg.byWeek['2026-06-15']).toBe(30 * MIN);
  });
});

describe('activeAfter', () => {
  it('returns only the portion after the mark', () => {
    const it1 = interval('C:/a', 0, 60);
    expect(activeAfter(it1, MON + 45 * MIN)).toBe(15 * MIN);
    expect(activeAfter(it1, MON + 120 * MIN)).toBe(0);
    expect(activeAfter(it1, 0)).toBe(60 * MIN);
  });
});

describe('buildInvoiceLines', () => {
  it('rounds the summed time up per group and prices it', () => {
    const intervals = [interval('C:/a', 0, 50), interval('C:/a', 100, 20)]; // 70 min total
    const lines = buildInvoiceLines(intervals, {
      ratePerHour: 100,
      roundIncrementMin: 15,
      billedThroughMs: 0,
      cutoffMs: Number.POSITIVE_INFINITY,
      groupBy: 'total',
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.hours).toBe(1.25); // 70 -> 75 min -> 1.25h
    expect(lines[0]!.amount).toBe(125);
    expect(invoiceSubtotal(lines)).toBe(125);
  });

  it('groups by project using mappings', () => {
    const mappings: FolderMapping[] = [
      { clientId: 'c', path: 'C:/work/acme', label: 'Acme' },
      { clientId: 'c', path: 'C:/work/beta', label: 'Beta' },
    ];
    const intervals = [
      interval('C:/work/acme/app', 0, 30),
      interval('C:/work/beta/api', 100, 30),
    ];
    const lines = buildInvoiceLines(intervals, {
      ratePerHour: 80,
      roundIncrementMin: 15,
      billedThroughMs: 0,
      cutoffMs: Number.POSITIVE_INFINITY,
      groupBy: 'project',
      mappings,
    });
    expect(lines.map((l) => l.label)).toEqual(['Acme', 'Beta']);
    expect(lines.every((l) => l.hours === 0.5)).toBe(true);
  });

  it('applies per-folder rate overrides, falling back to the default', () => {
    const mappings: FolderMapping[] = [
      { clientId: 'c', path: 'C:/work/site', label: 'Website', ratePerHour: 50 },
      { clientId: 'c', path: 'C:/work/api', label: 'API', ratePerHour: 30 },
      { clientId: 'c', path: 'C:/work/misc', label: 'Misc' }, // no override -> default
    ];
    const intervals = [
      interval('C:/work/site/x', 0, 60),
      interval('C:/work/api/y', 100, 60),
      interval('C:/work/misc/z', 200, 60),
    ];
    const lines = buildInvoiceLines(intervals, {
      ratePerHour: 100,
      roundIncrementMin: 15,
      billedThroughMs: 0,
      cutoffMs: Number.POSITIVE_INFINITY,
      groupBy: 'project',
      mappings,
    });
    const byLabel = Object.fromEntries(lines.map((l) => [l.label, l]));
    expect(byLabel['Website']!.ratePerHour).toBe(50);
    expect(byLabel['Website']!.amount).toBe(50);
    expect(byLabel['API']!.ratePerHour).toBe(30);
    expect(byLabel['API']!.amount).toBe(30);
    expect(byLabel['Misc']!.ratePerHour).toBe(100);
    expect(byLabel['Misc']!.amount).toBe(100);
  });

  it('only bills time within (billedThrough, cutoff]', () => {
    const intervals = [interval('C:/a', 0, 60)]; // 09:00-10:00, 60 min
    const lines = buildInvoiceLines(intervals, {
      ratePerHour: 100,
      roundIncrementMin: 1,
      billedThroughMs: MON + 20 * MIN, // skip first 20
      cutoffMs: MON + 50 * MIN, // stop at 50 -> bill 30 min
      groupBy: 'total',
    });
    expect(lines[0]!.rawMs).toBe(30 * MIN);
  });
});

describe('multi-invoice reset', () => {
  it('a second invoice only counts time after the advanced reset mark', () => {
    const intervals = [interval('C:/a', 0, 120)]; // 2h continuous
    // First invoice covers up to 09:60 (60 min in)
    const firstCutoff = MON + 60 * MIN;
    const first = buildInvoiceLines(intervals, {
      ratePerHour: 100, roundIncrementMin: 15, billedThroughMs: 0, cutoffMs: firstCutoff,
    });
    expect(first[0]!.rawMs).toBe(60 * MIN);

    // billed_through advances to firstCutoff; second invoice bills the remainder
    const agg2 = aggregateIntervals(intervals, { billedThroughMs: firstCutoff, timeZone: 'UTC' });
    expect(agg2.unbilledMs).toBe(60 * MIN);
  });
});

describe('applyFolderCutoffs', () => {
  it('clips only the targeted folder, leaving others intact', () => {
    const cutoff = MON + 30 * MIN;
    const mappings: FolderMapping[] = [
      { clientId: 'c', path: 'C:/work/site', billFromMs: cutoff }, // cut this folder
      { clientId: 'c', path: 'C:/work/api' }, // leave this one
    ];
    const intervals = [
      interval('C:/work/site/x', 0, 60), // 09:00-10:00 -> clipped to 09:30-10:00
      interval('C:/work/api/y', 0, 60), // untouched
    ];
    const out = applyFolderCutoffs(intervals, mappings);
    const site = out.find((i) => i.cwd.includes('site'))!;
    const api = out.find((i) => i.cwd.includes('api'))!;
    expect(site.startMs).toBe(cutoff);
    expect(site.activeMs).toBe(30 * MIN);
    expect(site.activeMs).toBe(site.endMs - site.startMs); // invariant holds
    expect(api.activeMs).toBe(60 * MIN); // other folder unaffected
  });

  it('drops intervals entirely before their folder cutoff', () => {
    const mappings: FolderMapping[] = [{ clientId: 'c', path: 'C:/work/site', billFromMs: MON + 120 * MIN }];
    const out = applyFolderCutoffs([interval('C:/work/site/x', 0, 60)], mappings);
    expect(out).toHaveLength(0);
  });
});

describe('client filtering + unassigned discovery', () => {
  const mappings: FolderMapping[] = [{ clientId: 'acme', path: 'C:/work/acme' }];
  const intervals = [
    interval('C:/work/acme/app', 0, 30),
    interval('C:/personal/hackmonty', 60, 45),
  ];

  it('selects only the client\'s intervals', () => {
    expect(intervalsForClient(intervals, 'acme', mappings)).toHaveLength(1);
  });

  it('surfaces unmapped folders for assignment, never billing them', () => {
    const u = unassignedFolders(intervals, mappings);
    expect(u).toHaveLength(1);
    expect(u[0]!.cwd).toBe('C:/personal/hackmonty');
    expect(u[0]!.activeMs).toBe(45 * MIN);
  });
});
