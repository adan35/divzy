import { describe, expect, it } from 'vitest';
import { computeFriendsSummary } from '../src/friends-summary';
import type { FriendDto } from '../src/types';

// Tests written from story-WI-049's Gherkin ACs / spec-WI-049 §3 & §6, before
// `computeFriendsSummary` exists.

const user = (id: string, name: string) => ({ id, name, avatarColor: '#111111' });

function makeFriend(overrides: Partial<FriendDto> = {}): FriendDto {
  return {
    user: user('f1', 'Friend'),
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    lastActivityAt: null,
    ...overrides,
  };
}

describe('computeFriendsSummary', () => {
  it('empty array returns an all-zero settled shape with null currency', () => {
    const summary = computeFriendsSummary([]);
    expect(summary).toEqual({
      currency: null,
      youAreOwed: 0,
      youOwe: 0,
      net: 0,
      hasConvertible: false,
      unresolvedCurrencies: [],
      hasUnresolved: false,
      usedFallbackRates: false,
    });
  });

  it('mixed directions: youAreOwed/youOwe each equal the sign-restricted sum, net is the difference, never cross-contaminated', () => {
    const friends: FriendDto[] = [
      makeFriend({ user: user('alex', 'Alex'), balancesConverted: { currency: 'USD', amount: 2000 } }),
      makeFriend({ user: user('bea', 'Bea'), balancesConverted: { currency: 'USD', amount: 500 } }),
      makeFriend({ user: user('chris', 'Chris'), balancesConverted: { currency: 'USD', amount: -1200 } }),
    ];

    const summary = computeFriendsSummary(friends);

    expect(summary.currency).toBe('USD');
    expect(summary.youAreOwed).toBe(2500);
    expect(summary.youOwe).toBe(1200);
    expect(summary.net).toBe(1300);
    expect(summary.hasConvertible).toBe(true);
    expect(summary.hasUnresolved).toBe(false);
  });

  it('all-positive: youOwe is 0, youAreOwed is the correct sum', () => {
    const friends: FriendDto[] = [
      makeFriend({ balancesConverted: { currency: 'USD', amount: 1000 } }),
      makeFriend({ balancesConverted: { currency: 'USD', amount: 250 } }),
    ];

    const summary = computeFriendsSummary(friends);

    expect(summary.youOwe).toBe(0);
    expect(summary.youAreOwed).toBe(1250);
    expect(summary.net).toBe(1250);
  });

  it('all-negative: youAreOwed is 0, youOwe is the absolute sum', () => {
    const friends: FriendDto[] = [
      makeFriend({ balancesConverted: { currency: 'USD', amount: -1000 } }),
      makeFriend({ balancesConverted: { currency: 'USD', amount: -250 } }),
    ];

    const summary = computeFriendsSummary(friends);

    expect(summary.youAreOwed).toBe(0);
    expect(summary.youOwe).toBe(1250);
    expect(summary.net).toBe(-1250);
  });

  it('all settled up (every balancesConverted null, every balances empty): hasConvertible/hasUnresolved both false, totals 0', () => {
    const friends: FriendDto[] = [makeFriend(), makeFriend()];

    const summary = computeFriendsSummary(friends);

    expect(summary.hasConvertible).toBe(false);
    expect(summary.hasUnresolved).toBe(false);
    expect(summary.youAreOwed).toBe(0);
    expect(summary.youOwe).toBe(0);
    expect(summary.currency).toBeNull();
  });

  it('unresolved friend (balancesConverted null, nonzero balances) mixed with normal friends: excluded from totals, flags hasUnresolved, lists the currency', () => {
    const friends: FriendDto[] = [
      makeFriend({ balancesConverted: { currency: 'USD', amount: 2000 } }),
      makeFriend({ balancesConverted: null, balances: [{ currency: 'XYZ', amount: -500 }] }),
    ];

    const summary = computeFriendsSummary(friends);

    expect(summary.youAreOwed).toBe(2000);
    expect(summary.youOwe).toBe(0);
    expect(summary.hasUnresolved).toBe(true);
    expect(summary.unresolvedCurrencies).toEqual([{ currency: 'XYZ', amount: -500 }]);
  });

  it('zero-converted friend (amount === 0) contributes 0 and does NOT set hasUnresolved, distinct from the null case', () => {
    const friends: FriendDto[] = [
      makeFriend({ balancesConverted: { currency: 'USD', amount: 0 } }),
      makeFriend({ balancesConverted: null, balances: [{ currency: 'XYZ', amount: 750 }] }),
    ];

    const summary = computeFriendsSummary(friends);

    expect(summary.hasConvertible).toBe(true); // the zero-converted friend still counts as "convertible"
    expect(summary.youAreOwed).toBe(0);
    expect(summary.youOwe).toBe(0);
    expect(summary.hasUnresolved).toBe(true); // driven only by the second (null-converted) friend
    expect(summary.unresolvedCurrencies).toEqual([{ currency: 'XYZ', amount: 750 }]);
  });

  it('fallback OR: usedFallbackRates true iff a contributing (non-null-converted) friend had it', () => {
    const friends: FriendDto[] = [
      makeFriend({ balancesConverted: { currency: 'USD', amount: 100 }, usedFallbackRates: false }),
      makeFriend({ balancesConverted: { currency: 'USD', amount: 200 }, usedFallbackRates: true }),
    ];

    expect(computeFriendsSummary(friends).usedFallbackRates).toBe(true);
  });

  it('a friend with usedFallbackRates=true but a null balancesConverted does not flip it on its own', () => {
    const friends: FriendDto[] = [
      makeFriend({ balancesConverted: null, balances: [], usedFallbackRates: true }),
      makeFriend({ balancesConverted: { currency: 'USD', amount: 100 }, usedFallbackRates: false }),
    ];

    expect(computeFriendsSummary(friends).usedFallbackRates).toBe(false);
  });

  it('dedupes/sums unresolvedCurrencies across multiple friends sharing the same unconvertible currency', () => {
    const friends: FriendDto[] = [
      makeFriend({ balancesConverted: null, balances: [{ currency: 'XYZ', amount: -500 }] }),
      makeFriend({ balancesConverted: null, balances: [{ currency: 'XYZ', amount: 200 }] }),
    ];

    const summary = computeFriendsSummary(friends);

    expect(summary.unresolvedCurrencies).toEqual([{ currency: 'XYZ', amount: -300 }]);
  });

  it('never nets "owed" and "owe" into a single figure — mixed friends keep both nonzero simultaneously', () => {
    const friends: FriendDto[] = [
      makeFriend({ balancesConverted: { currency: 'USD', amount: 1000 } }),
      makeFriend({ balancesConverted: { currency: 'USD', amount: -400 } }),
    ];

    const summary = computeFriendsSummary(friends);

    expect(summary.youAreOwed).toBe(1000);
    expect(summary.youOwe).toBe(400);
  });
});
