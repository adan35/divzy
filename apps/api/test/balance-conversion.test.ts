import { describe, expect, it } from 'vitest';
import { convertBalanceForViewer } from '../src/lib/balance-conversion';

// story-WI-001 (social-groups) scenarios — the shared per-currency-list ->
// one-converted-figure aggregation used by both GET /groups and GET /friends.
// Rates keyed on the viewer's currency (GBP here), matching resolveConversionRates'
// contract: "units of each currency per 1 unit of base(=viewer currency)".
const GBP_RATES = {
  GBP: 1,
  USD: 1 / 0.79, // 1 USD = 0.79 GBP
  EUR: 1 / 0.86, // 1 EUR = 0.86 GBP
};

describe('convertBalanceForViewer', () => {
  it('collapses a multi-currency balance into one converted figure (Groups list collapses a multi-currency balance)', () => {
    const { converted, leftovers } = convertBalanceForViewer(
      [
        { currency: 'USD', amount: -5000 }, // -50.00 USD
        { currency: 'EUR', amount: -3000 }, // -30.00 EUR
      ],
      'GBP',
      GBP_RATES,
    );

    expect(converted).toEqual({ currency: 'GBP', amount: -6530 }); // -£65.30
    expect(leftovers).toEqual([]);
  });

  it('leaves a currency with no resolvable rate as a native leftover, still converting every other currency (A currency the engine cannot rate falls back to the current unconverted display)', () => {
    const { converted, leftovers } = convertBalanceForViewer(
      [
        { currency: 'USD', amount: -5000 },
        { currency: 'XAU', amount: 1200 }, // not present in the rates map at all
      ],
      'GBP',
      GBP_RATES,
    );

    expect(converted).toEqual({ currency: 'GBP', amount: -3950 }); // only USD converted
    expect(leftovers).toEqual([{ currency: 'XAU', amount: 1200 }]);
  });

  it('returns converted: null when there is nothing to convert (fully settled up)', () => {
    const { converted, leftovers } = convertBalanceForViewer([], 'GBP', GBP_RATES);

    expect(converted).toBeNull();
    expect(leftovers).toEqual([]);
  });

  it('returns converted: null when every present currency is unconvertible, still surfacing every one as a leftover (no amount dropped, zeroed, or blocked)', () => {
    const { converted, leftovers } = convertBalanceForViewer(
      [
        { currency: 'XAU', amount: 1200 },
        { currency: 'XAG', amount: -400 },
      ],
      'GBP',
      GBP_RATES,
    );

    expect(converted).toBeNull();
    expect(leftovers).toEqual([
      { currency: 'XAU', amount: 1200 },
      { currency: 'XAG', amount: -400 },
    ]);
  });

  it('re-propagates a non-RATE_UNAVAILABLE error instead of silently swallowing it', () => {
    // An empty rates map makes even the viewer's own currency throw
    // RATE_UNAVAILABLE via convert() — this asserts that path is still
    // caught (not that some other error type would be), documenting the
    // catch is scoped to AppError/RATE_UNAVAILABLE only.
    const { converted, leftovers } = convertBalanceForViewer(
      [{ currency: 'USD', amount: 100 }],
      'GBP',
      {},
    );

    expect(converted).toBeNull();
    expect(leftovers).toEqual([{ currency: 'USD', amount: 100 }]);
  });
});
