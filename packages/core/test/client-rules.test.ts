import { describe, it, expect } from 'vitest';
import { canDeleteClient, confirmationMatches } from '../src/client-rules.js';

describe('canDeleteClient', () => {
  it('allows deleting a client who has never been invoiced', () => {
    expect(canDeleteClient('Acme', 0)).toEqual({ allowed: true });
  });
  it('blocks a client with one invoice, in the singular', () => {
    const res = canDeleteClient('Acme', 1);
    expect(res.allowed).toBe(false);
    expect(res.allowed === false && res.reason).toContain('1 invoice —');
    expect(res.allowed === false && res.reason).toContain('Acme');
  });
  it('blocks a client with several invoices, in the plural', () => {
    const res = canDeleteClient('Acme', 3);
    expect(res.allowed === false && res.reason).toContain('3 invoices');
  });
});

describe('confirmationMatches', () => {
  it('accepts the exact name', () => {
    expect(confirmationMatches('Acme Ltd', 'Acme Ltd')).toBe(true);
  });
  it('forgives case and surrounding whitespace', () => {
    expect(confirmationMatches('  acme ltd  ', 'Acme Ltd')).toBe(true);
  });
  it('forgives collapsed inner whitespace', () => {
    expect(confirmationMatches('Acme   Ltd', 'Acme Ltd')).toBe(true);
  });
  it('rejects a different name', () => {
    expect(confirmationMatches('Acme', 'Acme Ltd')).toBe(false);
  });
  it('rejects an empty confirmation even for an empty name', () => {
    expect(confirmationMatches('', '')).toBe(false);
    expect(confirmationMatches('   ', 'Acme')).toBe(false);
  });
});
