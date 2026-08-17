import { isBillingEvidence } from './documents.js';

/**
 * Minimal structural shape billedWeekStarts/invoiceCountFor need from an
 * invoice row. Kept narrow so this file has no dependency on the DB schema —
 * apps/web passes its Drizzle `Invoice` rows straight in.
 */
export interface BillingEvidenceRow {
  clientId: string;
  docType: string;
  prevBilledThroughMs: number;
}

/**
 * Set of already-invoiced week-start ms for a client. A week invoice records
 * its window start in `prevBilledThroughMs`, so a week is "billed" if any
 * invoice for that client starts at that week's start. A quote or pro forma
 * for a client must never mark their week billed — the real work would then
 * never be invoiced.
 */
export function billedWeekStarts(rows: BillingEvidenceRow[], clientId: string): Set<number> {
  const set = new Set<number>();
  for (const r of rows) {
    if (r.clientId === clientId && isBillingEvidence(r.docType)) set.add(r.prevBilledThroughMs);
  }
  return set;
}

/**
 * How many real invoices a client has. Quotes and pro formas do not count —
 * a client you only ever quoted has no billing history worth protecting.
 */
export function invoiceCountFor(rows: BillingEvidenceRow[], clientId: string): number {
  return rows.filter((r) => r.clientId === clientId && isBillingEvidence(r.docType)).length;
}
