// Build-stage TDD coverage for spec-WI-013 / ADR-011 — the group-scoped
// client clamp is widened from the net-position reachability ceiling alone
// (WI-012 Revision 2) to max(netCeiling, bilateral pairwise debt), so a
// genuinely-owed but net-chain-invisible debt (WI-013's unsimplified
// "Simplify debts" OFF list) is never wrongly clamped to zero. Uses ADR-011's
// own worked counterexample: B pays 100 (A owes B 100), A pays 100 (C owes A
// 100) -> nets A=0, B=+100, C=-100; pairwise A->B 100, C->A 100; suggestion
// C->B 100 (A drops out of the net-ceiling picture entirely).
// Mirrors settle-dialog.wi012-balance-gate.test.tsx's mocking approach.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatMoney, type GroupBalancesDto, type GroupDto, type UserDto } from '@divzy/shared';
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
    // optional proof attachment — stub it out, unrelated to this ADR-011 test.
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

const me = user('user_id_a', 'A'); // ADR-011's "A" — the chain's middle link
const bob = user('user_id_b', 'B');
const cara = user('user_id_c', 'C');

function fixtureGroup(): GroupDto {
  return {
    id: 'group_chain',
    name: 'Chain Group',
    emoji: '🔗',
    type: 'HOME',
    currency: 'USD',
    inviteCode: 'ABCDEFGHIJ',
    simplifyDebts: false,
    createdBy: me,
    members: [
      { user: me, role: 'ADMIN', joinedAt: '2026-01-01T00:00:00.000Z' },
      { user: bob, role: 'MEMBER', joinedAt: '2026-01-02T00:00:00.000Z' },
      { user: cara, role: 'MEMBER', joinedAt: '2026-01-03T00:00:00.000Z' },
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

function friendsQuery(data: []) {
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

/** ADR-011 counterexample fixture: A=me nets to 0, B=+10000, C=-10000 USD. */
function chainBalances(): GroupBalancesDto {
  return {
    groupId: 'group_chain',
    viewerCurrency: 'USD',
    usedFallbackRates: false,
    members: [
      { user: me, balances: [] }, // A nets to zero — invisible to the net ceiling
      { user: bob, balances: [{ currency: 'USD', amount: 10000 }] },
      { user: cara, balances: [{ currency: 'USD', amount: -10000 }] },
    ],
    pairwise: [
      { fromUserId: me.id, toUserId: bob.id, currency: 'USD', amount: 10000, from: me, to: bob },
      { fromUserId: cara.id, toUserId: me.id, currency: 'USD', amount: 10000, from: cara, to: me },
    ],
    suggestions: [
      { fromUserId: cara.id, toUserId: bob.id, currency: 'USD', amount: 10000, from: cara, to: bob },
    ],
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

async function setAmount(text: string) {
  const testUser = userEvent.setup();
  const amountInput = screen.getByLabelText('Amount');
  await testUser.clear(amountInput);
  await testUser.type(amountInput, text);
  return testUser;
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

describe('SettleUpDialog — ADR-011 group bound = max(netCeiling, bilateral)', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ user: me, status: 'authed' });
    mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup()));
    mockedUseFriends.mockReturnValue(friendsQuery([]));
    mockedUseCreateSettlement.mockReturnValue(mutationStub());
    mockedUseUploadReceipt.mockReturnValue(uploadStub());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('accepts the real, incurred A->B debt (100) that the net ceiling alone would wrongly reject (netA=0, so netCeiling=0)', async () => {
    mockedUseGroupBalances.mockReturnValue(groupBalancesQuery(chainBalances()));

    render(<SettleUpDialog open onOpenChange={() => {}} groupId="group_chain" />);
    // Default parties: fromUserId = me (A), toUserId = first other candidate = B.
    await screen.findByLabelText('Amount');
    expect(screen.getByLabelText('From')).toHaveValue(me.id);
    expect(screen.getByLabelText('To')).toHaveValue(bob.id);

    await setAmount('100.00');
    expect(screen.queryByText(/nothing outstanding/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/is outstanding/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Amount')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeEnabled();
  });

  it('still rejects more than the bilateral debt (101 > 100) — the widened bound is not unlimited', async () => {
    mockedUseGroupBalances.mockReturnValue(groupBalancesQuery(chainBalances()));

    render(<SettleUpDialog open onOpenChange={() => {}} groupId="group_chain" />);
    await screen.findByLabelText('Amount');

    await setAmount('101.00');
    expect(
      screen.getByText(`Only ${formatMoney(10000, 'USD')} is outstanding`),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
  });

  it('still rejects a settled pair with neither a bilateral debt nor net-ceiling reachability (A->C: netA=0 so netCeiling=0; only C->A exists in pairwise, the opposite direction, so bilateral A->C=0)', async () => {
    mockedUseGroupBalances.mockReturnValue(groupBalancesQuery(chainBalances()));

    render(<SettleUpDialog open onOpenChange={() => {}} groupId="group_chain" />);
    await screen.findByLabelText('Amount');
    // fromUserId defaults to me (A); drive only the recipient to C.
    const testUser = userEvent.setup();
    await testUser.selectOptions(screen.getByLabelText('To'), cara.id);

    expect(await screen.findByText('Nothing outstanding with C in this group')).toBeInTheDocument();
    expect(screen.getByLabelText('Amount')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
  });

  it('still accepts the chain suggestion C->B 100, which has no bilateral entry at all (net ceiling alone still covers this — ADR-011 is additive, not a regression)', async () => {
    // This suggestion doesn't involve A (me) at all — the dialog requires
    // the caller to be a party, exactly like the real "Record payment" flow
    // (a non-party could never open the dialog on this row per WI-004's
    // disabled button). Open as B to exercise the net-ceiling gate on a pair
    // that has zero bilateral history.
    mockedUseAuth.mockReturnValue({ user: bob, status: 'authed' });
    mockedUseGroupBalances.mockReturnValue(groupBalancesQuery(chainBalances()));

    render(<SettleUpDialog open onOpenChange={() => {}} groupId="group_chain" />);
    await screen.findByLabelText('Amount');

    const testUser = userEvent.setup();
    await testUser.selectOptions(screen.getByLabelText('From'), cara.id);
    await testUser.selectOptions(screen.getByLabelText('To'), bob.id);
    await testUser.clear(screen.getByLabelText('Amount'));
    await testUser.type(screen.getByLabelText('Amount'), '100.00');

    expect(screen.queryByText(/nothing outstanding/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/is outstanding/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeEnabled();
  });
});
