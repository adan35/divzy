import { describe, expect, it } from 'vitest';
import { isSpendSnapshotEmpty, spendSnapshotRange } from './spendSnapshot';

// Tests written from spec-WI-036 § Data source & fetch contract and §
// Rendering (states) before spendSnapshotRange/isSpendSnapshotEmpty exist.
describe('spendSnapshotRange', () => {
  it('returns the UTC start of the month two calendar months back as `from`, and `now` as `to`', () => {
    const now = new Date('2026-07-16T12:34:56.000Z');
    expect(spendSnapshotRange(now)).toEqual({
      from: '2026-05-01T00:00:00.000Z',
      to: now.toISOString(),
    });
  });

  it('rolls back across a year boundary', () => {
    const now = new Date('2026-01-15T00:00:00.000Z');
    expect(spendSnapshotRange(now)).toEqual({
      from: '2025-11-01T00:00:00.000Z',
      to: now.toISOString(),
    });
  });

  it('defaults to the current time when no `now` is passed', () => {
    const before = Date.now();
    const { to } = spendSnapshotRange();
    const after = Date.now();
    const toMs = new Date(to).getTime();
    expect(toMs).toBeGreaterThanOrEqual(before);
    expect(toMs).toBeLessThanOrEqual(after);
  });
});

describe('isSpendSnapshotEmpty', () => {
  it('is false when data is undefined (still loading)', () => {
    expect(isSpendSnapshotEmpty(undefined)).toBe(false);
  });

  it('is true when yourSpend is 0 and every in-range month is 0', () => {
    expect(
      isSpendSnapshotEmpty({
        yourSpend: 0,
        byMonth: [{ amount: 0 }, { amount: 0 }, { amount: 0 }],
      }),
    ).toBe(true);
  });

  it('is false when yourSpend is nonzero', () => {
    expect(
      isSpendSnapshotEmpty({
        yourSpend: 500,
        byMonth: [{ amount: 0 }, { amount: 0 }, { amount: 500 }],
      }),
    ).toBe(false);
  });

  it('is false when any in-range month is nonzero even if yourSpend reads 0', () => {
    expect(
      isSpendSnapshotEmpty({
        yourSpend: 0,
        byMonth: [{ amount: 0 }, { amount: 10 }, { amount: 0 }],
      }),
    ).toBe(false);
  });
});
