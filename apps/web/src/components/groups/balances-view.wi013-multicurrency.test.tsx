// Test-stage independent verification of story-WI-013's explicit edge case
// "Edge case — multi-currency groups are counted correctly": the before/after
// comparison counts payments across all currencies combined, as a flat
// payment count, never mixing amounts of different currencies into one
// figure. Build's own balances-view.wi013-toggle.test.tsx fixture is
// single-currency throughout (USD only) and never exercises this AC — this
// file is a separate, independently-authored artifact closing that specific
// gap, reusing the same mocking approach for consistency with the rest of
// this suite.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { GroupBalancesDto, GroupDto, UserDto } from '@divzy/shared';
import { BalancesView } from './balances-view';
import { useAuth } from '@/lib/auth-store';
import { useGroup, useGroupBalances, useUpdateGroup } from '@/lib/hooks';

vi.mock('@/lib/auth-store', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks')>();
  return { ...actual, useGroupBalances: vi.fn(), useGroup: vi.fn(), useUpdateGroup: vi.fn() };
});
vi.mock('@/components/settle/settle-dialog', () => ({
  SettleUpDialog: vi.fn(() => <div data-testid="settle-dialog" />),
}));
vi.mock('@/components/settle/manual-rate-prompt', () => ({
  ManualRatePrompts: vi.fn(() => <div data-testid="manual-rate-prompts" />),
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseGroupBalances = vi.mocked(useGroupBalances);
const mockedUseGroup = vi.mocked(useGroup);
const mockedUseUpdateGroup = vi.mocked(useUpdateGroup);

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

const me = user('u1', 'Me');
const bob = user('u2', 'Bob');
const cara = user('u3', 'Cara');

function fixtureGroup(overrides: Partial<GroupDto> = {}): GroupDto {
  return {
    id: 'g1',
    name: 'Multi-currency trip',
    emoji: '🌍',
    type: 'TRIP',
    currency: 'USD',
    inviteCode: 'ABCDEFGHIJ',
    simplifyDebts: true,
    createdBy: me,
    members: [
      { user: me, role: 'ADMIN', joinedAt: '2026-01-01T00:00:00.000Z' },
      { user: bob, role: 'MEMBER', joinedAt: '2026-01-01T00:00:00.000Z' },
      { user: cara, role: 'MEMBER', joinedAt: '2026-01-01T00:00:00.000Z' },
    ],
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function groupQuery(data: GroupDto) {
  return { data, isLoading: false, isError: false, error: null } as unknown as ReturnType<
    typeof useGroup
  >;
}

function updateGroupMutation() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
  } as unknown as ReturnType<typeof useUpdateGroup>;
}

function balancesQuery(data: GroupBalancesDto) {
  return {
    isLoading: false,
    isError: false,
    data,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useGroupBalances>;
}

describe('BalancesView — WI-013 before/after comparison, multi-currency edge case', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ user: me, status: 'authed' });
    mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup()));
    mockedUseUpdateGroup.mockReturnValue(updateGroupMutation());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('counts payments across USD and EUR combined as one flat number, never mixing the two currencies into a money figure', () => {
    // 3 pairwise debts across two currencies (2 USD, 1 EUR); simplification
    // reduces them to 2 suggestions (still spanning both currencies) — the
    // comparison must read "3 payments -> 2 payments", a currency-agnostic
    // count, never e.g. attempting to sum 3000 USD + 500 EUR into one amount.
    mockedUseGroupBalances.mockReturnValue(
      balancesQuery({
        groupId: 'g1',
        viewerCurrency: 'USD',
        usedFallbackRates: false,
        members: [{ user: me, balances: [] }],
        pairwise: [
          { fromUserId: me.id, toUserId: bob.id, currency: 'USD', amount: 3000, from: me, to: bob },
          { fromUserId: bob.id, toUserId: cara.id, currency: 'USD', amount: 1500, from: bob, to: cara },
          { fromUserId: cara.id, toUserId: me.id, currency: 'EUR', amount: 500, from: cara, to: me },
        ],
        suggestions: [
          { fromUserId: me.id, toUserId: cara.id, currency: 'USD', amount: 1500, from: me, to: cara },
          { fromUserId: cara.id, toUserId: me.id, currency: 'EUR', amount: 500, from: cara, to: me },
        ],
      }),
    );

    render(<BalancesView groupId="g1" />);

    const badge = screen.getByTestId('payment-count-comparison');
    expect(badge).toHaveTextContent('3 payments → 2 payments');
    // Negative check: the badge text must be a plain payment count, never a
    // rendered currency amount or currency code leaking into the figure.
    expect(badge.textContent).not.toMatch(/USD|EUR|\$|€/);

    // Both list modes (ON/OFF) must render rows from both currencies without
    // any cross-currency amount mixing — each row keeps its own currency.
    expect(screen.getByText('$15.00')).toBeInTheDocument();
    expect(screen.getByText('€5.00')).toBeInTheDocument();
  });
});
