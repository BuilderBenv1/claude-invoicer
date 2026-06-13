import type { ActivityInterval, FolderMapping } from './types.js';
import { basename, matchClientId, matchMapping } from './matcher.js';

export const MS_PER_HOUR = 3_600_000;
export const MS_PER_MIN = 60_000;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Round a duration up to the nearest increment (in minutes); returns minutes. */
export function roundMinutesUp(ms: number, incrementMin: number): number {
  const minutes = ms / MS_PER_MIN;
  if (incrementMin <= 0) return minutes;
  return Math.ceil(minutes / incrementMin) * incrementMin;
}

/**
 * Active ms of an interval that falls within [fromMs, toMs).
 * Relies on the engine invariant activeMs === endMs - startMs, so the clip is an
 * exact wall-clock split.
 */
export function activeWithin(interval: ActivityInterval, fromMs: number, toMs: number): number {
  const start = Math.max(interval.startMs, fromMs);
  const end = Math.min(interval.endMs, toMs);
  return Math.max(0, end - start);
}

/** Active ms of an interval strictly after `afterMs`. */
export function activeAfter(interval: ActivityInterval, afterMs: number): number {
  return activeWithin(interval, afterMs, Number.POSITIVE_INFINITY);
}

/**
 * The Monday (week start) date key, e.g. "2026-06-08", for the calendar week
 * containing `ms`, computed in the given IANA timezone.
 */
export function weekStartKey(ms: number, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const y = Number(get('year'));
  const mo = Number(get('month'));
  const d = Number(get('day'));
  const weekdayIdx: Record<string, number> = {
    Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  };
  const offset = weekdayIdx[get('weekday')] ?? 0;
  const base = Date.UTC(y, mo - 1, d) - offset * 86_400_000;
  const bd = new Date(base);
  const yy = bd.getUTCFullYear();
  const mm = String(bd.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(bd.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Offset (ms) to add to a UTC instant to get wall-clock time in `timeZone`. */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  let hour = Number(map.hour);
  if (hour === 24) hour = 0; // some environments render midnight as 24
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return asUTC - utcMs;
}

/** UTC ms of local midnight for a Y/M/D in the given timezone (two-pass for DST). */
export function zonedDateToMs(year: number, month: number, day: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day);
  let ms = guess - tzOffsetMs(guess, timeZone);
  ms = guess - tzOffsetMs(ms, timeZone);
  return ms;
}

/**
 * [startMs, endMs) for the calendar week (Mon 00:00 → next Mon 00:00, local tz)
 * identified by a Monday key "YYYY-MM-DD".
 */
export function weekRange(weekKey: string, timeZone: string): { startMs: number; endMs: number } {
  const [y, m, d] = weekKey.split('-').map(Number) as [number, number, number];
  const startMs = zonedDateToMs(y, m, d, timeZone);
  // +7 calendar days via Date.UTC handles month/year rollover; recompute local
  // midnight independently so DST shifts don't drift the boundary.
  const next = new Date(Date.UTC(y, m - 1, d + 7));
  const endMs = zonedDateToMs(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone);
  return { startMs, endMs };
}

export interface ClientAggregate {
  /** Active ms not yet covered by an invoice (after the reset mark). */
  unbilledMs: number;
  /** Active ms bucketed by week start key. */
  byWeek: Record<string, number>;
  /** Total active ms across all supplied intervals. */
  totalMs: number;
}

/** Aggregate a client's intervals into the unbilled balance and weekly buckets. */
export function aggregateIntervals(
  intervals: ActivityInterval[],
  opts: { billedThroughMs: number; timeZone: string },
): ClientAggregate {
  let unbilledMs = 0;
  let totalMs = 0;
  const byWeek: Record<string, number> = {};
  for (const it of intervals) {
    unbilledMs += activeAfter(it, opts.billedThroughMs);
    totalMs += it.activeMs;
    const k = weekStartKey(it.startMs, opts.timeZone);
    byWeek[k] = (byWeek[k] ?? 0) + it.activeMs;
  }
  return { unbilledMs, byWeek, totalMs };
}

export type GroupBy = 'total' | 'project' | 'week';

export interface InvoiceLineInput {
  /** Default hourly rate; per-folder mapping rates override it when present. */
  ratePerHour: number;
  roundIncrementMin: number;
  /** Reset mark: only time after this is billed. */
  billedThroughMs: number;
  /** Upper bound of the billing window (typically "now" at issue time). */
  cutoffMs: number;
  groupBy?: GroupBy;
  timeZone?: string;
  /** Used to label lines and resolve per-folder rates when grouping by project. */
  mappings?: FolderMapping[];
}

export interface InvoiceLine {
  label: string;
  /** Un-rounded active ms backing this line. */
  rawMs: number;
  /** Billable hours after rounding up. */
  hours: number;
  ratePerHour: number;
  amount: number;
}

/** Build rounded, priced invoice lines from a client's unbilled intervals. */
export function buildInvoiceLines(
  intervals: ActivityInterval[],
  input: InvoiceLineInput,
): InvoiceLine[] {
  const {
    ratePerHour,
    roundIncrementMin,
    billedThroughMs,
    cutoffMs,
    groupBy = 'total',
    timeZone = 'UTC',
    mappings = [],
  } = input;

  const groups = new Map<string, { ms: number; rate: number }>();
  for (const it of intervals) {
    const ms = activeWithin(it, billedThroughMs, cutoffMs);
    if (ms <= 0) continue;
    let label: string;
    let rate = ratePerHour;
    if (groupBy === 'week') {
      label = `Week of ${weekStartKey(it.startMs, timeZone)}`;
    } else if (groupBy === 'project') {
      const m = matchMapping(it.cwd, mappings);
      label = m ? m.label ?? basename(m.path) : basename(it.cwd);
      rate = m?.ratePerHour ?? ratePerHour;
    } else {
      label = 'Development work';
    }
    const g = groups.get(label);
    if (g) g.ms += ms;
    else groups.set(label, { ms, rate });
  }

  const lines: InvoiceLine[] = [];
  for (const [label, { ms, rate }] of groups) {
    const hours = round2(roundMinutesUp(ms, roundIncrementMin) / 60);
    lines.push({ label, rawMs: ms, hours, ratePerHour: rate, amount: round2(hours * rate) });
  }
  lines.sort((a, b) => (a.label < b.label ? -1 : 1));
  return lines;
}

export function invoiceSubtotal(lines: InvoiceLine[]): number {
  return round2(lines.reduce((s, l) => s + l.amount, 0));
}

/** Intervals that belong to a given client under the supplied mappings. */
export function intervalsForClient(
  intervals: ActivityInterval[],
  clientId: string,
  mappings: FolderMapping[],
): ActivityInterval[] {
  return intervals.filter((it) => matchClientId(it.cwd, mappings) === clientId);
}

export interface UnassignedFolder {
  cwd: string;
  activeMs: number;
  lastSeenMs: number;
}

/** Distinct folders not owned by any mapping, with totals — for the assign UI. */
export function unassignedFolders(
  intervals: ActivityInterval[],
  mappings: FolderMapping[],
): UnassignedFolder[] {
  const m = new Map<string, { activeMs: number; lastSeenMs: number }>();
  for (const it of intervals) {
    if (matchClientId(it.cwd, mappings) !== null) continue;
    const cur = m.get(it.cwd) ?? { activeMs: 0, lastSeenMs: 0 };
    cur.activeMs += it.activeMs;
    cur.lastSeenMs = Math.max(cur.lastSeenMs, it.endMs);
    m.set(it.cwd, cur);
  }
  return [...m.entries()]
    .map(([cwd, v]) => ({ cwd, activeMs: v.activeMs, lastSeenMs: v.lastSeenMs }))
    .sort((a, b) => b.lastSeenMs - a.lastSeenMs);
}
