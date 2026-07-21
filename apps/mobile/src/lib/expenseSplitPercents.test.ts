import { describe, expect, it } from 'vitest';
import { computeSplitPercents } from './expenseSplitPercents';

// Tests written from spec-WI-039 § Percent-of-total computation (largest-
// remainder / Hamilton method) before computeSplitPercents exists.
describe('computeSplitPercents', () => {
  it('returns null for an empty splits array (guard)', () => {
    expect(computeSplitPercents([])).toBeNull();
  });

  it('returns null when the total is zero (guard)', () => {
    expect(computeSplitPercents([{ amount: 0 }, { amount: 0 }])).toBeNull();
  });

  it('returns null when the total is negative (guard)', () => {
    expect(computeSplitPercents([{ amount: -100 }])).toBeNull();
  });

  it('gives a single participant one 100% segment', () => {
    expect(computeSplitPercents([{ amount: 500 }])).toEqual([100]);
  });

  it('distributes the leftover point to the largest remainder', () => {
    // raw shares: 33.33, 33.33, 33.34 -> floors 33,33,33 (sum 99), L=1,
    // largest remainder is the third entry (0.34) -> gets the bump.
    const result = computeSplitPercents([{ amount: 3333 }, { amount: 3333 }, { amount: 3334 }]);
    expect(result).toEqual([33, 33, 34]);
    expect(result!.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('tie-breaks equal remainders by larger split.amount first, then original order', () => {
    // amounts [1,1,4] of total 6 -> raw 16.667, 16.667, 66.667 (identical
    // .667 remainder on all three) -> floors 16,16,66 (sum 98), L=2.
    // Larger amount (index 2, amount 4) gets the first point; the remaining
    // point goes to the earliest-index tie among the two amount-1 entries
    // (index 0).
    const result = computeSplitPercents([{ amount: 1 }, { amount: 1 }, { amount: 4 }]);
    expect(result).toEqual([17, 16, 67]);
    expect(result!.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('preserves input order in the output', () => {
    const result = computeSplitPercents([{ amount: 100 }, { amount: 400 }]);
    expect(result).toEqual([20, 80]);
  });

  it('sums to exactly 100 for an irregular three-way split', () => {
    const result = computeSplitPercents([{ amount: 1901 }, { amount: 3333 }, { amount: 4766 }]);
    expect(result!.reduce((a, b) => a + b, 0)).toBe(100);
  });
});
