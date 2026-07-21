import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FriendDto, UserDto } from '@divzy/shared';

/**
 * Build-stage TDD coverage for spec-WI-012's "Friend detail gate" (web,
 * non-group, open-time) — story-WI-012's Gherkin scenario "Friend detail
 * page (web) — zero balance disables Settle Up outright".
 *
 * Formula under test (spec-WI-012, "Non-group entry points"):
 *   nothingOutstanding = friend.balances.length === 0
 *     && (!friend.balancesConverted || friend.balancesConverted.amount === 0)
 *   nothingOutstanding -> "Settle Up" disabled (visible, per ADR-004), never
 *   opened with a misleading amount:0 prefill (today's behavior, being fixed).
 *
 * Mocking approach mirrors wi001-prefill.test.tsx / wi010-prefill.test.tsx
 * exactly: every heavy child is mocked out, and the real `SettleUpDialog`
 * import is replaced with a capture shim.
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

describe('WI-012 — FriendDetailPage disables Settle Up when nothing is outstanding', () => {
  it('zero balance (no native leftover, no converted figure) disables the Settle Up trigger, keeping it visible', async () => {
    useAuthMock.mockReturnValue({ user: fixtureMe() });
    useFriendsMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: fixtureFriend({ balances: [], balancesConverted: null }),
    });

    render(<FriendDetailPage />);

    const button = screen.getByRole('button', { name: /settle up/i });
    expect(button).toBeVisible();
    expect(button).toBeDisabled();

    // No misleading amount:0 prefill is ever computed for the disabled case
    // (replaces today's always-built amount:0 prefill).
    expect(capturedPrefillProp).toBeUndefined();

    // Clicking a disabled button is a no-op — dialog stays closed.
    const user = userEvent.setup();
    await user.click(button);
    expect(capturedPrefillProp).toBeUndefined();
  });

  it('zero balance with an explicit zero-amount converted object also disables (defensive, matches friendHasNothingOutstanding)', () => {
    useAuthMock.mockReturnValue({ user: fixtureMe() });
    useFriendsMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: fixtureFriend({ balances: [], balancesConverted: { currency: 'GBP', amount: 0 } }),
    });

    render(<FriendDetailPage />);
    expect(screen.getByRole('button', { name: /settle up/i })).toBeDisabled();
  });

  it('non-zero converted figure (no native leftover) keeps Settle Up enabled', () => {
    useAuthMock.mockReturnValue({ user: fixtureMe() });
    useFriendsMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: fixtureFriend({
        balances: [],
        balancesConverted: { currency: 'GBP', amount: -9735 },
      }),
    });

    render(<FriendDetailPage />);
    expect(screen.getByRole('button', { name: /settle up/i })).toBeEnabled();
  });

  it('a native (unconvertible) leftover keeps Settle Up enabled regardless of the converted figure', () => {
    useAuthMock.mockReturnValue({ user: fixtureMe() });
    useFriendsMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: fixtureFriend({
        balances: [{ currency: 'JPY', amount: -50000 }],
        balancesConverted: null,
      }),
    });

    render(<FriendDetailPage />);
    expect(screen.getByRole('button', { name: /settle up/i })).toBeEnabled();
  });
});
