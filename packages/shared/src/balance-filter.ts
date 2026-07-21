import type { CurrencyAmount } from './balances';

/**
 * Shared balance-direction filter (WI-037 Friends page / WI-038 Groups page).
 * Evaluated over a NATIVE (pre-conversion) signed per-currency list — never
 * over a converted figure, so a friend/group with opposite-sign currencies
 * correctly matches BOTH `youOwe` and `owedYou` (see spec-WI-037 D1/D2).
 */
export type BalanceFilter = 'none' | 'outstanding' | 'youOwe' | 'owedYou';

/**
 * `native`: signed per-currency amounts, positive = the counterparty owes the
 * viewer (zeros already dropped by the caller, per the DTO contract).
 */
export function matchesBalanceFilter(native: CurrencyAmount[], f: BalanceFilter): boolean {
  switch (f) {
    case 'none':
      return true;
    case 'outstanding':
      return native.length > 0;
    case 'youOwe':
      return native.some((b) => b.amount < 0);
    case 'owedYou':
      return native.some((b) => b.amount > 0);
  }
}
