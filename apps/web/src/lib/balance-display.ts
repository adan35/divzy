import type { CurrencyAmount } from '@divzy/shared';

/** The shape `yourBalanceConverted` / `balancesConverted` share (spec-WI-001). */
export interface ConvertedBalanceAmount {
  currency: string;
  amount: number;
}

/**
 * Collapses a converted figure + native leftovers into the single ordered
 * list a balance surface renders, per spec-WI-001's "Rendering contract for
 * clients" (identical rule for `GroupSummaryDto.yourBalanceConverted` /
 * `yourBalances` and `FriendDto.balancesConverted` / `balances`):
 *
 *   1. the converted figure (if present and non-zero) as the one converted line,
 *   2. then any leftover entries (currencies that had no resolvable rate) as
 *      native-currency lines, exactly as they render today,
 *   3. "settled up" only when both are empty — never a bare "You owe £0.00".
 *
 * Callers render each returned entry with their own existing per-currency
 * line component (`formatMoney`, `balanceSentence`, `BalanceSentence`, ...);
 * this function only decides which entries exist and in what order.
 */
export function collapsedBalanceEntries(
  converted: ConvertedBalanceAmount | null | undefined,
  leftover: readonly CurrencyAmount[],
): CurrencyAmount[] {
  const entries: CurrencyAmount[] = [];
  if (converted && converted.amount !== 0) {
    entries.push({ currency: converted.currency, amount: converted.amount });
  }
  entries.push(...leftover);
  return entries;
}

/**
 * WI-012: true when a friend's real balance is zero across every currency —
 * the single source of truth for gating the non-group "Settle Up" action
 * (friend detail open-time disable, dashboard-quick-action resolve-time
 * disable). Reads `balancesConverted` only as a **boolean** "is anything
 * outstanding at all" check, never to size or authorize a settlement, so
 * this stays compliant with charter ARCH invariant 5 — when the real
 * per-currency ledger (`balances`) is empty the converted total is
 * necessarily also zero, so the boolean is faithful; a non-empty native
 * leftover always keeps this false regardless of the converted figure.
 */
export function friendHasNothingOutstanding(
  converted: ConvertedBalanceAmount | null | undefined,
  leftover: readonly CurrencyAmount[],
): boolean {
  return leftover.length === 0 && (!converted || converted.amount === 0);
}
