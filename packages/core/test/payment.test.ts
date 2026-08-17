import { describe, it, expect } from 'vitest';
import { DEFAULT_ACCOUNT_KEY, renderPaymentBlock, resolvePaymentAccount } from '../src/payment.js';
import type { PaymentAccount } from '../src/payment.js';

const gbp: PaymentAccount = {
  currency: 'GBP',
  accountName: 'The Automation Agency Ltd',
  bankName: 'Monzo',
  sortCode: '04-00-04',
  accountNumber: '12345678',
};
const fallback: PaymentAccount = {
  currency: DEFAULT_ACCOUNT_KEY,
  accountName: 'The Automation Agency Ltd',
  iban: 'GB00MONZ00000012345678',
  bic: 'MONZGB2L',
};

describe('resolvePaymentAccount', () => {
  it('prefers an exact currency match', () => {
    expect(resolvePaymentAccount([fallback, gbp], 'GBP')).toBe(gbp);
  });
  it('matches the currency case-insensitively', () => {
    expect(resolvePaymentAccount([fallback, gbp], 'gbp')).toBe(gbp);
  });
  it('falls back to the default account when the currency has none', () => {
    expect(resolvePaymentAccount([fallback, gbp], 'USD')).toBe(fallback);
  });
  it('returns null when there is neither a match nor a default', () => {
    expect(resolvePaymentAccount([gbp], 'USD')).toBeNull();
  });
  it('returns null for an empty list', () => {
    expect(resolvePaymentAccount([], 'GBP')).toBeNull();
  });
});

describe('renderPaymentBlock', () => {
  it('returns an empty string when there is no account, so nothing is printed', () => {
    expect(renderPaymentBlock(null, 'INV-0007')).toBe('');
  });
  it('lists only the fields that are filled in, labelled', () => {
    expect(renderPaymentBlock(gbp, 'INV-0007')).toBe(
      [
        'The Automation Agency Ltd',
        'Monzo',
        'Sort code: 04-00-04',
        'Account number: 12345678',
        'Payment reference: INV-0007',
      ].join('\n'),
    );
  });
  it('renders international fields when those are the ones present', () => {
    expect(renderPaymentBlock(fallback, 'INV-0008')).toBe(
      [
        'The Automation Agency Ltd',
        'IBAN: GB00MONZ00000012345678',
        'BIC: MONZGB2L',
        'Payment reference: INV-0008',
      ].join('\n'),
    );
  });
  it('always ends with the payment reference, even for a bare account', () => {
    expect(renderPaymentBlock({ currency: 'GBP' }, 'INV-0009')).toBe('Payment reference: INV-0009');
  });
  it('includes free-text notes last, before the reference', () => {
    const withNotes: PaymentAccount = { currency: 'GBP', accountName: 'A', notes: 'Wise: wise.com/pay/abc' };
    expect(renderPaymentBlock(withNotes, 'INV-0010')).toBe(
      ['A', 'Wise: wise.com/pay/abc', 'Payment reference: INV-0010'].join('\n'),
    );
  });
  it('ignores blank and whitespace-only fields', () => {
    const messy: PaymentAccount = { currency: 'GBP', accountName: '  ', bankName: 'Monzo', iban: '' };
    expect(renderPaymentBlock(messy, 'INV-0011')).toBe(['Monzo', 'Payment reference: INV-0011'].join('\n'));
  });
});
