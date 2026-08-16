/** The three kinds of document this app issues. */
export type DocType = 'invoice' | 'proforma' | 'quote';

export const DOC_TYPES: DocType[] = ['invoice', 'proforma', 'quote'];

export function isDocType(v: string): v is DocType {
  return (DOC_TYPES as string[]).includes(v);
}

const LABELS: Record<DocType, string> = {
  invoice: 'Invoice',
  proforma: 'Pro forma invoice',
  quote: 'Quote',
};

export function docLabel(t: DocType): string {
  return LABELS[t];
}

export function docTitle(t: DocType): string {
  return LABELS[t].toUpperCase();
}

/**
 * The line a document must carry to avoid being mistaken for a tax invoice.
 * Null for a real invoice, which needs no disclaimer.
 */
export function docLegalLine(t: DocType): string | null {
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

/** "INV-0007" — the prefix, a hyphen, and the sequence zero-padded to four. */
export function formatDocNumber(prefix: string, seq: number): string {
  const p = prefix.trim() || 'DOC';
  return `${p}-${String(seq).padStart(4, '0')}`;
}
