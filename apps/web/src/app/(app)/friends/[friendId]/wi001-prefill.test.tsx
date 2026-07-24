import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FriendDto, UserDto } from '@divzy/shared';

/**
 * Test-stage white-box case for story-WI-001, targeting the exact logic
 * build-WI-001.md's "Notes for Test stage" flags as tricky: "the friend-detail
 * 'Settle up' prefill must keep sourcing its amount/currency from the native
 * pairwise balance ... never from the new balancesConverted." This is the
 * "deliberate native-vs-converted split" the Test charter calls out by name.
 *
 * The prefill computation lives inline in FriendDetailPage (not extracted to
 * a pure function), so this test mocks every heavy child (ExpenseList,
 * SettlementsSection, ExpenseEditorDialog) and the real SettleUpDialog import
 * itself (captured via vi.mock so we can inspect exactly what `prefill` prop
 * the page computes) rather than re-deriving the logic by reading the source
 * a second time.
 */

const useFriendsMock = vi.fn();
const useAuthMock = vi.fn();
let capturedPrefillProp: unknown;

vi.mock('next/navigation', () => ({
  useParams: () => ({ friendId: 'sam' }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/lib/hooks', () => ({
  // WI-070: FriendDetailPage now sources its data from useFriend(friendId)
  // (a single FriendDto), not useFriends() + .find() — the mock below still
  // returns the same UseQueryResult shape, just with `data` as one object
  // instead of an array.
  useFriend: () => useFriendsMock(),
  // WI-066: FriendDetailPage now also calls useRemoveFriend — stubbed here
  // only so the component renders; no test in this file exercises removal.
  useRemoveFriend: () => ({ mutate: vi.fn(), isPending: false }),
  errorMessage: () => 'error',
}));
vi.mock('@/lib/auth-store', () => ({ useAuth: () => useAuthMock() }));
vi.mock('@/components/expenses/expense-list', () => ({ ExpenseList: () => null }));
vi.mock('@/components/expenses/expense-editor', () => ({ ExpenseEditorDialog: () => null }));
vi.mock('@/components/friends/settlements-section', () => ({ SettlementsSection: () => null }));
vi.mock('@/components/settle/settle-dialog', () => ({
  SettleUpDialog: (props: { prefill?: unknown; open: boolean }) => {
    capturedPrefillProp = props.prefill;
    return null;
  },
}));

import FriendDetailPage from './page';

function fixtureFriend(overrides: Partial<FriendDto> = {}): FriendDto {
  return {
    user: { id: 'sam', name: 'Sam Lee', avatarColor: '#000' },
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    balancesByGroup: [],
    lastActivityAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function fixtureMe(): UserDto {
  return {
    id: 'me',
    name: 'Me',
    avatarColor: '#111',
    email: 'me@example.com',
    defaultCurrency: 'GBP',
    emailNotifications: true,
    staleBalanceRemindersEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

async function openSettle() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /settle up/i }));
}

describe('WB — FriendDetailPage settle-up prefill sources the NATIVE balance, never balancesConverted', () => {
  it('WB-1: single unresolvable native currency (balancesConverted null, one leftover) prefills exact native amount/currency/direction', async () => {
    useAuthMock.mockReturnValue({ user: fixtureMe() });
    useFriendsMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: fixtureFriend({
        balancesConverted: null,
        // Unresolvable/unconvertible currency: appears in BOTH the narrowed
        // `balances` leftover list and the full `balancesNative` breakdown.
        // Direction must come from balancesNative (spec-WI-050 REOPENED).
        balances: [{ currency: 'JPY', amount: -50000 }], // I owe Sam 500 JPY
        balancesNative: [{ currency: 'JPY', amount: -50000 }],
      }),
    });

    render(<FriendDetailPage />);
    await openSettle();

    expect(capturedPrefillProp).toEqual({
      fromUserId: 'me',
      toUserId: 'sam',
      amount: 50000,
      currency: 'JPY',
    });
  });

  it("WB-2: a friend WITH a converted figure but no native leftover still prefills 0/defaultCurrency — never reads the converted amount into the prefill (the exact regression this note warns against: 'do not fix it to fall back to balancesConverted when balances is empty')", async () => {
    useAuthMock.mockReturnValue({ user: fixtureMe() });
    useFriendsMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: fixtureFriend({
        balancesConverted: { currency: 'GBP', amount: -9735 }, // displayed: "You owe Sam £97.35"
        balances: [], // narrowed to [] — fully converted, nothing native left over
      }),
    });

    render(<FriendDetailPage />);
    await openSettle();

    // Must NOT be 9735/GBP (the converted figure) — that would silently
    // record a settlement in a currency/amount that was never actually owed.
    expect(capturedPrefillProp).toEqual({
      fromUserId: 'me',
      toUserId: 'sam',
      amount: 0,
      currency: 'GBP', // me.defaultCurrency, the documented "just preselect the two of you" fallback
    });
    expect(capturedPrefillProp).not.toMatchObject({ amount: 9735 });
  });

  it('WB-3: settled-up friend (both balances and balancesConverted empty/null) disables Settle Up instead of opening with a zero-amount prefill (superseded by story-WI-012 — see wi012-balance-gate.test.tsx)', () => {
    useAuthMock.mockReturnValue({ user: fixtureMe() });
    useFriendsMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: fixtureFriend({ balances: [], balancesConverted: null }),
    });

    render(<FriendDetailPage />);
    expect(screen.getByText(/all settled up/i)).toBeInTheDocument();
    // WI-012: no real outstanding balance -> the trigger is disabled (kept
    // visible, per ADR-004), never opened with a misleading amount:0 prefill.
    expect(screen.getByRole('button', { name: /settle up/i })).toBeDisabled();
  });
});
