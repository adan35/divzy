import type { CurrencyAmount } from './balances';
import type { FriendDto } from './types';

/**
 * Client-side accumulated "who owes what" totals across ALL friends passed in
 * (WI-049 — Friends page summary card). Callers must pass the FULL,
 * unfiltered friend list (never a pre-filtered subset), matching the story's
 * "accumulative" requirement independent of the WI-037 balance-direction
 * filter.
 */
export interface FriendsBalanceSummary {
  /** Viewer defaultCurrency; null only when NO friend had a convertible figure. */
  currency: string | null;
  /** Sum of positive balancesConverted.amount, >= 0. */
  youAreOwed: number;
  /** Absolute sum of negative balancesConverted.amount, >= 0. */
  youOwe: number;
  /** youAreOwed - youOwe (signed). */
  net: number;
  /** True if >=1 friend had a non-null balancesConverted (settled-state signal). */
  hasConvertible: boolean;
  /** Deduped (summed per currency) native currencies that could not be converted, across all friends. */
  unresolvedCurrencies: CurrencyAmount[];
  /** unresolvedCurrencies.length > 0. */
  hasUnresolved: boolean;
  /** OR of usedFallbackRates across friends that contributed to the totals (non-null balancesConverted). */
  usedFallbackRates: boolean;
}

/**
 * Pure aggregation over `GET /friends`' already-returned `FriendDto[]`
 * (spec-WI-049 §3). Semantics:
 * - Only `balancesConverted !== null` friends contribute to
 *   `youAreOwed`/`youOwe`/`net`/`currency`/`usedFallbackRates`.
 * - `balancesConverted.amount === 0` contributes 0 and does NOT flag
 *   unresolved — distinct from `balancesConverted === null`, which also
 *   contributes 0 but DOES flag unresolved when paired with a nonzero
 *   `balances` entry.
 * - Each friend's `balances` (native unconvertible leftovers) feed
 *   `unresolvedCurrencies` (summed per currency), never the numeric totals.
 * - `usedFallbackRates` is OR-ed only over friends whose converted figure
 *   actually contributed (non-null `balancesConverted`).
 */
export function computeFriendsSummary(friends: readonly FriendDto[]): FriendsBalanceSummary {
  let currency: string | null = null;
  let youAreOwed = 0;
  let youOwe = 0;
  let hasConvertible = false;
  let usedFallbackRates = false;
  const unresolvedByCurrency = new Map<string, number>();

  for (const friend of friends) {
    if (friend.balancesConverted !== null && friend.balancesConverted !== undefined) {
      hasConvertible = true;
      currency = friend.balancesConverted.currency;
      const amount = friend.balancesConverted.amount;
      if (amount > 0) {
        youAreOwed += amount;
      } else if (amount < 0) {
        youOwe += -amount;
      }
      if (friend.usedFallbackRates) usedFallbackRates = true;
    }

    for (const entry of friend.balances ?? []) {
      if (entry.amount === 0) continue;
      unresolvedByCurrency.set(entry.currency, (unresolvedByCurrency.get(entry.currency) ?? 0) + entry.amount);
    }
  }

  const unresolvedCurrencies: CurrencyAmount[] = Array.from(unresolvedByCurrency, ([c, amount]) => ({
    currency: c,
    amount,
  }));

  return {
    currency,
    youAreOwed,
    youOwe,
    net: youAreOwed - youOwe,
    hasConvertible,
    unresolvedCurrencies,
    hasUnresolved: unresolvedCurrencies.length > 0,
    usedFallbackRates,
  };
}
