import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FriendDto, UserDto } from '@divzy/shared';

/**
 * Test-stage regression coverage for story-WI-010 / spec-WI-010 ("Settle Up
 * defaults to the debtor paying when the direction is known").
 *
 * spec-WI-010 independently re-verified that FriendDetailPage's prefill logic
 * (apps/web/src/app/(app)/friends/[friendId]/page.tsx:114-140) already
 * defaults to debtor-pays-creditor in both derivable branches — no product
 * code change was made or required by this work item. The existing
 * `wi001-prefill.test.tsx` WB-1 case already covers the NEGATIVE native
 * balance direction (current user owes the friend -> From = me, To = friend)
 * as an incidental side effect of WI-001's own regression coverage, but no
 * test exercised the POSITIVE direction (friend owes the current user).
 * This file closes that gap so a future refactor of the prefill branch can't
 * silently reintroduce the swapped direction on this path.
 *
 * Mocking approach mirrors wi001-prefill.test.tsx exactly: every heavy child
 * is mocked out, and the real `SettleUpDialog` import is replaced with a
 * capture shim so we can assert on the exact `prefill` prop the page computes
 * without re-deriving the logic by reading the source a second time.
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
  // (a single FriendDto), not useFriends() + .find().
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

describe('WI-010 — FriendDetailPage settle-up prefill defaults to debtor-pays-creditor', () => {
  it('positive native balance (friend owes the current user) prefills From = friend, To = me', async () => {
    useAuthMock.mockReturnValue({ user: fixtureMe() });
    useFriendsMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: fixtureFriend({
        balancesConverted: null,
        // Positive native balance, per friends.ts's "positive = they owe
        // the caller" convention: Sam owes the current user 300 JPY.
        // Unresolvable/unconvertible currency: appears in BOTH the narrowed
        // `balances` leftover list and the full `balancesNative` breakdown.
        // Direction must come from balancesNative (spec-WI-050 REOPENED).
        balances: [{ currency: 'JPY', amount: 30000 }],
        balancesNative: [{ currency: 'JPY', amount: 30000 }],
      }),
    });

    render(<FriendDetailPage />);
    await openSettle();

    // Debtor (Sam) pays creditor (me) — never swapped.
    expect(capturedPrefillProp).toEqual({
      fromUserId: 'sam',
      toUserId: 'me',
      amount: 30000,
      currency: 'JPY',
    });
  });
});
