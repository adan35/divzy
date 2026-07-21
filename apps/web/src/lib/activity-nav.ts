import type { ActivityDto } from '@divzy/shared';

/**
 * Where clicking an activity feed row should take the viewer (WI-039,
 * ADR-022). Decided once, uniformly, per activity type/shape — never ad hoc
 * per row (story-WI-039 Story 2).
 */
export type ActivityDestination =
  | { kind: 'expense'; expenseId: string }
  | { kind: 'settlement'; settlementId: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'friend'; friendId: string }
  /** Safe, non-error fallback when a specific counterparty can't be resolved. */
  | { kind: 'friends' };

function dataString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Dispatch table for "what does clicking this activity row do" (spec-WI-039
 * §3, ADR-022). Reuses only fields already on `ActivityDto` — no new
 * endpoint, no DTO change.
 *
 * - Every `expenseId`-bearing type (§3a) opens the existing expense detail
 *   surface, regardless of whether a group is present.
 * - Every `settlementId`-bearing type (`SETTLEMENT_ADDED`/`SETTLEMENT_DELETED`,
 *   WI-039b §1) opens the settlement detail dialog in place, regardless of
 *   whether a group is present — checked right after the expense branch, so
 *   it never falls through to the group/friend/friends logic below.
 * - Everything else with a `group` (§3c membership/group events) link-throughs
 *   to that group.
 * - `FRIEND_ADDED` (§3c) resolves the *other* party: if the viewer isn't the
 *   activity's actor, the actor IS the counterparty (recipients of a 1:1
 *   event are always exactly the two parties). If the viewer IS the actor,
 *   `FRIEND_ADDED`'s `data.friendId` still resolves it (closes the
 *   historical dead-click gap). Otherwise this falls back to the friends
 *   list rather than guessing or erroring.
 */
export function resolveActivityDestination(
  activity: ActivityDto,
  viewerId: string | undefined,
): ActivityDestination {
  if (activity.expenseId) {
    return { kind: 'expense', expenseId: activity.expenseId };
  }

  if (activity.settlementId) {
    return { kind: 'settlement', settlementId: activity.settlementId };
  }

  if (activity.group) {
    return { kind: 'group', groupId: activity.group.id };
  }

  if (viewerId && activity.actor.id !== viewerId) {
    return { kind: 'friend', friendId: activity.actor.id };
  }

  if (activity.type === 'FRIEND_ADDED') {
    const friendId = dataString(activity.data ?? {}, 'friendId');
    if (friendId) return { kind: 'friend', friendId };
  }

  return { kind: 'friends' };
}
