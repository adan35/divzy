// Test-stage functional/black-box coverage — story-WI-003 (settlements).
//
// Written by test-settlements from story-WI-003's Gherkin scenarios directly.
// build-WI-003.md explicitly notes "SettleUpDialog itself has no dedicated
// unit test in this build" — this closes that gap by rendering the real
// component and asserting the settlements-owned contract social-groups'
// header button relies on: a bare `groupId` (no `prefill`) pre-scopes party
// candidates to that group's members, exactly as spec-WI-003 states.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { FriendDto, GroupDto, UserDto } from '@divzy/shared';
import { SettleUpDialog } from './settle-dialog';
import { useAuth } from '@/lib/auth-store';
import {
  useCreateSettlement,
  useFriends,
  useGroup,
  useGroupBalances,
  useUploadReceipt,
} from '@/lib/hooks';

vi.mock('@/lib/auth-store', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks')>();
  return {
    ...actual,
    useGroup: vi.fn(),
    useFriends: vi.fn(),
    useCreateSettlement: vi.fn(),
    useGroupBalances: vi.fn(),
    // WI-023: SettleUpDialog now also calls `useUploadReceipt` for the
    // optional proof attachment — stub it out, unrelated to this pre-scoping test.
    useUploadReceipt: vi.fn(),
  };
});

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseGroup = vi.mocked(useGroup);
const mockedUseFriends = vi.mocked(useFriends);
const mockedUseCreateSettlement = vi.mocked(useCreateSettlement);
const mockedUseGroupBalances = vi.mocked(useGroupBalances);
const mockedUseUploadReceipt = vi.mocked(useUploadReceipt);

function user(id: string, name: string): UserDto {
  return {
    id,
    name,
    avatarColor: '#123456',
    email: `${id}@example.com`,
    defaultCurrency: 'USD',
    emailNotifications: true,
    staleBalanceRemindersEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const me = user('user_id_1', 'Me');
const bob = user('user_id_2', 'Bob');
const cara = user('user_id_3', 'Cara');

function fixtureGroup(id: string, name: string): GroupDto {
  return {
    id,
    name,
    emoji: '🎿',
    type: 'TRIP',
    currency: 'EUR',
    inviteCode: 'ABCDEFGHIJ',
    simplifyDebts: true,
    createdBy: me,
    members: [
      { user: me, role: 'ADMIN', joinedAt: '2026-01-01T00:00:00.000Z' },
      { user: bob, role: 'MEMBER', joinedAt: '2026-01-02T00:00:00.000Z' },
    ],
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function groupQuery(data: GroupDto | undefined) {
  return { data, isLoading: false, isError: false, error: null } as unknown as ReturnType<
    typeof useGroup
  >;
}

function fixtureFriend(u: UserDto): FriendDto {
  return {
    user: u,
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    lastActivityAt: null,
  };
}

function friendsQuery(data: FriendDto[]) {
  return { data, isLoading: false, isError: false, error: null } as unknown as ReturnType<
    typeof useFriends
  >;
}

function mutationStub() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
  } as unknown as ReturnType<typeof useCreateSettlement>;
}

function uploadStub() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
  } as unknown as ReturnType<typeof useUploadReceipt>;
}

describe('SettleUpDialog — pre-scoping contract for story-WI-003', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ user: me, status: 'authed' });
    mockedUseCreateSettlement.mockReturnValue(mutationStub());
    mockedUseUploadReceipt.mockReturnValue(uploadStub());
    // "Ski Trip 2026" — friend Cara is NOT a member, only a friend outside the group.
    mockedUseFriends.mockReturnValue(friendsQuery([fixtureFriend(cara)]));
    // WI-012: balance query still loading/absent — the balance gate stays
    // inactive, out of scope for this pre-scoping-only test file.
    mockedUseGroupBalances.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useGroupBalances>);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("Edge case — pre-scoping matches the group context: called with only groupId (no prefill), candidates are exactly that group's members", () => {
    mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup('group_ski_2026', 'Ski Trip 2026')));

    render(<SettleUpDialog open onOpenChange={() => {}} groupId="group_ski_2026" />);

    expect(useGroup).toHaveBeenCalledWith('group_ski_2026', true);

    // Both selects ("From"/"To") list only the group's members (Me, Bob) —
    // never the group-external friend (Cara), proving pre-scoping to the
    // group context rather than a generic unscoped settle flow.
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(['Me (you)', 'Bob', 'Me (you)', 'Bob']));
    expect(options.join(' ')).not.toContain('Cara');
  });

  it('Happy path — opens pre-scoped and usable with no prefill: "From" defaults to the current user, ready to submit once "To" and amount are set', () => {
    mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup('group_ski_2026', 'Ski Trip 2026')));

    render(<SettleUpDialog open onOpenChange={() => {}} groupId="group_ski_2026" />);

    const fromSelect = screen.getByLabelText('From') as HTMLSelectElement;
    expect(fromSelect.value).toBe(me.id);
    // A recipient was auto-picked from the group's other members (Bob).
    const toSelect = screen.getByLabelText('To') as HTMLSelectElement;
    expect(toSelect.value).toBe(bob.id);
  });

  it('without a groupId, candidates instead come from the friends list (unscoped flow, unchanged)', () => {
    mockedUseGroup.mockReturnValue(groupQuery(undefined));

    render(<SettleUpDialog open onOpenChange={() => {}} />);

    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options.join(' ')).toContain('Cara');
    expect(options.join(' ')).not.toContain('Bob');
  });
});
