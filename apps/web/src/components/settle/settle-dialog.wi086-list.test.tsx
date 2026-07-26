import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupBalancesDto, GroupDto, UserDto } from '@divzy/shared';
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
    defaultCurrency: 'GBP',
    emailNotifications: true,
    staleBalanceRemindersEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const me = user('me', 'Me');
const bob = user('bob', 'Bob');
const cara = user('cara', 'Cara');

function fixtureGroup(simplifyDebts = true): GroupDto {
  return {
    id: 'g1',
    name: 'Trip',
    emoji: '✈️',
    type: 'TRIP',
    currency: 'GBP',
    inviteCode: 'ABCDEFGHIJ',
    simplifyDebts,
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

function groupBalancesQuery(data: GroupBalancesDto) {
  return {
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useGroupBalances>;
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

describe('SettleUpDialog — WI-086 group debt-list mode', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ user: me, status: 'authed' });
    mockedUseFriends.mockReturnValue({ data: [], isLoading: false, isError: false, error: null } as unknown as ReturnType<typeof useFriends>);
    mockedUseCreateSettlement.mockReturnValue(mutationStub());
    mockedUseUploadReceipt.mockReturnValue(uploadStub());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders suggestions when simplifyDebts is ON', () => {
    mockedUseGroup.mockReturnValue({
      data: fixtureGroup(true),
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useGroup>);
    mockedUseGroupBalances.mockReturnValue(
      groupBalancesQuery({
        groupId: 'g1',
        viewerCurrency: 'GBP',
        usedFallbackRates: false,
        members: [me, bob, cara].map((u) => ({ user: u, balances: [] })),
        pairwise: [],
        suggestions: [
          { fromUserId: bob.id, toUserId: me.id, currency: 'GBP', amount: 5000, from: bob, to: me },
        ],
      }),
    );

    render(<SettleUpDialog open onOpenChange={() => {}} groupId="g1" initialView="list" />);

    expect(screen.getByRole('heading', { name: 'Settle Up' })).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settle' })).toBeEnabled();
  });

  it('renders pairwise exact debts when simplifyDebts is OFF', () => {
    mockedUseGroup.mockReturnValue({
      data: fixtureGroup(false),
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useGroup>);
    mockedUseGroupBalances.mockReturnValue(
      groupBalancesQuery({
        groupId: 'g1',
        viewerCurrency: 'GBP',
        usedFallbackRates: false,
        members: [me, bob, cara].map((u) => ({ user: u, balances: [] })),
        pairwise: [
          { fromUserId: me.id, toUserId: bob.id, currency: 'GBP', amount: 3000, from: me, to: bob },
        ],
        suggestions: [],
      }),
    );

    render(<SettleUpDialog open onOpenChange={() => {}} groupId="g1" initialView="list" />);

    expect(screen.getByRole('heading', { name: 'Settle Up' })).toBeInTheDocument();
    // The dialog labels the caller as "You", not by first name.
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('clicking a caller-involved row switches to the form with the correct prefill', async () => {
    mockedUseGroup.mockReturnValue({
      data: fixtureGroup(true),
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useGroup>);
    mockedUseGroupBalances.mockReturnValue(
      groupBalancesQuery({
        groupId: 'g1',
        viewerCurrency: 'GBP',
        usedFallbackRates: false,
        members: [me, bob, cara].map((u) => ({ user: u, balances: [] })),
        pairwise: [],
        suggestions: [
          { fromUserId: bob.id, toUserId: me.id, currency: 'GBP', amount: 5000, from: bob, to: me },
        ],
      }),
    );

    render(<SettleUpDialog open onOpenChange={() => {}} groupId="g1" initialView="list" />);
    const testUser = userEvent.setup();

    await testUser.click(screen.getByRole('button', { name: 'Settle' }));

    expect(screen.getByRole('heading', { name: 'Record a payment' })).toBeInTheDocument();
    expect((screen.getByLabelText('From') as HTMLSelectElement).value).toBe(bob.id);
    expect((screen.getByLabelText('To') as HTMLSelectElement).value).toBe(me.id);
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('50.00');
    // Currency uses a custom SearchSelect, so assert the rendered trigger text rather than .value.
    expect(screen.getByLabelText('Currency')).toHaveTextContent('GBP');
  });

  it('disables the Settle button for rows where the caller is not a party', () => {
    mockedUseGroup.mockReturnValue({
      data: fixtureGroup(true),
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useGroup>);
    mockedUseGroupBalances.mockReturnValue(
      groupBalancesQuery({
        groupId: 'g1',
        viewerCurrency: 'GBP',
        usedFallbackRates: false,
        members: [me, bob, cara].map((u) => ({ user: u, balances: [] })),
        pairwise: [],
        suggestions: [
          { fromUserId: bob.id, toUserId: cara.id, currency: 'GBP', amount: 2000, from: bob, to: cara },
        ],
      }),
    );

    render(<SettleUpDialog open onOpenChange={() => {}} groupId="g1" initialView="list" />);

    expect(screen.getByRole('button', { name: 'Settle' })).toBeDisabled();
  });

  it('shows an empty state when there are no actionable debts', () => {
    mockedUseGroup.mockReturnValue({
      data: fixtureGroup(true),
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useGroup>);
    mockedUseGroupBalances.mockReturnValue(
      groupBalancesQuery({
        groupId: 'g1',
        viewerCurrency: 'GBP',
        usedFallbackRates: false,
        members: [me, bob, cara].map((u) => ({ user: u, balances: [] })),
        pairwise: [],
        suggestions: [],
      }),
    );

    render(<SettleUpDialog open onOpenChange={() => {}} groupId="g1" initialView="list" />);

    expect(screen.getByText('All settled up')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settle' })).not.toBeInTheDocument();
  });

  it('defaults to form mode when initialView is omitted', () => {
    mockedUseGroup.mockReturnValue({
      data: fixtureGroup(true),
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useGroup>);
    mockedUseGroupBalances.mockReturnValue(
      groupBalancesQuery({
        groupId: 'g1',
        viewerCurrency: 'GBP',
        usedFallbackRates: false,
        members: [me, bob, cara].map((u) => ({ user: u, balances: [] })),
        pairwise: [],
        suggestions: [
          { fromUserId: bob.id, toUserId: me.id, currency: 'GBP', amount: 5000, from: bob, to: me },
        ],
      }),
    );

    render(<SettleUpDialog open onOpenChange={() => {}} groupId="g1" />);

    expect(screen.getByRole('heading', { name: 'Record a payment' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Settle Up' })).not.toBeInTheDocument();
  });
});
