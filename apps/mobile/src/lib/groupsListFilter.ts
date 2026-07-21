import { matchesBalanceFilter, type BalanceFilter, type GroupSummaryDto } from '@divzy/shared';

export interface GroupFilterOptions {
  /** WI-028 — hide group-wide `settled === true` groups. Default off. */
  unsettledOnly: boolean;
  /** WI-038 — viewer-net direction filter. Default 'none' (show all). */
  balanceFilter: BalanceFilter;
}

/**
 * Applies WI-028's "unsettled only" toggle and WI-038's balance-direction
 * filter as two independent AND conditions. Both run over the NATIVE,
 * pre-conversion fields (`settled`/`yourBalancesNative`) per ARCH invariant
 * 5 — never a converted figure. Deliberately does not touch the
 * archived/active split (`splitArchived`), which composes independently, per
 * spec-WI-038's D2 explicit warning not to conflate the two questions
 * ("group-wide settled" vs "viewer's own net direction").
 */
export function applyGroupFilters(
  groups: GroupSummaryDto[],
  options: GroupFilterOptions,
): GroupSummaryDto[] {
  return groups.filter((g) => {
    if (options.unsettledOnly && g.settled) return false;
    if (!matchesBalanceFilter(g.yourBalancesNative, options.balanceFilter)) return false;
    return true;
  });
}

/** Splits an already-filtered group list into active/archived, each most-recent first. */
export function splitArchived(groups: GroupSummaryDto[]): {
  active: GroupSummaryDto[];
  archived: GroupSummaryDto[];
} {
  const active = groups
    .filter((g) => g.archivedAt === null)
    .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''));
  const archived = groups
    .filter((g) => g.archivedAt !== null)
    .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));
  return { active, archived };
}

/** Friendly empty-state copy for the current filter combination. */
export function groupsFilterEmptyMessage(balanceFilter: BalanceFilter, unsettledOnly: boolean): string {
  switch (balanceFilter) {
    case 'youOwe':
      return 'No groups where you owe anything.';
    case 'owedYou':
      return 'No groups where you are owed anything.';
    case 'outstanding':
      return 'No groups with an outstanding balance.';
    case 'none':
      return unsettledOnly ? 'No unsettled groups — everything is settled up.' : 'No groups match.';
  }
}
