import { describe, it, expect } from 'vitest';
import { billedWeekStarts, invoiceCountFor, type BillingEvidenceRow } from '../src/billing-evidence.js';

const row = (over: Partial<BillingEvidenceRow>): BillingEvidenceRow => ({
  clientId: 'c1',
  docType: 'invoice',
  prevBilledThroughMs: 0,
  ...over,
});

describe('billedWeekStarts', () => {
  it('marks a week billed for an invoice at that week start', () => {
    const rows = [row({ docType: 'invoice', prevBilledThroughMs: 1000 })];
    expect(billedWeekStarts(rows, 'c1')).toEqual(new Set([1000]));
  });

  it('does not mark a week billed for a quote at the same, week-aligned prevBilledThroughMs', () => {
    const rows = [row({ docType: 'quote', prevBilledThroughMs: 1000 })];
    expect(billedWeekStarts(rows, 'c1').has(1000)).toBe(false);
  });

  it('a quote does not shadow a real invoice for the same week', () => {
    const rows = [
      row({ docType: 'quote', prevBilledThroughMs: 1000 }),
      row({ docType: 'invoice', prevBilledThroughMs: 1000 }),
    ];
    expect(billedWeekStarts(rows, 'c1')).toEqual(new Set([1000]));
  });

  it('ignores rows for other clients', () => {
    const rows = [row({ clientId: 'other', docType: 'invoice', prevBilledThroughMs: 1000 })];
    expect(billedWeekStarts(rows, 'c1').size).toBe(0);
  });

  it('treats an empty docType as an invoice, so it still marks the week billed', () => {
    const rows = [row({ docType: '', prevBilledThroughMs: 1000 })];
    expect(billedWeekStarts(rows, 'c1')).toEqual(new Set([1000]));
  });
});

describe('invoiceCountFor', () => {
  it('is 0 for a client with only quotes and pro formas', () => {
    const rows = [
      row({ docType: 'quote' }),
      row({ docType: 'proforma' }),
    ];
    expect(invoiceCountFor(rows, 'c1')).toBe(0);
  });

  it('counts only the invoices for a client with both invoices and quotes', () => {
    const rows = [
      row({ docType: 'quote' }),
      row({ docType: 'invoice' }),
      row({ docType: 'invoice' }),
      row({ docType: 'proforma' }),
    ];
    expect(invoiceCountFor(rows, 'c1')).toBe(2);
  });

  it('ignores rows for other clients', () => {
    const rows = [row({ clientId: 'other', docType: 'invoice' })];
    expect(invoiceCountFor(rows, 'c1')).toBe(0);
  });

  it('counts a row with an empty docType as an invoice', () => {
    const rows = [row({ docType: '' })];
    expect(invoiceCountFor(rows, 'c1')).toBe(1);
  });
});
