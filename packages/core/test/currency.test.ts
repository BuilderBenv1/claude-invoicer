import { describe, it, expect } from 'vitest';
import {
  CURRENCIES,
  currencyOptionsWith,
  currencySymbol,
  formatMoney,
  isKnownCurrency,
  normalizeCurrency,
} from '../src/currency.js';

describe('normalizeCurrency', () => {
  it('trims and upper-cases', () => {
    expect(normalizeCurrency(' gbp ')).toBe('GBP');
  });
  it('handles empty input', () => {
    expect(normalizeCurrency('')).toBe('');
  });
});

describe('isKnownCurrency', () => {
  it('knows catalogue codes regardless of case', () => {
    expect(isKnownCurrency('gbp')).toBe(true);
  });
  it('does not know codes outside the catalogue', () => {
    expect(isKnownCurrency('JPY')).toBe(false);
  });
});

describe('currencySymbol', () => {
  it('returns the catalogue symbol', () => {
    expect(currencySymbol('GBP')).toBe('£');
  });
  it('falls back to the code itself', () => {
    expect(currencySymbol('JPY')).toBe('JPY');
  });
});

describe('formatMoney', () => {
  it('renders GBP with a pound sign and UK grouping', () => {
    expect(formatMoney(1234.56, 'GBP')).toBe('£1,234.56');
  });
  it('renders USD with a bare dollar sign, not a country prefix', () => {
    expect(formatMoney(1234.56, 'USD')).toBe('$1,234.56');
  });
  it('accepts lower-case codes', () => {
    expect(formatMoney(10, 'gbp')).toBe(formatMoney(10, 'GBP'));
  });
  it('falls back to "CODE amount" when Intl rejects the currency', () => {
    expect(formatMoney(10, 'NOTACURRENCY')).toBe('NOTACURRENCY 10.00');
  });
  it('renders negative amounts without losing the sign', () => {
    expect(formatMoney(-50, 'GBP')).toContain('50.00');
    expect(formatMoney(-50, 'GBP')).toContain('-');
  });
});

describe('currencyOptionsWith', () => {
  it('returns the catalogue for a known code', () => {
    expect(currencyOptionsWith('GBP')).toHaveLength(CURRENCIES.length);
  });
  it('returns the catalogue for an empty code', () => {
    expect(currencyOptionsWith('')).toHaveLength(CURRENCIES.length);
  });
  it('appends an unknown stored code so editing never rewrites it silently', () => {
    const opts = currencyOptionsWith('JPY');
    expect(opts).toHaveLength(CURRENCIES.length + 1);
    expect(opts.at(-1)).toEqual({ code: 'JPY', symbol: 'JPY', name: 'JPY' });
  });
});
