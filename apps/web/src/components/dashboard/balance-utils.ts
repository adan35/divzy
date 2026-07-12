import type { CurrencyAmount } from '@divzy/shared';

/**
 * Crude cross-currency magnitude used ONLY for ranking rows ("top 4 by
 * |balance|"). Never displayed — currencies are not converted here.
 */
export function balanceMagnitude(balances: readonly CurrencyAmount[]): number {
  return balances.reduce((acc, b) => acc + Math.abs(b.amount), 0);
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
