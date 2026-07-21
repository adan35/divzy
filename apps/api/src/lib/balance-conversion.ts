import type { CurrencyAmount } from '@divzy/shared';
import { AppError } from './errors';
import { convert } from './rates';

export interface ConvertedBalance {
  currency: string;
  amount: number;
}

export interface ConvertedBalanceResult {
  /**
   * Sum of every convertible entry's amount, converted to `viewerCurrency`;
   * null when there was nothing convertible to sum (empty input, or every
   * entry present was unconvertible).
   */
  converted: ConvertedBalance | null;
  /** Entries convert() could not resolve a rate for — left native, unchanged. */
  leftovers: CurrencyAmount[];
}

/**
 * Collapse a per-currency balance list (a group's `yourBalances`, a group
 * member's net, a friend's pairwise net, ...) into one converted figure in
 * the viewer's currency, using an already-resolved rates map.
 *
 * Callers MUST call `resolveConversionRates` exactly once per request
 * (batched across every group/friend/member being summarized) and pass the
 * resulting `rates` map in here per item — this function does no I/O itself
 * and never re-resolves rates, per spec-WI-001 (social-groups)'s "one
 * resolveConversionRates call per request" batching discipline.
 *
 * Graceful degradation (spec-WI-001, "Graceful degradation — rate
 * unavailable for one currency"): a currency `convert()` cannot resolve a
 * rate for (AppError RATE_UNAVAILABLE, even after resolveConversionRates'
 * fallback-table patch) is left out of the summed `converted` figure and
 * returned in `leftovers` (native, unconverted) instead — never dropped,
 * zeroed, or allowed to fail the whole request. Every other currency in the
 * same list still converts normally. Any non-RATE_UNAVAILABLE error
 * propagates (this is not a general try/catch-everything).
 */
export function convertBalanceForViewer(
  entries: CurrencyAmount[],
  viewerCurrency: string,
  rates: Record<string, number>,
): ConvertedBalanceResult {
  let sum = 0;
  let convertedAny = false;
  const leftovers: CurrencyAmount[] = [];

  for (const entry of entries) {
    try {
      sum += convert(entry.amount, entry.currency, viewerCurrency, rates);
      convertedAny = true;
    } catch (err) {
      if (err instanceof AppError && err.code === 'RATE_UNAVAILABLE') {
        leftovers.push(entry);
        continue;
      }
      throw err;
    }
  }

  return {
    converted: convertedAny ? { currency: viewerCurrency.toUpperCase(), amount: sum } : null,
    leftovers,
  };
}
