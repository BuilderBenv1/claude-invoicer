import { describe, it, expect } from 'vitest';
import { toWinAnsi } from '../src/text.js';

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
