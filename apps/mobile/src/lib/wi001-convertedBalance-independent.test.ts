import { describe, expect, it } from 'vitest';
import { collapsedBalanceEntries } from './convertedBalance';

/**
 * Test-stage independent black-box verification of mobile's port of
 * spec-WI-001's shared rendering contract. Written from story-WI-001's
 * Gherkin scenarios directly, with fixtures independent of both the dev's
 * own `convertedBalance.test.ts` and this suite's own web counterpart
 * (`apps/web/src/lib/wi001-balance-display-independent.test.ts`) — the two
 * platforms are meant to share one convention (build-WI-001.md: "ported
 * test-for-test from web's balance-display.test.ts so the two platforms'
 * collapsing rule can't silently drift apart"), so an independent set of
 * numbers here is a genuine cross-check of that claim rather than a restatement
 * of the same fixture on a second file.
 */

describe('FB — mobile collapsedBalanceEntries (Friends list/detail, Groups list — story-WI-001)', () => {
  it('FB-1: collapses a multi-currency balance to one converted figure', () => {
    expect(collapsedBalanceEntries({ currency: 'EUR', amount: 8320 }, [])).toEqual([
      { currency: 'EUR', amount: 8320 },
    ]);
  });

  it('FB-2: native leftovers still render alongside the converted figure when a currency has no resolvable rate', () => {
    expect(
      collapsedBalanceEntries({ currency: 'EUR', amount: 8320 }, [
        { currency: 'AED', amount: 2000 },
      ]),
    ).toEqual([
      { currency: 'EUR', amount: 8320 },
      { currency: 'AED', amount: 2000 },
    ]);
  });

  it('FB-3: settled up (both empty) collapses to no entries', () => {
    expect(collapsedBalanceEntries(null, [])).toEqual([]);
    expect(collapsedBalanceEntries(undefined, [])).toEqual([]);
  });

  it('WB-1: a converted figure of exactly 0 is suppressed even when leftovers are present — mirrors the web platform\'s same edge case (offsetting-currency net-to-zero), verifying the two platforms genuinely share one rule rather than coincidentally matching on the happy path', () => {
    expect(
      collapsedBalanceEntries({ currency: 'EUR', amount: 0 }, [
        { currency: 'AED', amount: -500 },
      ]),
    ).toEqual([{ currency: 'AED', amount: -500 }]);
  });
});
