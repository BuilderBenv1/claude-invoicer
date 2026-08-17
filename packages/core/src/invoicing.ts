import { round2, zonedDateToMs } from './billing.js';

export interface InvoiceTotals {
  /** Net of tax. */
  subtotal: number;
  /** Percentage, e.g. 20 for 20% VAT. */
  taxRate: number;
  taxAmount: number;
  /** The payable figure: subtotal + taxAmount. */
  total: number;
}

/**
 * Split a net subtotal into tax and payable total. The rate is a PERCENTAGE
 * (20 = 20%). A missing, negative or non-finite rate means no tax, so a bad
 * settings value can never credit tax back to a client.
 */
export function computeTotals(subtotal: number, taxRate: number): InvoiceTotals {
  const rate = Number.isFinite(taxRate) && taxRate > 0 ? taxRate : 0;
  const taxAmount = round2(subtotal * (rate / 100));
  return { subtotal: round2(subtotal), taxRate: rate, taxAmount, total: round2(round2(subtotal) + taxAmount) };
}

/** The Y/M/D of a UTC instant as seen in `timeZone`. */
function zonedYMD(ms: number, timeZone: string): { y: number; m: number; d: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/**
 * Payment due date, or null when the terms are zero or nonsensical (due on receipt).
 * Means the END of the due day in the business timezone: the calendar date
 * `termsDays` days after `issuedAt` (as seen in `timeZone`), through its last
 * instant. Computed via calendar-day arithmetic (not fixed ms), so it neither
 * drifts across a DST transition nor flips to true on its own due date.
 */
export function dueDateFrom(issuedAt: Date, termsDays: number, timeZone: string): Date | null {
  if (!Number.isFinite(termsDays) || termsDays <= 0) return null;
  const days = Math.floor(termsDays);
  const { y, m, d } = zonedYMD(issuedAt.getTime(), timeZone);
  // Day after the due day, via UTC placeholder arithmetic (handles month/year
  // rollover), then re-anchored to the timezone — same pattern as weekRange.
  const nextDay = new Date(Date.UTC(y, m - 1, d + days + 1));
  const endOfDueDayMs =
    zonedDateToMs(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), timeZone) - 1;
  return new Date(endOfDueDayMs);
}

/** Unpaid and past its due date. Derived on read — never stored. */
export function isOverdue(status: string, dueAt: Date | null, nowMs: number): boolean {
  if (status === 'paid' || !dueAt) return false;
  return dueAt.getTime() < nowMs;
}
