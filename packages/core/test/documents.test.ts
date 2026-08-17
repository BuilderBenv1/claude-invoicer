import { describe, it, expect } from 'vitest';
import {
  DOC_TYPES,
  canBePaid,
  docLabel,
  docLegalLine,
  docTitle,
  formatDocNumber,
  isBillingEvidence,
  isDocType,
  isRequestForPayment,
  prefixesAreDistinct,
  totalLabel,
} from '../src/documents.js';

describe('DOC_TYPES', () => {
  it('lists exactly the three supported types', () => {
    expect(DOC_TYPES).toEqual(['invoice', 'proforma', 'quote']);
  });
});

describe('isDocType', () => {
  it('accepts the three known types', () => {
    expect(isDocType('invoice')).toBe(true);
    expect(isDocType('proforma')).toBe(true);
    expect(isDocType('quote')).toBe(true);
  });
  it('rejects anything else, including an empty string', () => {
    expect(isDocType('receipt')).toBe(false);
    expect(isDocType('')).toBe(false);
    expect(isDocType('INVOICE')).toBe(false);
  });
});

describe('docLabel and docTitle', () => {
  it('names each type for the UI', () => {
    expect(docLabel('invoice')).toBe('Invoice');
    expect(docLabel('proforma')).toBe('Pro forma invoice');
    expect(docLabel('quote')).toBe('Quote');
  });
  it('gives the PDF an uppercase heading', () => {
    expect(docTitle('invoice')).toBe('INVOICE');
    expect(docTitle('proforma')).toBe('PRO FORMA INVOICE');
    expect(docTitle('quote')).toBe('QUOTE');
  });
  it('labels an unrecognised or empty type as an invoice rather than rendering blank', () => {
    expect(docLabel('')).toBe('Invoice');
    expect(docLabel('something-new')).toBe('Invoice');
    expect(docTitle('something-new')).toBe('INVOICE');
  });
});

describe('docLegalLine', () => {
  it('says nothing extra on a real invoice', () => {
    expect(docLegalLine('invoice')).toBeNull();
  });
  it('states a pro forma is not a tax invoice', () => {
    expect(docLegalLine('proforma')).toBe(
      'This is a pro forma invoice and is not a VAT or tax invoice. A tax invoice will follow on payment.',
    );
  });
  it('states a quote is not a request for payment', () => {
    expect(docLegalLine('quote')).toBe('This is a quotation, not a request for payment.');
  });
  it('says nothing extra on an unrecognised type, matching the invoice treatment', () => {
    expect(docLegalLine('something-new')).toBeNull();
    expect(docLegalLine('')).toBeNull();
  });
});

describe('isBillingEvidence', () => {
  it('is true only for a real invoice', () => {
    expect(isBillingEvidence('invoice')).toBe(true);
    expect(isBillingEvidence('proforma')).toBe(false);
    expect(isBillingEvidence('quote')).toBe(false);
  });
  it('treats an unknown or empty type as evidence, so legacy rows are never lost', () => {
    expect(isBillingEvidence('')).toBe(true);
    expect(isBillingEvidence('something-new')).toBe(true);
  });
});

describe('canBePaid', () => {
  it('is true only for a real invoice', () => {
    expect(canBePaid('invoice')).toBe(true);
    expect(canBePaid('proforma')).toBe(false);
    expect(canBePaid('quote')).toBe(false);
  });
  it('treats an unknown type as payable, matching isBillingEvidence', () => {
    expect(canBePaid('')).toBe(true);
  });
});

describe('formatDocNumber', () => {
  it('zero-pads the sequence to four digits', () => {
    expect(formatDocNumber('INV', 7)).toBe('INV-0007');
    expect(formatDocNumber('QUO', 1)).toBe('QUO-0001');
  });
  it('does not truncate a sequence past four digits', () => {
    expect(formatDocNumber('INV', 12345)).toBe('INV-12345');
  });
  it('trims a prefix and falls back when it is blank', () => {
    expect(formatDocNumber('  PF  ', 3)).toBe('PF-0003');
    expect(formatDocNumber('', 3)).toBe('DOC-0003');
  });
});

describe('totalLabel', () => {
  it('names the payable-amount label per type', () => {
    expect(totalLabel('invoice')).toBe('Total due');
    expect(totalLabel('proforma')).toBe('Total payable');
    expect(totalLabel('quote')).toBe('Quoted total');
  });
  it('falls back to "Total due" for an unrecognised type, matching isBillingEvidence', () => {
    expect(totalLabel('')).toBe('Total due');
    expect(totalLabel('something-new')).toBe('Total due');
  });
});

describe('isRequestForPayment', () => {
  it('is false only for a quote', () => {
    expect(isRequestForPayment('invoice')).toBe(true);
    expect(isRequestForPayment('proforma')).toBe(true);
    expect(isRequestForPayment('quote')).toBe(false);
  });
  it('treats an unknown or empty type as a request for payment', () => {
    expect(isRequestForPayment('')).toBe(true);
    expect(isRequestForPayment('something-new')).toBe(true);
  });
});

describe('prefixesAreDistinct', () => {
  it('is true when all three differ', () => {
    expect(prefixesAreDistinct('INV', 'QUO', 'PF')).toBe(true);
  });
  it('is false when any two coincide, case-insensitively and ignoring surrounding whitespace', () => {
    expect(prefixesAreDistinct('INV', 'INV', 'PF')).toBe(false);
    expect(prefixesAreDistinct('INV', 'QUO', 'inv')).toBe(false);
    expect(prefixesAreDistinct('INV', ' inv ', 'PF')).toBe(false);
    expect(prefixesAreDistinct('INV', 'QUO', 'quo')).toBe(false);
  });
});
