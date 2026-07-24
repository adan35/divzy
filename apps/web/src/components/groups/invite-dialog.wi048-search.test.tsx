// spec-WI-048 — search/filter the "Add from your friends" list in the invite
// dialog. Case-insensitive substring match mirroring mobile's
// `filterBySearch` (apps/mobile/src/lib/searchFilter.ts): plain
// `.trim().toLowerCase().includes(...)`, no accent folding, no relevance
// re-sort. Display-only — must not touch useAddMemberByFriend mechanics.
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

describe('InviteDialog — search/filter add-from-friends (spec-WI-048)', () => {
  beforeEach(() => {
    // @ts-expect-error -- test setup only
    mockedUseAddMember.mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only
    mockedUseRotateInviteCode.mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only
    mockedUseAddMemberByFriend.mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseFriends.mockReturnValue({
      data: [
        fixtureFriend({ user: { id: 'friend-1', name: 'Alex Rivera', avatarColor: '#111' } }),
        fixtureFriend({ user: { id: 'friend-2', name: 'Bailey Chen', avatarColor: '#222' } }),
        fixtureFriend({ user: { id: 'friend-3', name: 'Casey ALEXANDER', avatarColor: '#333' } }),
      ],
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders a search input above the friend list', () => {
    render(<InviteDialog open group={fixtureGroup()} isAdmin onOpenChange={() => {}} />);
    expect(screen.getByPlaceholderText(/search friends/i)).toBeInTheDocument();
  });

  it('shows the full unfiltered list, in existing order, when the query is empty', () => {
    render(<InviteDialog open group={fixtureGroup()} isAdmin onOpenChange={() => {}} />);
    const names = screen.getAllByText(/Alex Rivera|Bailey Chen|Casey ALEXANDER/).map((el) => el.textContent);
    expect(names).toEqual(['Alex Rivera', 'Bailey Chen', 'Casey ALEXANDER']);
  });

  it('filters by case-insensitive substring match against friend name', async () => {
    const user = userEvent.setup();
    render(<InviteDialog open group={fixtureGroup()} isAdmin onOpenChange={() => {}} />);

    await user.type(screen.getByPlaceholderText(/search friends/i), 'alex');

    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
    expect(screen.getByText('Casey ALEXANDER')).toBeInTheDocument();
    expect(screen.queryByText('Bailey Chen')).not.toBeInTheDocument();
  });

  it('shows a distinct "no friends match your search" message when the query matches nothing', async () => {
    const user = userEvent.setup();
    render(<InviteDialog open group={fixtureGroup()} isAdmin onOpenChange={() => {}} />);

    await user.type(screen.getByPlaceholderText(/search friends/i), 'zzz-nomatch');

    expect(screen.getByText(/no friends match your search/i)).toBeInTheDocument();
    expect(screen.queryByText(/all your friends are already in this group/i)).not.toBeInTheDocument();
  });

  it('shows the "all your friends are already in this group" empty state when there are zero addable friends, regardless of search text', async () => {
    const user = userEvent.setup();
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseFriends.mockReturnValue({
      data: [fixtureFriend({ user: { id: 'user-1', name: 'Sam Lee', avatarColor: '#000' } })], // already a member
      isLoading: false,
    });

    render(<InviteDialog open group={fixtureGroup()} isAdmin onOpenChange={() => {}} />);
    expect(screen.getByText(/all your friends are already in this group/i)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/search friends/i), 'anything');
    expect(screen.getByText(/all your friends are already in this group/i)).toBeInTheDocument();
    expect(screen.queryByText(/no friends match your search/i)).not.toBeInTheDocument();
  });

  it('does not change the add-friend mutation call when filtered', async () => {
    const addMemberByFriendMutate = vi.fn();
    // @ts-expect-error -- test setup only
    mockedUseAddMemberByFriend.mockReturnValue({ mutate: addMemberByFriendMutate, isPending: false });
    const user = userEvent.setup();

    render(<InviteDialog open group={fixtureGroup()} isAdmin onOpenChange={() => {}} />);
    await user.type(screen.getByPlaceholderText(/search friends/i), 'alex riv');
    await user.click(screen.getByRole('button', { name: /add alex rivera/i }));

    expect(addMemberByFriendMutate).toHaveBeenCalledWith(
      { groupId: 'group-1', userId: 'friend-1' },
      expect.anything(),
    );
  });
});
