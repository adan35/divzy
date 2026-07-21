import type { CurrencyAmount } from '@divzy/shared';

/**
 * Crude cross-currency magnitude used ONLY for ranking rows ("top 4 by
 * |balance|"). Never displayed — currencies are not converted here.
 *
 * `converted` is the friend/group's `balancesConverted` / `yourBalanceConverted`
 * figure (spec-WI-001). It must be included: post-WI-001, `balances` narrows to
 * unconvertible leftovers only, so in the common case (everything converts)
 * `balances` is `[]` and ranking by that array alone would rank nearly every
 * row as zero regardless of how much is actually owed.
 */
export function balanceMagnitude(
  balances: readonly CurrencyAmount[],
  converted?: { currency: string; amount: number } | null,
): number {
  const leftover = balances.reduce((acc, b) => acc + Math.abs(b.amount), 0);
  return leftover + Math.abs(converted?.amount ?? 0);
}

/**
 * Non-zero entries with the user's primary currency first, then by |amount|
 * descending (currency code as a stable tiebreak).
 */
export function orderByPrimaryCurrency(
  entries: readonly CurrencyAmount[],
  primaryCurrency: string,
): CurrencyAmount[] {
  return entries
    .filter((e) => e.amount !== 0)
    .sort((a, b) => {
      if (a.currency !== b.currency) {
        if (a.currency === primaryCurrency) return -1;
        if (b.currency === primaryCurrency) return 1;
      }
      return (
        Math.abs(b.amount) - Math.abs(a.amount) || a.currency.localeCompare(b.currency)
      );
    });
}
