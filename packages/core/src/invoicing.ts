import { round2 } from './billing.js';

const MS_PER_DAY = 86_400_000;

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

/** Payment due date, or null when the terms are zero or nonsensical (due on receipt). */
export function dueDateFrom(issuedAt: Date, termsDays: number): Date | null {
  if (!Number.isFinite(termsDays) || termsDays <= 0) return null;
  return new Date(issuedAt.getTime() + Math.floor(termsDays) * MS_PER_DAY);
}

/** Unpaid and past its due date. Derived on read — never stored. */
export function isOverdue(status: string, dueAt: Date | null, nowMs: number): boolean {
  if (status === 'paid' || !dueAt) return false;
  return dueAt.getTime() < nowMs;
}
