import { describe, expect, it } from 'vitest';
import { groupMonthlyBars, hasNonZeroMonth } from './groupMonthlyChart';

// Tests written from spec-WI-059 §1 D1/D5, §5 Test strategy before
// groupMonthlyBars/hasNonZeroMonth exist.

describe('hasNonZeroMonth', () => {
  it('is false for an empty byMonth', () => {
    expect(hasNonZeroMonth([])).toBe(false);
  });

  it('is false when every month totalActivity is 0 (D6 — no broken/all-zero chart)', () => {
    expect(
      hasNonZeroMonth([
        { month: '2026-05', amount: 0, totalActivity: 0 },
        { month: '2026-06', amount: 0, totalActivity: 0 },
      ]),
    ).toBe(false);
  });

  it('is true when at least one month has nonzero totalActivity', () => {
    expect(
      hasNonZeroMonth([
        { month: '2026-05', amount: 0, totalActivity: 0 },
        { month: '2026-06', amount: 500, totalActivity: 900 },
      ]),
    ).toBe(true);
  });

  it('ignores amount (viewer share) and looks only at totalActivity — the load-bearing field', () => {
    // A month where the viewer's own share (amount) is nonzero but the
    // group-wide totalActivity is 0 must NOT count as "has spend" for this
    // chart (D1: plot totalActivity, never amount).
    expect(hasNonZeroMonth([{ month: '2026-05', amount: 300, totalActivity: 0 }])).toBe(false);
  });
});

describe('groupMonthlyBars', () => {
  it('returns an empty array for an empty byMonth', () => {
    expect(groupMonthlyBars([], 100)).toEqual([]);
  });

  it('maps totalActivity (not amount) to bar height, in chronological (input) order', () => {
    const bars = groupMonthlyBars(
      [
        { month: '2026-04', amount: 9999, totalActivity: 500 },
        { month: '2026-05', amount: 1, totalActivity: 1000 },
        { month: '2026-06', amount: 0, totalActivity: 250 },
      ],
      100,
    );
    expect(bars.map((b) => b.month)).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(bars[0]).toMatchObject({ height: 50 });
    expect(bars[1]).toMatchObject({ height: 100 });
    expect(bars[2]).toMatchObject({ height: 25 });
  });

  it('renders a zero-filled month as a hairline (2px) bar, not skipped', () => {
    const bars = groupMonthlyBars(
      [
        { month: '2026-05', amount: 0, totalActivity: 1000 },
        { month: '2026-06', amount: 0, totalActivity: 0 },
      ],
      100,
    );
    expect(bars).toHaveLength(2);
    expect(bars[1]!.height).toBe(2);
  });

  it('gives every nonzero bar a minimum 4px height even when negligibly small relative to the max', () => {
    const bars = groupMonthlyBars(
      [
        { month: '2026-05', amount: 0, totalActivity: 100_000 },
        { month: '2026-06', amount: 0, totalActivity: 1 },
      ],
      100,
    );
    expect(bars[1]!.height).toBeGreaterThanOrEqual(4);
  });

  it('when every month is 0, still returns 2px slivers, not NaN', () => {
    const bars = groupMonthlyBars([{ month: '2026-05', amount: 0, totalActivity: 0 }], 100);
    expect(bars[0]!.height).toBe(2);
  });
});
