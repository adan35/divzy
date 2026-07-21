import type { CurrencyAmount, GroupBalancesDto } from '@divzy/shared';

/** The shape `yourBalanceConverted` / `balancesConverted` share (spec-WI-001). */
export interface ConvertedBalanceAmount {
  currency: string;
  amount: number;
}

/**
 * Collapses a converted figure + native leftovers into the single ordered
 * list a balance surface renders, per spec-WI-001's "Rendering contract for
 * clients" (identical rule for `GroupSummaryDto.yourBalanceConverted` /
 * `yourBalances` and `FriendDto.balancesConverted` / `balances`, including
 * the 2026-07-14 `GET /friends` addendum):
 *
 *   1. the converted figure (if present and non-zero) as the one converted line,
 *   2. then any leftover entries (currencies that had no resolvable rate) as
 *      native-currency lines, exactly as they render today,
 *   3. "settled up" only when both are empty — never a bare "You owe £0.00".
 *
 * Mirrors web's `apps/web/src/lib/balance-display.ts` exactly so mobile and
 * web never diverge on the collapsing convention. Callers render each
 * returned entry with their own existing per-currency line component
 * (`balanceSentence`, `MoneyText`, ...); this function only decides which
 * entries exist and in what order.
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
 * From a native `CurrencyAmount[]` column (e.g. `youOwe`/`youAreOwed`, or a
 * member's `balances`), returns only the entries whose currency appears in
 * `unresolved` — the flagged, native-currency fallback lines shown
 * alongside a collapsed converted figure so nothing is silently dropped,
 * zeroed, or misconverted (spec-WI-001 `converted.unresolved` /
 * `convertedNet.unresolved`; story-WI-002 "declines/dismisses" edge case).
 */
export function unresolvedNativeLines(
  amounts: CurrencyAmount[],
  unresolved: CurrencyAmount[],
): CurrencyAmount[] {
  const unresolvedCurrencies = new Set(unresolved.map((u) => u.currency));
  return amounts.filter((a) => unresolvedCurrencies.has(a.currency));
}

/**
 * Dedupes unresolved currencies across every group member's `convertedNet`
 * (settled members omit the field entirely and contribute nothing) into a
 * single list — the trigger signal for the group Balances tab's manual-rate
 * prompt (spec-WI-002, "shared hook/component... called with their own
 * `unresolved` list from GET /groups/:groupId/balances").
 */
export function collectUnresolvedCurrencies(
  members: GroupBalancesDto['members'],
): CurrencyAmount[] {
  const seen = new Map<string, CurrencyAmount>();
  for (const member of members) {
    for (const entry of member.convertedNet?.unresolved ?? []) {
      if (!seen.has(entry.currency)) seen.set(entry.currency, entry);
    }
  }
  return [...seen.values()];
}
