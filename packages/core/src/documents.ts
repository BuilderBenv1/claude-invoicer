/** The three kinds of document this app issues. */
export type DocType = 'invoice' | 'proforma' | 'quote';

export const DOC_TYPES: DocType[] = ['invoice', 'proforma', 'quote'];

export function isDocType(v: string): v is DocType {
  return (DOC_TYPES as string[]).includes(v);
}

const LABELS: Record<string, string> = {
  invoice: 'Invoice',
  proforma: 'Pro forma invoice',
  quote: 'Quote',
};

/** An unrecognised or empty type is labelled as an invoice — matches isBillingEvidence's direction. */
export function docLabel(t: string): string {
  return LABELS[t] ?? 'Invoice';
}

export function docTitle(t: string): string {
  return docLabel(t).toUpperCase();
}

/**
 * The line a document must carry to avoid being mistaken for a tax invoice.
 * Null for a real invoice (and for an unrecognised type, which is treated as
 * one), which needs no disclaimer.
 */
export function docLegalLine(t: string): string | null {
  if (t === 'proforma') {
    return 'This is a pro forma invoice and is not a VAT or tax invoice. A tax invoice will follow on payment.';
  }
  if (t === 'quote') return 'This is a quotation, not a request for payment.';
  return null;
}

/**
 * Whether a row counts as proof that work has been billed: revenue and unpaid
 * totals, the billed-weeks set, and the client-delete guard all depend on this.
 * An unknown or empty type counts as evidence so that a legacy row — or a type
 * added later without updating this file — is never silently dropped from the
 * accounts. Being wrongly counted is recoverable; being wrongly ignored means
 * double-billing a client.
 */
export function isBillingEvidence(t: string): boolean {
  return t !== 'proforma' && t !== 'quote';
}

/** Only a real invoice can be marked paid and receive a receipt. */
export function canBePaid(t: string): boolean {
  return isBillingEvidence(t);
}

/**
 * The label above the payable amount. A pro forma does request payment, so
 * "Total due" would be defensible — "Total payable" is used instead so it
 * reads correctly on a document that is not yet a tax invoice. A quote uses
 * "Quoted total" since nothing is owed yet. An unrecognised type falls back
 * to "Total due", matching isBillingEvidence's direction.
 */
export function totalLabel(t: string): string {
  if (t === 'quote') return 'Quoted total';
  if (t === 'proforma') return 'Total payable';
  return 'Total due';
}

/**
 * The rule the UI actually means by "does this ask to be paid" — true for
 * everything except a quote. Follows the denylist direction shared with
 * isBillingEvidence: an unrecognised type IS a request for payment.
 */
export function isRequestForPayment(t: string): boolean {
  return t !== 'quote';
}

/**
 * True only when the three document-number prefixes are pairwise distinct
 * (trimmed, case-insensitive). Two document types sharing a prefix would
 * either collide on a number or silently interleave into the same sequence.
 */
export function prefixesAreDistinct(invoice: string, quote: string, proforma: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  const i = norm(invoice);
  const q = norm(quote);
  const p = norm(proforma);
  return i !== q && i !== p && q !== p;
}

/** "INV-0007" — the prefix, a hyphen, and the sequence zero-padded to four. */
export function formatDocNumber(prefix: string, seq: number): string {
  const p = prefix.trim() || 'DOC';
  return `${p}-${String(seq).padStart(4, '0')}`;
}
