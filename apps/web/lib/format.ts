const MS_PER_MIN = 60_000;

/** "3h 25m" / "45m" from milliseconds. */
export function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / MS_PER_MIN);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** Decimal hours, e.g. 1.25. */
export function hoursFromMs(ms: number): number {
  return Math.round((ms / 3_600_000) * 100) / 100;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatDate(d: Date | string | number, timeZone = 'UTC'): string {
  const date = d instanceof Date ? d : new Date(d);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
}

/** "Mon, Jun 08" — day-of-week + short date in the given timezone. */
export function formatDayLabel(ms: number, timeZone = 'UTC'): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: '2-digit',
  }).format(new Date(ms));
}

/** "09:14–10:02" — start–end clock time in the given timezone. */
export function formatTimeRange(startMs: number, endMs: number, timeZone = 'UTC'): string {
  const t = (ms: number) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ms));
  return `${t(startMs)}–${t(endMs)}`;
}

/** New unique id (uses Web Crypto, available in Node 20+ and browsers). */
export function newId(): string {
  return crypto.randomUUID();
}
