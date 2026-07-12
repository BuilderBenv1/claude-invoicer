import { round2 } from './util';

export const MS_PER_HOUR = 3_600_000;
export const MS_PER_MIN = 60_000;

/** Raw hours for a duration in ms, rounded to 2 decimals. */
export function hoursOf(durationMs: number): number {
  return round2(durationMs / MS_PER_HOUR);
}

/**
 * Billable hours: round the duration UP to the next `incrementMin` block
 * (the legal convention — a 3-minute call on a 6-minute increment bills 0.1h).
 * A zero-length entry bills nothing.
 */
export function billableHours(durationMs: number, incrementMin: number): number {
  if (durationMs <= 0) return 0;
  const inc = incrementMin > 0 ? incrementMin : 1;
  const blocks = Math.ceil(durationMs / MS_PER_MIN / inc);
  return round2((blocks * inc) / 60);
}

/** "1:05:09" style H:MM:SS from a duration in ms. */
export function formatClock(durationMs: number): string {
  const total = Math.max(0, Math.floor(durationMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(s)}`;
}

/** "2h 05m" style human duration. */
export function formatHm(durationMs: number): string {
  const total = Math.max(0, Math.floor(durationMs / MS_PER_MIN));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** "YYYY-MM" key for a date, in the given timezone. */
export function monthKey(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(d);
  return parts; // en-CA yields "YYYY-MM"
}

/** "YYYY-MM-DD" day key in the given timezone. */
export function dayKey(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/**
 * Epoch-ms bounds [startMs, endMs) for a "YYYY-MM" month in a timezone.
 * Computed by finding the timezone offset at the month's midpoint — good enough
 * for report windows (DST shifts at most an hour at the edges).
 */
export function monthRange(key: string, timeZone: string): { startMs: number; endMs: number; label: string } {
  const [y, m] = key.split('-').map(Number);
  const year = y ?? new Date().getUTCFullYear();
  const month = (m ?? 1) - 1;
  const startUtc = Date.UTC(year, month, 1, 0, 0, 0);
  const nextUtc = Date.UTC(month === 11 ? year + 1 : year, (month + 1) % 12, 1, 0, 0, 0);
  const offset = tzOffsetMs(new Date((startUtc + nextUtc) / 2), timeZone);
  return { startMs: startUtc - offset, endMs: nextUtc - offset, label: key };
}

/** The previous month's "YYYY-MM" key relative to `now` in a timezone. */
export function prevMonthKey(now: Date, timeZone: string): string {
  const cur = monthKey(now, timeZone);
  const [y, m] = cur.split('-').map(Number);
  const year = y ?? now.getUTCFullYear();
  const month = m ?? 1;
  const py = month === 1 ? year - 1 : year;
  const pm = month === 1 ? 12 : month - 1;
  return `${py}-${String(pm).padStart(2, '0')}`;
}

/** Epoch ms at 00:00 of the day containing `ms`, in `timeZone`. */
export function startOfDayMs(ms: number, timeZone: string): number {
  const [y, m, d] = dayKey(ms, timeZone).split('-').map(Number);
  const utcMidnight = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0);
  const offset = tzOffsetMs(new Date(utcMidnight + 12 * MS_PER_HOUR), timeZone);
  return utcMidnight - offset;
}

/** Epoch ms at the start of the current week (Sunday, Israeli convention). */
export function startOfWeekMs(ms: number, timeZone: string): number {
  const dayStart = startOfDayMs(ms, timeZone);
  const [y, m, d] = dayKey(ms, timeZone).split('-').map(Number);
  const dow = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay(); // 0 = Sunday
  return dayStart - dow * 24 * MS_PER_HOUR;
}

/** Epoch ms at the start of the current month, in `timeZone`. */
export function startOfMonthMs(ms: number, timeZone: string): number {
  return monthRange(monthKey(new Date(ms), timeZone), timeZone).startMs;
}

/** Milliseconds that `timeZone` is ahead of UTC at instant `at`. */
function tzOffsetMs(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}
