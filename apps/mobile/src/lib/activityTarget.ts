import type { ActivityDto } from '@divzy/shared';

/**
 * WI-039 (ADR-022) — resolves the navigation target for a tapped activity
 * feed row, applied uniformly across the dashboard preview and the full
 * `/activity` screen (both render `ActivityRow`). Per ADR-022 §3:
 *
 * - Expense-backed items (`expenseId` set: EXPENSE_ADDED/UPDATED/DELETED,
 *   COMMENT_ADDED, RECURRING_POSTED) keep mobile's existing direct route to
 *   expenses' full detail screen — no reimplementation.
 * - Settlement-backed items (WI-039b, spec-WI-039b §8) now route straight to
 *   the modal-presented settlement detail screen at `/settlement/:id`
 *   (registered with `presentation: 'modal'` in `app/_layout.tsx`,
 *   deliberately unlike `/expense/:id`'s full-screen push) whenever
 *   `activity.settlementId` is set — which it always is at creation for both
 *   `SETTLEMENT_ADDED` and `SETTLEMENT_DELETED` (`ActivityLog` schema) —
 *   regardless of whether a group is present. This replaces the pre-WI-039b
 *   link-through to the group/friend page: the detail screen fetches the
 *   full record itself (`GET /settlements/:id`) and renders group context
 *   conditionally, so the old counterparty-resolution gap (the `data`
 *   payload only carrying `fromName`/`toName`, never `fromUserId`/
 *   `toUserId`) is now moot for this case — nothing needs pre-resolving
 *   client-side anymore. The old group/friend link-through is kept only as a
 *   defensive fallback for a corrupt/legacy row with no `settlementId`.
 * - Membership/group items (§3c) link through to the group page — mobile's
 *   existing baseline, preserved.
 * - `FRIEND_ADDED` (§3c) now resolves to the friend's page instead of being
 *   disabled — closing the one previously dead-click case. The activity
 *   producer (`apps/api/src/routes/friends.ts`) always fans out to both
 *   parties with `data.friendId` fixed to the *actor's* counterparty, so the
 *   viewer's own friend target is `data.friendId` when the viewer is the
 *   actor, else the actor themself.
 *
 * Exhaustive over every `ActivityType` (ADR-022 §3e) — the `never` check
 * below is a compile-time guarantee no type is added without updating this
 * dispatch.
 */
export function resolveActivityTarget(
  activity: ActivityDto,
  currentUserId?: string,
): string | null {
  // Expense-backed types are handled first and unconditionally: the
  // `expenseId` survives independent of `type` narrowing below, and this
  // preserves mobile's existing behavior byte-for-byte (WI-036 §4).
  if (activity.expenseId) return `/expense/${activity.expenseId}`;

  switch (activity.type) {
    case 'EXPENSE_ADDED':
    case 'EXPENSE_UPDATED':
    case 'EXPENSE_DELETED':
    case 'EXPENSE_RESTORED':
    case 'COMMENT_ADDED':
    case 'RECURRING_POSTED':
      // expenseId-bearing types with no expenseId in hand (e.g. a corrupt
      // or legacy row) — fall back to the group rather than a dead click.
      // (WI-054 §3 — EXPENSE_RESTORED rows never reach the paginated feed
      // as their own row anyway, since terminal types are collapsed into
      // their ADDED anchor; this case exists for exhaustiveness and the
      // same defensive fallback as its siblings.)
      return activity.group ? `/group/${activity.group.id}` : null;

    case 'SETTLEMENT_ADDED':
    case 'SETTLEMENT_DELETED':
    case 'SETTLEMENT_RESTORED': {
      if (activity.settlementId) return `/settlement/${activity.settlementId}`;
      // Defensive fallback only — settlementId is always populated for
      // these types at creation; this branch guards a corrupt/legacy
      // row, preserving the pre-WI-039b link-through so it's never a dead
      // click rather than a route to a settlement id that doesn't exist.
      if (activity.group) return `/group/${activity.group.id}`;
      if (activity.actor.id !== currentUserId) return `/friend/${activity.actor.id}`;
      return '/(tabs)/friends';
    }

    case 'GROUP_CREATED':
    case 'GROUP_UPDATED':
    case 'MEMBER_JOINED':
    case 'MEMBER_LEFT':
    case 'MEMBER_REMOVED':
      return activity.group ? `/group/${activity.group.id}` : null;

    case 'FRIEND_ADDED': {
      const dataFriendId =
        typeof activity.data?.['friendId'] === 'string'
          ? (activity.data['friendId'] as string)
          : null;
      const friendId = activity.actor.id === currentUserId ? dataFriendId : activity.actor.id;
      return friendId ? `/friend/${friendId}` : null;
    }

    default: {
      const _exhaustive: never = activity.type;
      return _exhaustive;
    }
  }
}
