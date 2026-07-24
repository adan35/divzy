// Test-stage permanent regression coverage — spec-WI-024 / ADR-021.
//
// build-WI-024.md's own TDD evidence used a *temporary* verification test
// ("settle-dialog.wi024-verify.test.tsx", explicitly removed after use —
// "Test stage owns the permanent test plan"). This file is that permanent
// guard: the shared `SettleUpDialog` is a persistent controlled component
// (mounted once, shown/hidden via `open`), so a warm-cache re-open must
// resolve the counterparty identically to the first open — the core WI-024
// regression — and a user's in-progress party override must never be
// clobbered by late-arriving async data — the WI-021 mid-interaction case
// spec-WI-024 folds into this same fix (ADR-021).
//
// Mirrors settle-dialog.wi012-balance-gate.test.tsx's mocking approach.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FriendDto, GroupBalancesDto, GroupDto, UserDto } from '@divzy/shared';
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
    defaultCurrency: 'EUR',
    emailNotifications: true,
    staleBalanceRemindersEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const me = user('user_id_1', 'Me');
const bob = user('user_id_2', 'Bob');
const cara = user('user_id_3', 'Cara');

function fixtureGroup(members: UserDto[]): GroupDto {
  return {
    id: 'group_ski_2026',
    name: 'Ski Trip 2026',
    emoji: '🎿',
    type: 'TRIP',
    currency: 'EUR',
    inviteCode: 'ABCDEFGHIJ',
    simplifyDebts: true,
    createdBy: me,
    members: members.map((u, i) => ({
      user: u,
      role: i === 0 ? 'ADMIN' : 'MEMBER',
      joinedAt: '2026-01-01T00:00:00.000Z',
    })),
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function fixtureFriendDto(overrides: Partial<FriendDto> = {}): FriendDto {
  return {
    user: bob,
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    balancesByGroup: [],
    lastActivityAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function groupQuery(data: GroupDto | undefined) {
  return { data, isLoading: false, isError: false, error: null } as unknown as ReturnType<
    typeof useGroup
  >;
}

function friendsQuery(data: FriendDto[]) {
  return { data, isLoading: false, isError: false, error: null } as unknown as ReturnType<
    typeof useFriends
  >;
}

function groupBalancesQuery(data: GroupBalancesDto | undefined) {
  return {
    data,
    isLoading: data === undefined,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useGroupBalances>;
}

function fixtureGroupBalances(members: GroupBalancesDto['members']): GroupBalancesDto {
  return {
    groupId: 'group_ski_2026',
    viewerCurrency: 'EUR',
    usedFallbackRates: false,
    members,
    pairwise: [],
    suggestions: [],
  };
}

function mutationStub(overrides: Partial<ReturnType<typeof useCreateSettlement>> = {}) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
    ...overrides,
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

describe('SettleUpDialog — WI-024/WI-021 party-resolution regression (ADR-021)', () => {
  let mutation: ReturnType<typeof mutationStub>;

  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ user: me, status: 'authed' });
    mockedUseUploadReceipt.mockReturnValue(uploadStub());
    mutation = mutationStub();
    mockedUseCreateSettlement.mockReturnValue(mutation);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('baseline (first open): a zero-net-balance group counterparty shows the message and disables amount + submit', async () => {
    mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup([me, bob])));
    mockedUseFriends.mockReturnValue(friendsQuery([]));
    mockedUseGroupBalances.mockReturnValue(groupBalancesQuery(fixtureGroupBalances([])));

    render(<SettleUpDialog open onOpenChange={() => {}} groupId="group_ski_2026" />);

    expect(await screen.findByText('Nothing outstanding with Bob in this group')).toBeInTheDocument();
    expect(screen.getByLabelText('Amount')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
  });

  it('WI-024 regression: closing and re-opening the SAME mounted dialog (warm query cache) reproduces the identical message + disabled state', async () => {
    mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup([me, bob])));
    mockedUseFriends.mockReturnValue(friendsQuery([]));
    mockedUseGroupBalances.mockReturnValue(groupBalancesQuery(fixtureGroupBalances([])));

    const { rerender } = render(
      <SettleUpDialog open onOpenChange={() => {}} groupId="group_ski_2026" />,
    );
    expect(await screen.findByText('Nothing outstanding with Bob in this group')).toBeInTheDocument();

    // Close (no remount — same component instance, warm cache) ...
    rerender(<SettleUpDialog open={false} onOpenChange={() => {}} groupId="group_ski_2026" />);
    // ... and re-open. Pre-fix, the stale-closure "fill blanks" effect would
    // leave `toUserId` at '' here and neither the message nor the disabled
    // state would reappear.
    rerender(<SettleUpDialog open onOpenChange={() => {}} groupId="group_ski_2026" />);

    expect(await screen.findByText('Nothing outstanding with Bob in this group')).toBeInTheDocument();
    expect(screen.getByLabelText('Amount')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
  });

  it('WI-024 regression holds across 5 consecutive close/re-open cycles', async () => {
    mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup([me, bob])));
    mockedUseFriends.mockReturnValue(friendsQuery([]));
    mockedUseGroupBalances.mockReturnValue(groupBalancesQuery(fixtureGroupBalances([])));

    const { rerender } = render(
      <SettleUpDialog open onOpenChange={() => {}} groupId="group_ski_2026" />,
    );

    for (let i = 0; i < 5; i++) {
      expect(
        await screen.findByText('Nothing outstanding with Bob in this group'),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Amount')).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();

      rerender(<SettleUpDialog open={false} onOpenChange={() => {}} groupId="group_ski_2026" />);
      rerender(<SettleUpDialog open onOpenChange={() => {}} groupId="group_ski_2026" />);
    }
  });

  it('dashboard-style open (no groupId, no prefill) with a zero-balance friend disables submit pre-submit and never calls the mutation', async () => {
    mockedUseGroup.mockReturnValue(groupQuery(undefined));
    mockedUseFriends.mockReturnValue(
      friendsQuery([fixtureFriendDto({ balances: [], balancesConverted: null })]),
    );

    render(<SettleUpDialog open onOpenChange={() => {}} />);

    expect(await screen.findByText('Nothing outstanding with Bob')).toBeInTheDocument();
    expect(screen.getByLabelText('Amount')).toBeDisabled();
    const submit = screen.getByRole('button', { name: 'Record payment' });
    expect(submit).toBeDisabled();

    // Even if a click somehow landed on the disabled button, assert no
    // mutation was ever fired — the gate must block pre-submit, not just
    // rely on the server's 400.
    expect(mutation.mutate).not.toHaveBeenCalled();
  });

  it('WI-021: a user-selected "To" survives late-arriving group balances data, and the gate re-evaluates against it', async () => {
    // Three candidates already present at open (from useGroup — party
    // candidates and balances are separate queries), but the balances query
    // (`useGroupBalances`) has not resolved yet.
    mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup([me, bob, cara])));
    mockedUseFriends.mockReturnValue(friendsQuery([]));
    mockedUseGroupBalances.mockReturnValue(groupBalancesQuery(undefined));

    const { rerender } = render(
      <SettleUpDialog open onOpenChange={() => {}} groupId="group_ski_2026" />,
    );
    await screen.findByLabelText('To');

    // Default "To" would be Bob (first candidate other than Me) — override
    // it to Cara before the balances query resolves.
    const testUser = userEvent.setup();
    await testUser.selectOptions(screen.getByLabelText('To'), cara.id);
    expect((screen.getByLabelText('To') as HTMLSelectElement).value).toBe(cara.id);

    // No balance gate message yet — the balances query hasn't resolved.
    expect(screen.queryByText(/nothing outstanding/i)).not.toBeInTheDocument();

    // Balances query resolves (same mounted instance — no remount) — Cara
    // owes/is owed nothing from Me.
    mockedUseGroupBalances.mockReturnValue(groupBalancesQuery(fixtureGroupBalances([])));
    rerender(<SettleUpDialog open onOpenChange={() => {}} groupId="group_ski_2026" />);

    // The override survives (not reset to the original default Bob) and the
    // gate now evaluates against Cara, not Bob.
    expect((screen.getByLabelText('To') as HTMLSelectElement).value).toBe(cara.id);
    expect(await screen.findByText('Nothing outstanding with Cara in this group')).toBeInTheDocument();
  });
});
