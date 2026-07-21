import { describe, expect, it } from 'vitest';
import type { GroupBalancesDto, PublicUserDto } from '@divzy/shared';
import {
  collapsedBalanceEntries,
  collectUnresolvedCurrencies,
  unresolvedNativeLines,
} from './convertedBalance';

const user: PublicUserDto = { id: 'u1', name: 'Alex', avatarColor: '#000000' };

// Tests written from story-WI-001's Gherkin ACs (including the 2026-07-14 GET
// /friends coverage-gap addendum), before `collapsedBalanceEntries` exists.
// This is the shared rendering-order rule spec-WI-001 defines identically for
// GroupSummaryDto (yourBalanceConverted/yourBalances) and FriendDto
// (balancesConverted/balances) — mirrors web's `balance-display.ts` exactly
// so mobile and web don't diverge on the collapsing convention.
describe('collapsedBalanceEntries', () => {
  it('collapses a multi-currency balance to one converted figure (Groups list / Friends list)', () => {
    // "my net position ... is -50.00 USD and -30.00 EUR, my default currency is GBP,
    // rates are 1 USD = 0.79 GBP and 1 EUR = 0.86 GBP" -> "You owe £65.30"
    const entries = collapsedBalanceEntries({ currency: 'GBP', amount: -6530 }, []);
    expect(entries).toEqual([{ currency: 'GBP', amount: -6530 }]);
  });

  it('shows only the converted figure, never separate native lines, when nothing is left unconverted', () => {
    const entries = collapsedBalanceEntries({ currency: 'GBP', amount: 5000 }, []);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ currency: 'GBP', amount: 5000 });
  });

  it('degrades gracefully: an unconvertible currency falls back to a native line', () => {
    // "group Offshore Trip includes a balance in a currency with no available conversion
    // rate" -> unconverted entries shown as separate native-currency lines, nothing dropped.
    const entries = collapsedBalanceEntries(null, [{ currency: 'XYZ', amount: 1000 }]);
    expect(entries).toEqual([{ currency: 'XYZ', amount: 1000 }]);
  });

  it('shows the converted figure first, then any unconvertible native leftovers after it', () => {
    const entries = collapsedBalanceEntries({ currency: 'GBP', amount: -6530 }, [
      { currency: 'XYZ', amount: 1000 },
    ]);
    expect(entries).toEqual([
      { currency: 'GBP', amount: -6530 },
      { currency: 'XYZ', amount: 1000 },
    ]);
  });

  it('reads as settled up only when both the converted figure and the leftovers are empty', () => {
    expect(collapsedBalanceEntries(null, [])).toEqual([]);
  });

  it('never renders a zero-amount converted line (nets to zero across all currencies still reads settled up)', () => {
    expect(collapsedBalanceEntries({ currency: 'GBP', amount: 0 }, [])).toEqual([]);
  });

  it('treats undefined the same as null (defensive against an omitted field)', () => {
    expect(collapsedBalanceEntries(undefined, [{ currency: 'XYZ', amount: 500 }])).toEqual([
      { currency: 'XYZ', amount: 500 },
    ]);
  });
});

// WI-001 (converted balances) / WI-002 (manual-rate trigger) — pure display
// helpers behind the dashboard hero and GroupBalancesTab's member rows.
describe('unresolvedNativeLines', () => {
  it('returns only the entries whose currency could not be converted', () => {
    const amounts = [
      { currency: 'USD', amount: 5000 },
      { currency: 'EUR', amount: 3000 },
    ];
    const unresolved = [{ currency: 'EUR', amount: 3000 }];
    expect(unresolvedNativeLines(amounts, unresolved)).toEqual([{ currency: 'EUR', amount: 3000 }]);
  });

  it('returns an empty array when nothing is unresolved — nothing is silently dropped elsewhere', () => {
    const amounts = [{ currency: 'USD', amount: 5000 }];
    expect(unresolvedNativeLines(amounts, [])).toEqual([]);
  });

  it('ignores an unresolved currency that is not present in this column', () => {
    const amounts = [{ currency: 'USD', amount: 5000 }];
    const unresolved = [{ currency: 'XYZ', amount: 100 }];
    expect(unresolvedNativeLines(amounts, unresolved)).toEqual([]);
  });
});

describe('collectUnresolvedCurrencies', () => {
  it('dedupes unresolved currencies across members, keeping the first occurrence', () => {
    const members: GroupBalancesDto['members'] = [
      {
        user,
        balances: [{ currency: 'XYZ', amount: -100 }],
        convertedNet: { amount: 0, unresolved: [{ currency: 'XYZ', amount: 100 }] },
      },
      {
        user: { ...user, id: 'u2' },
        balances: [{ currency: 'XYZ', amount: 200 }],
        convertedNet: { amount: 0, unresolved: [{ currency: 'XYZ', amount: 200 }] },
      },
    ];
    expect(collectUnresolvedCurrencies(members)).toEqual([{ currency: 'XYZ', amount: 100 }]);
  });

  it('ignores settled members (no convertedNet field)', () => {
    const members: GroupBalancesDto['members'] = [{ user, balances: [] }];
    expect(collectUnresolvedCurrencies(members)).toEqual([]);
  });

  it('returns an empty array when every member fully converted', () => {
    const members: GroupBalancesDto['members'] = [
      { user, balances: [{ currency: 'USD', amount: 500 }], convertedNet: { amount: 500, unresolved: [] } },
    ];
    expect(collectUnresolvedCurrencies(members)).toEqual([]);
  });
});
