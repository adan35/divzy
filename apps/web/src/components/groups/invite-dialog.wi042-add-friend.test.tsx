// spec-WI-042 (web half) — "Add from your friends" picker in the invite dialog.
// Additive alongside the existing invite-link/add-by-email UI. Picker is
// sourced from GET /friends (useFriends) minus the group's active members;
// selecting one calls the new by-friend endpoint via useAddMemberByFriend.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FriendDto, GroupDto } from '@divzy/shared';
import { InviteDialog } from './invite-dialog';
import { useAddMember, useAddMemberByFriend, useFriends, useRotateInviteCode } from '@/lib/hooks';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/hooks', () => ({
  useAddMember: vi.fn(),
  useAddMemberByFriend: vi.fn(),
  useRotateInviteCode: vi.fn(),
  useFriends: vi.fn(),
}));

const mockedUseAddMember = vi.mocked(useAddMember);
const mockedUseAddMemberByFriend = vi.mocked(useAddMemberByFriend);
const mockedUseRotateInviteCode = vi.mocked(useRotateInviteCode);
const mockedUseFriends = vi.mocked(useFriends);

function fixtureGroup(overrides: Partial<GroupDto> = {}): GroupDto {
  return {
    id: 'group-1',
    name: 'Roomies',
    emoji: '🏠',
    type: 'HOME',
    currency: 'USD',
    inviteCode: 'ABCDEFGHIJ',
    simplifyDebts: true,
    createdBy: { id: 'user-1', name: 'Sam Lee', avatarColor: '#000' },
    members: [
      {
        user: { id: 'user-1', name: 'Sam Lee', avatarColor: '#000' },
        role: 'ADMIN',
        joinedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fixtureFriend(overrides: Partial<FriendDto> = {}): FriendDto {
  return {
    user: { id: 'friend-1', name: 'Alex Rivera', avatarColor: '#111' },
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    balancesByGroup: [],
    lastActivityAt: null,
    ...overrides,
  };
}

describe('InviteDialog — add from friends (spec-WI-042)', () => {
  const addMemberByFriendMutate = vi.fn();

  beforeEach(() => {
    // @ts-expect-error -- test setup only
    mockedUseAddMember.mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only
    mockedUseRotateInviteCode.mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only
    mockedUseAddMemberByFriend.mockReturnValue({
      mutate: addMemberByFriendMutate,
      isPending: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('lists friends who are not already active members', () => {
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseFriends.mockReturnValue({
      data: [
        fixtureFriend({ user: { id: 'friend-1', name: 'Alex Rivera', avatarColor: '#111' } }),
        fixtureFriend({ user: { id: 'user-1', name: 'Sam Lee', avatarColor: '#000' } }), // already a member
      ],
      isLoading: false,
    });

    render(<InviteDialog open group={fixtureGroup()} isAdmin onOpenChange={() => {}} />);

    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
    expect(screen.queryByText('Sam Lee')).not.toBeInTheDocument();
  });

  it('calls useAddMemberByFriend with the group + friend userId on Add', async () => {
    const user = userEvent.setup();
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseFriends.mockReturnValue({
      data: [fixtureFriend({ user: { id: 'friend-1', name: 'Alex Rivera', avatarColor: '#111' } })],
      isLoading: false,
    });

    render(<InviteDialog open group={fixtureGroup()} isAdmin onOpenChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: /add alex rivera/i }));

    expect(addMemberByFriendMutate).toHaveBeenCalledWith(
      { groupId: 'group-1', userId: 'friend-1' },
      expect.anything(),
    );
  });

  it('shows an empty state when every friend is already an active member', () => {
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseFriends.mockReturnValue({
      data: [fixtureFriend({ user: { id: 'user-1', name: 'Sam Lee', avatarColor: '#000' } })],
      isLoading: false,
    });

    render(<InviteDialog open group={fixtureGroup()} isAdmin onOpenChange={() => {}} />);

    expect(screen.getByText(/all your friends are already in this group/i)).toBeInTheDocument();
  });
});
