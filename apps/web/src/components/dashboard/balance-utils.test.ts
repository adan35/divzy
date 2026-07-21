import { describe, expect, it } from 'vitest';
import { balanceMagnitude } from './balance-utils';

// balanceMagnitude ranks the Friends dashboard preview ("top 4 by |balance|"). Once
// FriendDto.balances narrows to unconvertible leftovers only (spec-WI-001 addendum,
// 2026-07-14), ranking by the leftover array alone would rank the common case (everything
// converted, balances: []) as zero for nearly every friend — these tests pin down that the
// converted figure counts toward the ranking magnitude too.

describe('balanceMagnitude', () => {
  it('sums native leftover amounts when there is no converted figure (unchanged behavior)', () => {
    expect(
      balanceMagnitude([
        { currency: 'USD', amount: -500 },
        { currency: 'EUR', amount: 300 },
      ]),
    ).toBe(800);
  });

  it('counts the converted figure toward the ranking magnitude', () => {
    expect(balanceMagnitude([], { currency: 'GBP', amount: -6530 })).toBe(6530);
  });

  it('combines converted and leftover magnitudes', () => {
    expect(
      balanceMagnitude([{ currency: 'XYZ', amount: 1000 }], { currency: 'GBP', amount: -6530 }),
    ).toBe(7530);
  });

  it('treats a missing/null converted figure as contributing nothing', () => {
    expect(balanceMagnitude([{ currency: 'USD', amount: -500 }], null)).toBe(500);
    expect(balanceMagnitude([{ currency: 'USD', amount: -500 }])).toBe(500);
  });
});
