import { describe, expect, it } from 'vitest';
import type { FriendDto, GroupDto } from '@divzy/shared';
import { friendsNotInGroup } from './friendPicker';

// Tests written from spec-WI-042 (Direct add an existing friend to a group)
// before friendPicker.ts exists. Pins: the picker offers only the caller's
// friends who are NOT already active members of the group — a friend who
// previously left (no active GroupMember row) is still offered, since
// re-adding them reactivates the row (spec's explicit AC).

function friend(id: string, name: string): FriendDto {
  return {
    user: { id, name, avatarColor: '#000' },
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    balancesByGroup: [],
    lastActivityAt: null,
  };
}

function group(memberIds: string[]): GroupDto {
  return {
    id: 'g1',
    name: 'Trip',
    emoji: '✈️',
    type: 'TRIP',
    currency: 'USD',
    inviteCode: 'ABCDEFGHIJ',
    simplifyDebts: true,
    createdBy: { id: memberIds[0] ?? 'u0', name: 'Creator', avatarColor: '#000' },
    members: memberIds.map((id) => ({
      user: { id, name: id, avatarColor: '#000' },
      role: 'MEMBER' as const,
      joinedAt: '2026-07-01T00:00:00.000Z',
    })),
    archivedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

describe('friendsNotInGroup', () => {
  it('excludes friends who are already active members', () => {
    const friends = [friend('a', 'Alex'), friend('b', 'Bilal')];
    const result = friendsNotInGroup(friends, group(['a']));
    expect(result.map((f) => f.user.id)).toEqual(['b']);
  });

  it('offers every friend when none are members', () => {
    const friends = [friend('a', 'Alex'), friend('b', 'Bilal')];
    const result = friendsNotInGroup(friends, group([]));
    expect(result.map((f) => f.user.id)).toEqual(['a', 'b']);
  });

  it('returns an empty list when every friend is already a member', () => {
    const friends = [friend('a', 'Alex')];
    const result = friendsNotInGroup(friends, group(['a', 'c']));
    expect(result).toEqual([]);
  });
});
