// Build-stage TDD coverage for spec-WI-013 — "Simplify debts" toggle,
// unsimplified (pairwise) list switching, and the before/after payment-count
// comparison. Mirrors balances-view.test.tsx's mocking approach; also mocks
// useGroup/useUpdateGroup (new hooks this component now calls) per this
// domain's own "shared-component-new-hook-breaks-sibling-tests" lesson.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@divzy/api-client';
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
  SettleUpDialog: vi.fn((props: { groupId?: string; prefill?: unknown }) => (
    <div
      data-testid="settle-dialog"
      data-group={props.groupId}
      data-prefill={JSON.stringify(props.prefill ?? null)}
    />
  )),
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
    name: 'Trip',
    emoji: '✈️',
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

function updateGroupMutation(overrides: Partial<ReturnType<typeof useUpdateGroup>> = {}) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
    ...overrides,
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

function fixtureBalances(overrides: Partial<GroupBalancesDto> = {}): GroupBalancesDto {
  return {
    groupId: 'g1',
    viewerCurrency: 'USD',
    usedFallbackRates: false,
    members: [{ user: me, balances: [] }],
    pairwise: [
      { fromUserId: me.id, toUserId: bob.id, currency: 'USD', amount: 3000, from: me, to: bob },
      { fromUserId: bob.id, toUserId: cara.id, currency: 'USD', amount: 1000, from: bob, to: cara },
    ],
    suggestions: [
      { fromUserId: me.id, toUserId: cara.id, currency: 'USD', amount: 2000, from: me, to: cara },
    ],
    ...overrides,
  };
}

describe('BalancesView — WI-013 simplify-debts toggle', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ user: me, status: 'authed' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('toggle state & persistence', () => {
    it('reflects the persisted simplifyDebts=true value on load', () => {
      mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup({ simplifyDebts: true })));
      mockedUseUpdateGroup.mockReturnValue(updateGroupMutation());
      mockedUseGroupBalances.mockReturnValue(balancesQuery(fixtureBalances()));

      render(<BalancesView groupId="g1" />);

      expect(screen.getByRole('switch', { name: 'Simplify debts' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });

    it('reflects the persisted simplifyDebts=false value on load', () => {
      mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup({ simplifyDebts: false })));
      mockedUseUpdateGroup.mockReturnValue(updateGroupMutation());
      mockedUseGroupBalances.mockReturnValue(balancesQuery(fixtureBalances()));

      render(<BalancesView groupId="g1" />);

      expect(screen.getByRole('switch', { name: 'Simplify debts' })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    });

    it('on PATCH failure, reverts the optimistic toggle flip and surfaces the error message', async () => {
      mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup({ simplifyDebts: true })));
      const mutate: ReturnType<typeof useUpdateGroup>['mutate'] = vi.fn((vars, opts) => {
        opts?.onError?.(new ApiError(500, 'Could not update group', 'INTERNAL'), vars, undefined);
      });
      mockedUseUpdateGroup.mockReturnValue(updateGroupMutation({ mutate }));
      mockedUseGroupBalances.mockReturnValue(balancesQuery(fixtureBalances()));

      render(<BalancesView groupId="g1" />);
      const toggle = screen.getByRole('switch', { name: 'Simplify debts' });
      expect(toggle).toHaveAttribute('aria-checked', 'true');

      const testUser = userEvent.setup();
      await testUser.click(toggle);

      expect(mutate).toHaveBeenCalledWith(
        { groupId: 'g1', input: { simplifyDebts: false } },
        expect.anything(),
      );
      // Reverted back to the persisted value after the error.
      expect(toggle).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByText('Could not update group')).toBeInTheDocument();
      // ON list (suggestions) is still what's actionable after the revert.
      expect(screen.getByText('Cara')).toBeInTheDocument();
    });
  });

  describe('list switching', () => {
    it('toggle ON (default/persisted) shows the simplified suggestions list as actionable', () => {
      mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup({ simplifyDebts: true })));
      mockedUseUpdateGroup.mockReturnValue(updateGroupMutation());
      mockedUseGroupBalances.mockReturnValue(balancesQuery(fixtureBalances()));

      render(<BalancesView groupId="g1" />);

      // Only the single suggestion (Me -> Cara, $20.00) is actionable.
      expect(screen.getAllByRole('button', { name: 'Record payment' })).toHaveLength(1);
      expect(screen.getByText('$20.00')).toBeInTheDocument();
    });

    it('toggle OFF shows the unsimplified pairwise list, each row independently actionable', () => {
      mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup({ simplifyDebts: false })));
      mockedUseUpdateGroup.mockReturnValue(updateGroupMutation());
      mockedUseGroupBalances.mockReturnValue(balancesQuery(fixtureBalances()));

      render(<BalancesView groupId="g1" />);

      // Both pairwise rows (Me -> Bob $30, Bob -> Cara $10) are shown.
      const buttons = screen.getAllByRole('button', { name: 'Record payment' });
      expect(buttons).toHaveLength(2);
      expect(screen.getByText('$30.00')).toBeInTheDocument();
      expect(screen.getByText('$10.00')).toBeInTheDocument();
    });

    it('toggle OFF: current-user party row stays actionable and prefills fromUserId/toUserId/amount/currency', async () => {
      mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup({ simplifyDebts: false })));
      mockedUseUpdateGroup.mockReturnValue(updateGroupMutation());
      mockedUseGroupBalances.mockReturnValue(balancesQuery(fixtureBalances()));

      render(<BalancesView groupId="g1" />);
      const testUser = userEvent.setup();

      // Me -> Bob row: me is a party, so this stays enabled.
      const button = screen.getAllByRole('button', { name: 'Record payment' })[0];
      expect(button).toBeEnabled();
      await testUser.click(button);

      const dialog = screen.getByTestId('settle-dialog');
      expect(JSON.parse(dialog.getAttribute('data-prefill')!)).toEqual({
        fromUserId: me.id,
        toUserId: bob.id,
        amount: 3000,
        currency: 'USD',
      });
    });

    it('toggle OFF: WI-004 regression — a pairwise row between two other members is disabled, not hidden', () => {
      mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup({ simplifyDebts: false })));
      mockedUseUpdateGroup.mockReturnValue(updateGroupMutation());
      mockedUseGroupBalances.mockReturnValue(balancesQuery(fixtureBalances()));

      render(<BalancesView groupId="g1" />);

      // Bob -> Cara: neither party is "me" — disabled but still visible.
      const buttons = screen.getAllByRole('button', { name: 'Record payment' });
      expect(buttons[0]).toBeEnabled(); // Me -> Bob
      expect(buttons[1]).toBeDisabled(); // Bob -> Cara
      // Bob appears in both rows (Me -> Bob, Bob -> Cara); Cara only in the
      // disabled row — both stay visible (ADR-004: disable, never hide).
      expect(screen.getAllByText('Bob')).toHaveLength(2);
      expect(screen.getByText('Cara')).toBeInTheDocument();
    });

    it('toggling back ON restores the suggestions list optimistically, without waiting for the PATCH to resolve', async () => {
      mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup({ simplifyDebts: false })));
      mockedUseUpdateGroup.mockReturnValue(updateGroupMutation()); // mutate is a no-op stub — never resolves
      mockedUseGroupBalances.mockReturnValue(balancesQuery(fixtureBalances()));

      render(<BalancesView groupId="g1" />);
      expect(screen.getAllByRole('button', { name: 'Record payment' })).toHaveLength(2); // OFF: pairwise

      const testUser = userEvent.setup();
      await testUser.click(screen.getByRole('switch', { name: 'Simplify debts' }));

      // Optimistically flips to ON — suggestions list (1 row) is now shown.
      expect(screen.getAllByRole('button', { name: 'Record payment' })).toHaveLength(1);
      expect(screen.getByText('$20.00')).toBeInTheDocument();
    });
  });

  describe('before/after payment-count comparison', () => {
    it('shows "N payments -> M payments" near the toggle, regardless of toggle position', () => {
      mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup({ simplifyDebts: true })));
      mockedUseUpdateGroup.mockReturnValue(updateGroupMutation());
      mockedUseGroupBalances.mockReturnValue(balancesQuery(fixtureBalances())); // 2 pairwise, 1 suggestion

      render(<BalancesView groupId="g1" />);
      expect(screen.getByTestId('payment-count-comparison')).toHaveTextContent(
        '2 payments → 1 payment',
      );
    });

    it('stays visible and unchanged when the toggle is OFF', () => {
      mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup({ simplifyDebts: false })));
      mockedUseUpdateGroup.mockReturnValue(updateGroupMutation());
      mockedUseGroupBalances.mockReturnValue(balancesQuery(fixtureBalances()));

      render(<BalancesView groupId="g1" />);
      expect(screen.getByTestId('payment-count-comparison')).toHaveTextContent(
        '2 payments → 1 payment',
      );
    });

    it('fully settled group (0 pairwise, 0 suggestions) shows no comparison badge', () => {
      mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup({ simplifyDebts: true })));
      mockedUseUpdateGroup.mockReturnValue(updateGroupMutation());
      mockedUseGroupBalances.mockReturnValue(
        balancesQuery(fixtureBalances({ pairwise: [], suggestions: [] })),
      );

      render(<BalancesView groupId="g1" />);
      expect(screen.queryByTestId('payment-count-comparison')).not.toBeInTheDocument();
    });

    it('already-minimal group (before === after) still shows equal counts, never implying a false saving', () => {
      mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup({ simplifyDebts: true })));
      mockedUseUpdateGroup.mockReturnValue(updateGroupMutation());
      mockedUseGroupBalances.mockReturnValue(
        balancesQuery(
          fixtureBalances({
            pairwise: [
              { fromUserId: me.id, toUserId: bob.id, currency: 'USD', amount: 3000, from: me, to: bob },
            ],
            suggestions: [
              { fromUserId: me.id, toUserId: bob.id, currency: 'USD', amount: 3000, from: me, to: bob },
            ],
          }),
        ),
      );

      render(<BalancesView groupId="g1" />);
      expect(screen.getByTestId('payment-count-comparison')).toHaveTextContent(
        '1 payment → 1 payment',
      );
    });
  });
});
