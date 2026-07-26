'use client';

import type { CurrencyAmount, GroupBalancesDto, PublicUserDto } from '@divzy/shared';
import { collapsedBalanceEntries } from '@/lib/balance-display';

export interface MemberPosition {
  user: PublicUserDto;
  entries: CurrencyAmount[];
}

/**
 * Derive caller-relative positions from the existing pairwise exact-debts array.
 * Positive amounts mean the member owes the caller; negative means the caller owes
 * the member. Converted totals are summed from pairwise.convertedAmount when present;
 * unconverted rows stay as native leftovers.
 *
 * WI-086: the `GroupMemberSettlements` panel was removed, but this derivation is
 * still consumed by `BalancesView` for clickable member rows (WI-085 item 3), so it
 * stays exported from this file.
 */
export function derivePositions(data: GroupBalancesDto, meId: string): MemberPosition[] {
  return data.members
    .filter((m) => m.user.id !== meId)
    .map((m) => {
      const native: CurrencyAmount[] = [];
      let convertedTotal = 0;
      for (const row of data.pairwise) {
        if (row.fromUserId === meId && row.toUserId === m.user.id) {
          // Caller owes member.
          native.push({ currency: row.currency, amount: -row.amount });
          if (row.convertedAmount !== undefined) convertedTotal -= row.convertedAmount;
        } else if (row.fromUserId === m.user.id && row.toUserId === meId) {
          // Member owes caller.
          native.push({ currency: row.currency, amount: row.amount });
          if (row.convertedAmount !== undefined) convertedTotal += row.convertedAmount;
        }
      }
      const converted =
        convertedTotal !== 0
          ? { currency: data.viewerCurrency, amount: convertedTotal }
          : null;
      return { user: m.user, entries: collapsedBalanceEntries(converted, native) };
    });
}
