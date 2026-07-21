// Build-stage TDD coverage for spec-WI-068 §7 / story AC-7a — the settle
// celebration is wired into `SettleUpDialog`'s `useCreateSettlement`
// `onSuccess`, alongside the existing (unchanged-copy) success toast, and
// fires ONLY on success — never on failure. Mirrors
// settle-dialog.wi023-proof.test.tsx's mocking approach (useAuth/useGroup/
// useFriends/useCreateSettlement/useGroupBalances/useUploadReceipt), plus a
// mocked `@/lib/celebrate` (a foundation/S1 primitive — already unit-tested
// in celebrate.test.tsx; this file only proves the call-site wiring).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FriendDto, GroupBalancesDto, GroupDto, UserDto } from '@divzy/shared';
import { SettleUpDialog } from './settle-dialog';
import { celebrate } from '@/lib/celebrate';
import { useAuth } from '@/lib/auth-store';
import {
  useCreateSettlement,
  useFriends,
  useGroup,
  useGroupBalances,
  useUploadReceipt,
} from '@/lib/hooks';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/celebrate', () => ({ celebrate: vi.fn() }));
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
const mockedCelebrate = vi.mocked(celebrate);

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

function fixtureGroup(): GroupDto {
  return {
    id: 'group_ski_2026',
    name: 'Ski Trip 2026',
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

/** Mutation stub whose `mutate` synchronously fires the caller's onSuccess/onError. */
function mutationStub(kind: 'success' | 'error' = 'success') {
  return {
    mutate: vi.fn(
      (
        _input: unknown,
        opts?: { onSuccess?: () => void; onError?: () => void },
      ) => {
        if (kind === 'success') opts?.onSuccess?.();
        else opts?.onError?.();
      },
    ),
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

describe('SettleUpDialog — WI-068 §7 settle celebration (AC-7a)', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ user: me, status: 'authed' });
    mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup()));
    mockedUseFriends.mockReturnValue(friendsQuery([]));
    mockedUseUploadReceipt.mockReturnValue(uploadStub());
    mockedUseGroupBalances.mockReturnValue(
      groupBalancesQuery(
        fixtureGroupBalances([
          { user: me, balances: [{ currency: 'EUR', amount: -5000 }] },
          { user: bob, balances: [{ currency: 'EUR', amount: 5000 }] },
        ]),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('fires celebrate() exactly once on a successful settlement, alongside the unchanged success toast', async () => {
    const { toast } = await import('sonner');
    mockedUseCreateSettlement.mockReturnValue(mutationStub('success'));
    const testUser = userEvent.setup();

    render(<SettleUpDialog open onOpenChange={() => {}} groupId="group_ski_2026" />);

    await testUser.type(screen.getByLabelText('Amount'), '10');
    await testUser.click(screen.getByRole('button', { name: /record payment/i }));

    expect(mockedCelebrate).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(
      '💸 Payment recorded',
      expect.objectContaining({ description: expect.stringContaining('Feels lighter already') }),
    );
  });

  it('does NOT fire celebrate() when the mutation fails', async () => {
    mockedUseCreateSettlement.mockReturnValue(mutationStub('error'));
    const testUser = userEvent.setup();

    render(<SettleUpDialog open onOpenChange={() => {}} groupId="group_ski_2026" />);

    await testUser.type(screen.getByLabelText('Amount'), '10');
    await testUser.click(screen.getByRole('button', { name: /record payment/i }));

    expect(mockedCelebrate).not.toHaveBeenCalled();
  });
});
