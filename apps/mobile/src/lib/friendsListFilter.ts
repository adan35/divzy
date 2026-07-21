import { matchesBalanceFilter, type BalanceFilter, type FriendDto } from '@divzy/shared';

/**
 * WI-037 — Friends page balance-direction filter. Runs over the NATIVE
 * `balancesNative` field (the full signed per-currency breakdown), never
 * `balancesConverted` — a friend owed in one currency and owing in another
 * must match both `youOwe` and `owedYou` (ARCH invariant 5; spec-WI-037 D1).
 */
export function applyFriendsFilter(friends: FriendDto[], filter: BalanceFilter): FriendDto[] {
  return friends.filter((f) => matchesBalanceFilter(f.balancesNative, filter));
}

/** Friendly per-filter empty-state copy. */
export function friendsFilterEmptyMessage(filter: BalanceFilter): string {
  switch (filter) {
    case 'youOwe':
      return 'No friends you owe anything to.';
    case 'owedYou':
      return 'No friends who owe you anything.';
    case 'outstanding':
      return 'No friends with an outstanding balance.';
    case 'none':
      return 'No friends match.';
  }
}
