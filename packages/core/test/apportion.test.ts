import { describe, it, expect } from 'vitest';
import { apportionHours } from '../src/apportion.js';

const sum = (ns: number[]) => Math.round(ns.reduce((s, n) => s + n, 0) * 100) / 100;

describe('apportionHours', () => {
  it('splits in proportion to the weights', () => {
    expect(apportionHours(10, [1, 1, 3])).toEqual([2, 2, 6]);
  });

  it('gives a single milestone the whole total', () => {
    expect(apportionHours(3.25, [7])).toEqual([3.25]);
  });

  it('always sums to exactly the total, even when the split does not divide', () => {
    // 10 / 3 recurs; naive rounding gives 3.33 * 3 = 9.99 and loses a cent.
    const out = apportionHours(10, [1, 1, 1]);
    expect(sum(out)).toBe(10);
  });

  it('sums to exactly the total across many awkward splits', () => {
    const cases: [number, number[]][] = [
      [3.22, [2.5, 10, 7, 3, 5]],
      [0.07, [1, 1, 1]],
      [99.99, [3, 3, 3, 3, 3, 3, 3]],
      [1, [1, 2, 3, 4, 5, 6, 7]],
      [12.34, [0.5, 0.25]],
    ];
    for (const [total, weights] of cases) {
      expect(sum(apportionHours(total, weights))).toBe(total);
    }
  });

  it('splits evenly when every weight is zero', () => {
    // A brief whose milestones carry no estimate still has to divide somehow.
    expect(apportionHours(9, [0, 0, 0])).toEqual([3, 3, 3]);
  });

  it('splits evenly when weights are missing entirely', () => {
    expect(sum(apportionHours(5, [0, 0]))).toBe(5);
  });

  it('returns an empty array for no milestones', () => {
    expect(apportionHours(10, [])).toEqual([]);
  });

  it('returns zeros when there is no time to bill', () => {
    expect(apportionHours(0, [1, 2])).toEqual([0, 0]);
  });

  it('never returns a negative line', () => {
    // A residual correction must not push a small line below zero.
    const out = apportionHours(0.01, [1, 1, 1, 1, 1]);
    expect(sum(out)).toBe(0.01);
    expect(out.every((h) => h >= 0)).toBe(true);
  });

  it('ignores a negative weight rather than billing a negative line', () => {
    const out = apportionHours(10, [-5, 5]);
    expect(out.every((h) => h >= 0)).toBe(true);
    expect(sum(out)).toBe(10);
  });
});
