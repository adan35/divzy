import { describe, expect, it } from 'vitest';
import { monthlySeriesValue } from './monthlySeries';

// Tests written from spec-WI-019 § Mobile UI ("Bar values: select the series
// value per month via a helper ... use it everywhere the current code reads
// item.amount / m.amount") before monthlySeriesValue exists.
describe('monthlySeriesValue', () => {
  const month = { month: '2026-05', amount: 1200, totalActivity: 4500 };

  it('returns amount ("your spend") when series is "you"', () => {
    expect(monthlySeriesValue(month, 'you')).toBe(1200);
  });

  it('returns totalActivity ("total activity") when series is "total"', () => {
    expect(monthlySeriesValue(month, 'total')).toBe(4500);
  });

  it('returns 0 for a zero-filled month regardless of series', () => {
    const zeroMonth = { month: '2026-06', amount: 0, totalActivity: 0 };
    expect(monthlySeriesValue(zeroMonth, 'you')).toBe(0);
    expect(monthlySeriesValue(zeroMonth, 'total')).toBe(0);
  });
});
