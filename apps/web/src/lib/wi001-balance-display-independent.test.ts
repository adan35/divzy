import { describe, expect, it } from 'vitest';
import { collapsedBalanceEntries } from './balance-display';
import { balanceMagnitude } from '@/components/dashboard/balance-utils';

/**
 * Test-stage independent black-box verification of story-WI-001's shared
 * "Rendering contract for clients" (spec-WI-001), written from the story's
 * Gherkin scenarios and the build summary's own doc comments — not copied
 * from the dev's `balance-display.test.ts` / `balance-utils.test.ts` (own
 * fixtures throughout, including the collapsedBalanceEntries edge case flagged
 * in this build's white-box notes: a converted figure that is exactly zero
 * because two currencies net to zero post-conversion must be suppressed,
 * distinct from "nothing was convertible" which is represented as `null`).
 */

describe('FB — collapsedBalanceEntries (shared web rendering contract, spec-WI-001)', () => {
  it('FB-1: collapses a multi-currency balance to one converted figure, dropping the separate native lines', () => {
    const entries = collapsedBalanceEntries({ currency: 'GBP', amount: -9735 }, []);
    expect(entries).toEqual([{ currency: 'GBP', amount: -9735 }]);
  });

  it('FB-2: appends native leftover lines after the converted figure, in order', () => {
    const entries = collapsedBalanceEntries({ currency: 'GBP', amount: -4980 }, [
      { currency: 'JPY', amount: -50000 },
    ]);
    expect(entries).toEqual([
      { currency: 'GBP', amount: -4980 },
      { currency: 'JPY', amount: -50000 },
    ]);
  });

  it('FB-3: "settled up" only when both converted and leftovers are empty', () => {
    expect(collapsedBalanceEntries(null, [])).toEqual([]);
  });

  it('WB-1: a converted figure of exactly amount 0 is suppressed (never "You owe £0.00"), distinct from null — targets the offsetting-currencies edge the backend can legitimately return (see apps/api/test/wi001-independent-verify.test.ts WB-2)', () => {
    const entries = collapsedBalanceEntries({ currency: 'GBP', amount: 0 }, []);
    expect(entries).toEqual([]);
  });

  it('WB-2: a zero converted figure alongside a genuine leftover still shows the leftover line (only the zero converted line is suppressed)', () => {
    const entries = collapsedBalanceEntries({ currency: 'GBP', amount: 0 }, [
      { currency: 'JPY', amount: -1500 },
    ]);
    expect(entries).toEqual([{ currency: 'JPY', amount: -1500 }]);
  });

  it('FB-4: leftover-only entries (converted is null but a currency had no resolvable rate) render as native lines, nothing dropped', () => {
    const entries = collapsedBalanceEntries(null, [{ currency: 'JPY', amount: -50000 }]);
    expect(entries).toEqual([{ currency: 'JPY', amount: -50000 }]);
  });
});

describe('WB — balanceMagnitude ranking rework (dashboard Friends preview "top N" ordering)', () => {
  it('WB-3: ranks purely by the converted figure when balances (leftovers) narrowed to [] — the exact bug this rework fixes (pre-rework, this would rank every fully-converted row as 0)', () => {
    const bigConverted = balanceMagnitude([], { currency: 'GBP', amount: -12000 });
    const smallConverted = balanceMagnitude([], { currency: 'GBP', amount: -50 });
    expect(bigConverted).toBeGreaterThan(smallConverted);
    expect(smallConverted).toBeGreaterThan(0); // not silently zeroed
  });

  it('WB-4: combines converted + leftover magnitude when both are present', () => {
    const magnitude = balanceMagnitude([{ currency: 'JPY', amount: -30000 }], {
      currency: 'GBP',
      amount: -9735,
    });
    expect(magnitude).toBe(30000 + 9735);
  });

  it('FB-5: a friend/group with no balance data at all ranks as zero', () => {
    expect(balanceMagnitude([], null)).toBe(0);
    expect(balanceMagnitude([], undefined)).toBe(0);
  });
});
