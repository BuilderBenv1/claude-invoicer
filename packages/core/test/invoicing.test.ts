import { describe, it, expect } from 'vitest';
import { computeTotals, dueDateFrom, isOverdue } from '../src/invoicing.js';

describe('computeTotals', () => {
  it('leaves the total equal to the subtotal when VAT is off', () => {
    expect(computeTotals(1000, 0)).toEqual({ subtotal: 1000, taxRate: 0, taxAmount: 0, total: 1000 });
  });
  it('treats the rate as a percentage, not a fraction', () => {
    expect(computeTotals(1000, 20)).toEqual({ subtotal: 1000, taxRate: 20, taxAmount: 200, total: 1200 });
  });
  it('rounds tax and total to two decimals', () => {
    const t = computeTotals(99.99, 20);
    expect(t.taxAmount).toBe(20);
    expect(t.total).toBe(119.99);
  });
  it('rounds a rate that produces a third decimal', () => {
    const t = computeTotals(10.1, 17.5);
    expect(t.taxAmount).toBe(1.77);
    expect(t.total).toBe(11.87);
  });
  it('treats a negative or non-finite rate as zero rather than crediting tax', () => {
    expect(computeTotals(100, -5).taxAmount).toBe(0);
    expect(computeTotals(100, Number.NaN).taxAmount).toBe(0);
    expect(computeTotals(100, -5).total).toBe(100);
  });
  it('carries a negative subtotal through without inventing tax on it', () => {
    expect(computeTotals(-50, 20)).toEqual({ subtotal: -50, taxRate: 20, taxAmount: -10, total: -60 });
  });
});

describe('dueDateFrom', () => {
  const issued = new Date('2026-08-14T12:00:00.000Z');
  it('lands on the calendar date the term implies, at the last instant of that day', () => {
    expect(dueDateFrom(issued, 14, 'UTC')?.toISOString()).toBe('2026-08-28T23:59:59.999Z');
  });
  it('returns null when there are no payment terms', () => {
    expect(dueDateFrom(issued, 0, 'UTC')).toBeNull();
  });
  it('returns null for a negative term rather than a date in the past', () => {
    expect(dueDateFrom(issued, -3, 'UTC')).toBeNull();
  });
  it('crosses a month boundary correctly', () => {
    expect(dueDateFrom(new Date('2026-08-25T00:00:00.000Z'), 10, 'UTC')?.toISOString()).toBe(
      '2026-09-04T23:59:59.999Z',
    );
  });
  it('is not overdue at any point on its due date, but is overdue just after the midnight following it', () => {
    // Issued late in the day — the due date must still be the *next* calendar day
    // in full, not "the same time of day, N days later".
    const issuedLate = new Date('2026-08-14T23:30:00.000Z');
    const due = dueDateFrom(issuedLate, 1, 'UTC');
    expect(due?.toISOString()).toBe('2026-08-15T23:59:59.999Z');
    const dueMs = due!.getTime();
    // Nowhere on 2026-08-15 (the due date) is it overdue...
    expect(isOverdue('unpaid', due, new Date('2026-08-15T00:00:00.000Z').getTime())).toBe(false);
    expect(isOverdue('unpaid', due, new Date('2026-08-15T12:00:00.000Z').getTime())).toBe(false);
    expect(isOverdue('unpaid', due, dueMs)).toBe(false);
    // ...but it is the instant the following day begins.
    expect(isOverdue('unpaid', due, dueMs + 1)).toBe(true);
  });
  it('lands on the expected calendar date across a BST→GMT transition in Europe/London', () => {
    // Clocks go back in Europe/London at 2026-10-25 02:00 BST (01:00 UTC), so
    // this issue date's due date spans the transition. Issued just after local
    // midnight (2026-10-20 00:30 BST = 2026-10-19T23:30Z); fixed ms arithmetic
    // (the old bug) drifts this to 2026-10-26 once the clocks fall back — a full
    // calendar day early versus the correct 2026-10-27.
    const issuedLondon = new Date('2026-10-19T23:30:00.000Z');
    const due = dueDateFrom(issuedLondon, 7, 'Europe/London');
    expect(due?.toISOString()).toBe('2026-10-27T23:59:59.999Z');
    const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(due);
    expect(dateKey).toBe('2026-10-27');
  });
});

describe('isOverdue', () => {
  const due = new Date('2026-08-28T12:00:00.000Z');
  const dueMs = due.getTime();
  it('is overdue once the due date has passed and it is still unpaid', () => {
    expect(isOverdue('unpaid', due, dueMs + 1)).toBe(true);
  });
  it('is not overdue at the exact due instant', () => {
    expect(isOverdue('unpaid', due, dueMs)).toBe(false);
  });
  it('is never overdue once paid', () => {
    expect(isOverdue('paid', due, dueMs + 86_400_000)).toBe(false);
  });
  it('is never overdue without a due date', () => {
    expect(isOverdue('unpaid', null, dueMs + 86_400_000)).toBe(false);
  });
});
