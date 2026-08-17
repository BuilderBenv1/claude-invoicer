import { describe, it, expect } from 'vitest';
import { toWinAnsi } from '../src/text.js';
import { CURRENCIES, formatMoney } from '../src/currency.js';

describe('toWinAnsi', () => {
  it('leaves plain ASCII untouched', () => {
    expect(toWinAnsi('Invoice INV-0007')).toBe('Invoice INV-0007');
  });
  it('replaces the no-break spaces Intl emits in some locales', () => {
    expect(toWinAnsi('1 234,56 kr')).toBe('1 234,56 kr');
    expect(toWinAnsi('1 234,56')).toBe('1 234,56');
  });
  it('keeps cp1252 characters: accents, curly quotes, dashes, the euro sign', () => {
    expect(toWinAnsi('Café — €10 “quoted”')).toBe('Café — €10 “quoted”');
  });
  it('spells out currency symbols cp1252 cannot encode', () => {
    expect(toWinAnsi('₹100')).toBe('INR 100');
  });
  it('replaces anything else it cannot encode', () => {
    expect(toWinAnsi('日本')).toBe('??');
  });
  it('handles an empty string', () => {
    expect(toWinAnsi('')).toBe('');
  });
});

describe('toWinAnsi over formatMoney output', () => {
  it('never replaces a character in any catalogue currency, positive, negative or zero', () => {
    for (const c of CURRENCIES) {
      for (const amount of [1234.56, -1234.56, 0]) {
        const formatted = formatMoney(amount, c.code);
        expect(toWinAnsi(formatted), `${c.code} ${amount}`).not.toContain('?');
      }
    }
  });
  it('preserves the sign of a negative amount in every catalogue currency', () => {
    for (const c of CURRENCIES) {
      expect(toWinAnsi(formatMoney(-1234.56, c.code)), c.code).toContain('-');
    }
  });
  it('is idempotent — fit() sanitises and draw() sanitises its output again', () => {
    for (const s of ['−1 234,56 kr', 'Café — €10', '₹100', '日本']) {
      expect(toWinAnsi(toWinAnsi(s))).toBe(toWinAnsi(s));
    }
  });
});
