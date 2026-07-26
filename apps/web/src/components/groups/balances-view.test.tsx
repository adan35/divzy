import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    <div data-testid="settle-dialog" data-group={props.groupId} data-prefill={JSON.stringify(props.prefill ?? null)} />
  )),
}));
vi.mock('@/components/settle/manual-rate-prompt', () => ({
  ManualRatePrompts: vi.fn(({ unresolved, viewerCurrency }) => (
    <div data-testid="manual-rate-prompts" data-viewer={viewerCurrency}>
      {unresolved.map((u: { currency: string }) => u.currency).join(',')}
    </div>
  )),
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
    defaultCurrency: 'GBP',
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
    currency: 'GBP',
    inviteCode: 'ABCDEFGHIJ',
    simplifyDebts: true,
    createdBy: me,
    members: [{ user: me, role: 'ADMIN', joinedAt: '2026-01-01T00:00:00.000Z' }],
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
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

// Hoisted so both the WI-004 and WI-010 describe blocks below can share it.
function withSuggestion(fromUserId: string, toUserId: string, from: UserDto, to: UserDto) {
  mockedUseGroupBalances.mockReturnValue(
    balancesQuery({
      groupId: 'g1',
      viewerCurrency: 'GBP',
      usedFallbackRates: false,
      members: [{ user: me, balances: [] }],
      pairwise: [],
      suggestions: [{ fromUserId, toUserId, currency: 'USD', amount: 2000, from, to }],
    }),
  );
}

describe('BalancesView', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ user: me, status: 'authed' });
    // WI-013: neutral defaults so the pre-existing (pre-WI-013) tests below —
    // none of which exercise the toggle — keep seeing the suggestions list
    // (simplifyDebts: true, the persisted default) as actionable.
    mockedUseGroup.mockReturnValue({
      data: fixtureGroup(),
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useGroup>);
    mockedUseUpdateGroup.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
      error: null,
      reset: vi.fn(),
    } as unknown as ReturnType<typeof useUpdateGroup>);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('WI-001 — converted balances', () => {
    it("shows a member's convertedNet as a single figure in the group's viewerCurrency", () => {
      mockedUseGroupBalances.mockReturnValue(
        balancesQuery({
          groupId: 'g1',
          viewerCurrency: 'GBP',
          usedFallbackRates: false,
          members: [
            {
              user: me,
              balances: [{ currency: 'USD', amount: -5000 }],
              convertedNet: { amount: -3950, unresolved: [] },
            },
          ],
          pairwise: [],
          suggestions: [],
        }),
      );

      render(<BalancesView groupId="g1" />);
      // Negative net (owes) — MoneyText's signed-color mode keeps the native minus sign.
      expect(screen.getByText('-£39.50')).toBeInTheDocument();
      expect(screen.queryByText('$50.00')).not.toBeInTheDocument();
    });

    it('keeps "settled up" unchanged for a member with no balances (convertedNet omitted)', () => {
      mockedUseGroupBalances.mockReturnValue(
        balancesQuery({
          groupId: 'g1',
          viewerCurrency: 'GBP',
          usedFallbackRates: false,
          members: [{ user: me, balances: [] }],
          pairwise: [],
          suggestions: [],
        }),
      );

      render(<BalancesView groupId="g1" />);
      expect(screen.getByText('settled up')).toBeInTheDocument();
    });

    it("flags a member's unresolved native currency instead of dropping or zeroing it, and feeds the manual-rate prompt", () => {
      mockedUseGroupBalances.mockReturnValue(
        balancesQuery({
          groupId: 'g1',
          viewerCurrency: 'GBP',
          usedFallbackRates: false,
          members: [
            {
              user: me,
              balances: [{ currency: 'XYZ', amount: 1200 }],
              convertedNet: { amount: 0, unresolved: [{ currency: 'XYZ', amount: 1200 }] },
            },
          ],
          pairwise: [],
          suggestions: [],
        }),
      );

      render(<BalancesView groupId="g1" />);
      expect(screen.getByText(/unconverted/i)).toBeInTheDocument();
      const prompt = screen.getByTestId('manual-rate-prompts');
      expect(prompt).toHaveAttribute('data-viewer', 'GBP');
      expect(prompt).toHaveTextContent('XYZ');
    });

    it('shows a converted equivalent on a pairwise debt row when convertedAmount is present', async () => {
      mockedUseGroupBalances.mockReturnValue(
        balancesQuery({
          groupId: 'g1',
          viewerCurrency: 'GBP',
          usedFallbackRates: false,
          members: [{ user: me, balances: [] }],
          pairwise: [
            {
              fromUserId: me.id,
              toUserId: bob.id,
              currency: 'USD',
              amount: 4000,
              from: me,
              to: bob,
              convertedAmount: 3160,
            },
          ],
          suggestions: [],
        }),
      );

      render(<BalancesView groupId="g1" />);
      const user_ = userEvent.setup();
      await user_.click(screen.getByRole('button', { name: /exact debts as incurred/i }));

      const exactDebts = screen.getByTestId('exact-debts');
      expect(within(exactDebts).getByText('$40.00')).toBeInTheDocument();
      expect(within(exactDebts).getByText('£31.60')).toBeInTheDocument();
    });

    it('falls back to the native amount only when a pairwise row has no convertedAmount', async () => {
      mockedUseGroupBalances.mockReturnValue(
        balancesQuery({
          groupId: 'g1',
          viewerCurrency: 'GBP',
          usedFallbackRates: false,
          members: [{ user: me, balances: [] }],
          pairwise: [
            {
              fromUserId: me.id,
              toUserId: bob.id,
              currency: 'XYZ',
              amount: 4000,
              from: me,
              to: bob,
            },
          ],
          suggestions: [],
        }),
      );

      render(<BalancesView groupId="g1" />);
      const user_ = userEvent.setup();
      await user_.click(screen.getByRole('button', { name: /exact debts as incurred/i }));

      // Only the native figure — no converted GBP figure fabricated for an
      // unresolved row.
      expect(screen.getAllByText(/XYZ/).length).toBeGreaterThan(0);
      expect(screen.queryByText('£')).not.toBeInTheDocument();
    });

    it('shows the fallback-rates notice when the group response used bundled fallback rates', () => {
      mockedUseGroupBalances.mockReturnValue(
        balancesQuery({
          groupId: 'g1',
          viewerCurrency: 'GBP',
          usedFallbackRates: true,
          members: [{ user: me, balances: [] }],
          pairwise: [],
          suggestions: [],
        }),
      );

      render(<BalancesView groupId="g1" />);
      expect(screen.getByText('Converted with offline rates')).toBeInTheDocument();
    });
  });

  describe('WI-004 — gate "Record payment" to the current user', () => {
    it('stays actionable when the current user is the payer (fromUserId)', async () => {
      withSuggestion(me.id, bob.id, me, bob);
      render(<BalancesView groupId="g1" />);
      const user_ = userEvent.setup();

      const button = screen.getByRole('button', { name: 'Record payment' });
      expect(button).toBeEnabled();
      await user_.click(button);

      const dialog = screen.getByTestId('settle-dialog');
      expect(dialog).toHaveAttribute('data-group', 'g1');
      expect(JSON.parse(dialog.getAttribute('data-prefill')!)).toMatchObject({
        fromUserId: me.id,
        toUserId: bob.id,
        amount: 2000,
        currency: 'USD',
      });
    });

    it('stays actionable when the current user is the recipient (toUserId)', () => {
      withSuggestion(bob.id, me.id, bob, me);
      render(<BalancesView groupId="g1" />);
      expect(screen.getByRole('button', { name: 'Record payment' })).toBeEnabled();
    });

    it('is not actionable when neither party is the current user — no dialog, no click effect', async () => {
      withSuggestion(bob.id, cara.id, bob, cara);
      render(<BalancesView groupId="g1" />);
      const user_ = userEvent.setup();

      const button = screen.getByRole('button', { name: 'Record payment' });
      expect(button).toBeDisabled();
      await user_.click(button);

      expect(screen.queryByTestId('settle-dialog')).not.toBeInTheDocument();
      // The row itself (payer/recipient/amount) stays visible for everyone —
      // only the action's clickability is gated, per ADR-004 (disable, not hide).
      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.getByText('Cara')).toBeInTheDocument();
    });
  });

  describe('WI-010 — "Record payment" prefills directly from the suggestion, never swapped', () => {
    // spec-WI-010 independently re-verified that balances-view.tsx:197-206
    // already prefills straight from the suggestion's own fromUserId/toUserId
    // (the debtor by construction of suggestSettlements/simplify.ts) with no
    // UI-level swap logic — no product code change was made or required.
    // This test closes the coverage gap so a future refactor can't silently
    // introduce a swap. Deliberately uses a suggestion where the CURRENT
    // USER is the recipient (toUserId), not the payer, so a from/to swap bug
    // would be caught (the WI-004 "payer" test above already pins the
    // opposite case, coincidentally, but this is the dedicated WI-010 case).
    it('clicking Record payment prefills From = the suggestion debtor, To = the suggestion creditor', async () => {
      withSuggestion(bob.id, me.id, bob, me);
      render(<BalancesView groupId="g1" />);
      const user_ = userEvent.setup();

      await user_.click(screen.getByRole('button', { name: 'Record payment' }));

      const dialog = screen.getByTestId('settle-dialog');
      expect(JSON.parse(dialog.getAttribute('data-prefill')!)).toEqual({
        fromUserId: bob.id,
        toUserId: me.id,
        amount: 2000,
        currency: 'USD',
      });
    });
  });

  describe('WI-085 — Balances tab member rows are clickable settle-up triggers', () => {
    function withMemberRows() {
      mockedUseGroupBalances.mockReturnValue(
        balancesQuery({
          groupId: 'g1',
          viewerCurrency: 'GBP',
          usedFallbackRates: false,
          members: [
            { user: me, balances: [] },
            { user: bob, balances: [{ currency: 'USD', amount: 2000 }] },
            { user: cara, balances: [] },
          ],
          pairwise: [
            {
              fromUserId: bob.id,
              toUserId: me.id,
              currency: 'USD',
              amount: 2000,
              from: bob,
              to: me,
            },
          ],
          suggestions: [],
        }),
      );
    }

    it('clicking another member opens the dialog with the caller↔member pairwise prefill', async () => {
      const user_ = userEvent.setup();
      withMemberRows();
      render(<BalancesView groupId="g1" />);

      // Bob's net-phrase sub-line is one contiguous element; walk up to the row.
      // A clickable member row IS a <button>, so closest('button') both finds it
      // and proves clickability (it is null for non-clickable rows). Accessible-
      // name regexes are brittle here: the Avatar initial prefixes the name.
      const bobButton = screen.getByText('gets back $20.00').closest('button');
      expect(bobButton).not.toBeNull();
      await user_.click(bobButton!);

      const dialog = screen.getByTestId('settle-dialog');
      expect(JSON.parse(dialog.getAttribute('data-prefill')!)).toEqual({
        fromUserId: bob.id,
        toUserId: me.id,
        amount: 2000,
        currency: 'USD',
      });
    });

    it('the caller\'s own row is not clickable', () => {
      withMemberRows();
      render(<BalancesView groupId="g1" />);

      // '(you)' renders only inside the caller's own row name. closest('button')
      // must be null — if the !isMe guard ever breaks, the own row becomes a
      // button and this assertion fails (a located, non-vacuous negative).
      expect(screen.getByText('(you)').closest('button')).toBeNull();
    });

    it('a member with zero caller↔member pairwise position has no settle affordance', () => {
      withMemberRows();
      render(<BalancesView groupId="g1" />);

      // Same located-negative pattern: Cara's name is unique in this fixture;
      // her row must not be a button while her pairwise position is zero.
      const caraName = screen.getByText('Cara');
      expect(caraName.closest('button')).toBeNull();
      const caraRow = caraName.parentElement!.parentElement as HTMLElement;
      expect(within(caraRow).getByText('settled up')).toBeInTheDocument();
    });
  });
});
