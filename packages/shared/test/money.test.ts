import { describe, expect, it } from 'vitest';
import { allocate, formatMoney, MoneyError, toMajorUnits, toMinorUnits } from '../src/money';

describe('toMinorUnits', () => {
  it('parses plain decimal strings', () => {
    expect(toMinorUnits('12.34', 'USD')).toBe(1234);
    expect(toMinorUnits('0.01', 'USD')).toBe(1);
    expect(toMinorUnits('100', 'USD')).toBe(10000);
    expect(toMinorUnits('19.99', 'USD')).toBe(1999);
  });

  it('accepts comma as decimal separator', () => {
    expect(toMinorUnits('12,34', 'EUR')).toBe(1234);
  });

  it('handles zero-decimal currencies', () => {
    expect(toMinorUnits('500', 'JPY')).toBe(500);
    expect(toMinorUnits('500.4', 'JPY')).toBe(500);
    expect(toMinorUnits('500.5', 'JPY')).toBe(501);
  });

  it('handles three-decimal currencies', () => {
    expect(toMinorUnits('1.234', 'KWD')).toBe(1234);
  });

  it('rounds half-up on excess precision', () => {
    expect(toMinorUnits('1.005', 'USD')).toBe(101);
    expect(toMinorUnits('1.004', 'USD')).toBe(100);
  });

  it('avoids float artifacts on number input', () => {
    expect(toMinorUnits(19.99, 'USD')).toBe(1999);
    expect(toMinorUnits(0.1 + 0.2, 'USD')).toBe(30);
  });

  it('parses negatives', () => {
    expect(toMinorUnits('-5.25', 'USD')).toBe(-525);
  });

  it('rejects garbage', () => {
    expect(() => toMinorUnits('abc', 'USD')).toThrow(MoneyError);
    expect(() => toMinorUnits('1.2.3', 'USD')).toThrow(MoneyError);
    expect(() => toMinorUnits('', 'USD')).toThrow(MoneyError);
  });

  it('rejects out-of-range amounts', () => {
    expect(() => toMinorUnits('99999999999', 'USD')).toThrow(MoneyError);
  });
});

describe('toMajorUnits', () => {
  it('converts back', () => {
    expect(toMajorUnits(1234, 'USD')).toBe(12.34);
    expect(toMajorUnits(500, 'JPY')).toBe(500);
  });
});

describe('formatMoney', () => {
  it('formats USD', () => {
    expect(formatMoney(123456, 'USD', 'en-US')).toBe('$1,234.56');
  });
  it('formats JPY without decimals', () => {
    expect(formatMoney(500, 'JPY', 'en-US')).toBe('¥500');
  });
  it('does not crash on unknown currency codes', () => {
    expect(formatMoney(100, 'ZZZ')).toBeTruthy();
  });
});

describe('allocate', () => {
  it('splits evenly when divisible', () => {
    expect(allocate(300, [1, 1, 1])).toEqual([100, 100, 100]);
  });

  it('distributes remainder deterministically (largest remainder, lowest index first)', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(101, [1, 1, 1])).toEqual([34, 34, 33]);
  });

  it('always sums exactly to the total', () => {
    const cases: Array<[number, number[]]> = [
      [100, [1, 1, 1]],
      [999, [3, 5, 7]],
      [1, [1, 1, 1, 1, 1]],
      [2_000_000_000, [7, 11, 13]],
      [12345, [0, 1, 0, 2]],
      [777, [3333, 3333, 3334]],
    ];
    for (const [total, weights] of cases) {
      const parts = allocate(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts).toHaveLength(weights.length);
    }
  });

  it('gives zero to zero-weight entries', () => {
    expect(allocate(100, [0, 1])).toEqual([0, 100]);
  });

  it('handles proportional weights (percent basis points)', () => {
    expect(allocate(10000, [5000, 3000, 2000])).toEqual([5000, 3000, 2000]);
    const parts = allocate(101, [5000, 3000, 2000]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(101);
  });

  it('allocates negative totals symmetrically', () => {
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
  });

  it('handles zero total', () => {
    expect(allocate(0, [1, 2, 3])).toEqual([0, 0, 0]);
    expect(allocate(0, [0, 0])).toEqual([0, 0]);
  });

  it('rejects invalid input', () => {
    expect(() => allocate(100, [])).toThrow(MoneyError);
    expect(() => allocate(100, [-1, 2])).toThrow(MoneyError);
    expect(() => allocate(100, [0.5, 0.5])).toThrow(MoneyError);
    expect(() => allocate(100, [0, 0])).toThrow(MoneyError);
    expect(() => allocate(100.5, [1])).toThrow(MoneyError);
  });

  it('is exact for large totals and skewed weights (BigInt path)', () => {
    const parts = allocate(1_999_999_999, [1, 999_999]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1_999_999_999);
    expect(parts[0]).toBeGreaterThanOrEqual(1999);
  });
});
