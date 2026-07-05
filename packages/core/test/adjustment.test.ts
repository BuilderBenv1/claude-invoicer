import { describe, it, expect } from 'vitest';
import { adjustmentLine } from '../src/billing.js';

describe('adjustmentLine', () => {
  it('builds a positive adjustment line at the given rate', () => {
    expect(adjustmentLine(2, 100)).toEqual({
      label: 'Time adjustment',
      rawMs: 0,
      hours: 2,
      ratePerHour: 100,
      amount: 200,
    });
  });

  it('supports a negative adjustment (a discount)', () => {
    const line = adjustmentLine(-1.5, 80);
    expect(line?.hours).toBe(-1.5);
    expect(line?.amount).toBe(-120);
  });

  it('returns null for a zero adjustment', () => {
    expect(adjustmentLine(0, 100)).toBeNull();
  });

  it('rounds hours and amount to 2dp', () => {
    const line = adjustmentLine(0.1 + 0.2, 100); // 0.30000000000000004
    expect(line?.hours).toBe(0.3);
    expect(line?.amount).toBe(30);
  });
});
