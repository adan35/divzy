import { describe, expect, it } from 'vitest';
import { collapsedBalanceEntries, friendHasNothingOutstanding } from './balance-display';

// Tests written from story-WI-001's Gherkin ACs, before `collapsedBalanceEntries` exists.
// This is the shared rendering-order rule spec-WI-001 defines identically for
// GroupSummaryDto (yourBalanceConverted/yourBalances) and FriendDto
// (balancesConverted/balances): converted figure first, then any unconvertible
// native leftovers, then "settled up" only when both are empty.

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
    // Backend contract says yourBalanceConverted/balancesConverted is null once nothing is
    // left to sum, but this stays defensive against a literal `{ amount: 0 }` value too —
    // an AC explicitly calls out "never shows You owe £0.00".
    expect(collapsedBalanceEntries({ currency: 'GBP', amount: 0 }, [])).toEqual([]);
  });

  it('treats undefined the same as null (defensive against an omitted field)', () => {
    expect(collapsedBalanceEntries(undefined, [{ currency: 'XYZ', amount: 500 }])).toEqual([
      { currency: 'XYZ', amount: 500 },
    ]);
  });
});

// Tests written from story-WI-012's Gherkin AC "Friend detail page (web) —
// zero balance disables Settle Up outright" and the dashboard-quick-action
// equivalent, before `friendHasNothingOutstanding` exists.
describe('friendHasNothingOutstanding', () => {
  it('is true when both the converted figure and native leftovers are empty (fully settled up)', () => {
    expect(friendHasNothingOutstanding(null, [])).toBe(true);
  });

  it('is true when balancesConverted is a literal zero-amount object (defensive, mirrors collapsedBalanceEntries)', () => {
    expect(friendHasNothingOutstanding({ currency: 'GBP', amount: 0 }, [])).toBe(true);
  });

  it('is false when there is a non-zero converted figure, even with no native leftovers', () => {
    expect(friendHasNothingOutstanding({ currency: 'GBP', amount: -9735 }, [])).toBe(false);
  });

  it('is false when a native (unconvertible) leftover exists, regardless of the converted figure', () => {
    expect(friendHasNothingOutstanding(null, [{ currency: 'JPY', amount: -50000 }])).toBe(false);
  });

  it('treats undefined the same as null (defensive against an omitted field)', () => {
    expect(friendHasNothingOutstanding(undefined, [])).toBe(true);
  });
});
