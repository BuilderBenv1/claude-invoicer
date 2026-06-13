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

/** New unique id (uses Web Crypto, available in Node 20+ and browsers). */
export function newId(): string {
  return crypto.randomUUID();
}
