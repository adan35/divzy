import type { FriendDto, GroupDto } from '@divzy/shared';

/**
 * WI-042 — the "add an existing friend directly to this group" picker's
 * candidate list: the caller's friends minus the group's currently ACTIVE
 * members. A friend who previously left the group (no active `GroupMember`
 * row) is still offered — selecting them reactivates that row server-side
 * (`activateMembership`), per the spec's explicit AC.
 */
export function friendsNotInGroup(friends: FriendDto[], group: GroupDto): FriendDto[] {
  const activeIds = new Set(group.members.map((m) => m.user.id));
  return friends.filter((f) => !activeIds.has(f.user.id));
}
