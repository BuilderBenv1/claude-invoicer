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
  it('adds the term in whole days', () => {
    expect(dueDateFrom(issued, 14)?.toISOString()).toBe('2026-08-28T12:00:00.000Z');
  });
  it('returns null when there are no payment terms', () => {
    expect(dueDateFrom(issued, 0)).toBeNull();
  });
  it('returns null for a negative term rather than a date in the past', () => {
    expect(dueDateFrom(issued, -3)).toBeNull();
  });
  it('crosses a month boundary correctly', () => {
    expect(dueDateFrom(new Date('2026-08-25T00:00:00.000Z'), 10)?.toISOString()).toBe('2026-09-04T00:00:00.000Z');
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
