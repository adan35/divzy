// spec-WI-082 — Dashboard friends-preview inherits the hairline connector
// treatment through the shared FriendBalanceBreakdown component.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FriendBalanceBucket, FriendDto, UserDto } from '@divzy/shared';

const useFriendsMock = vi.fn();
const useAuthMock = vi.fn();
let capturedOpenProp: boolean | undefined;
let capturedPrefillProp: unknown;

vi.mock('@/lib/hooks', () => ({ useFriends: () => useFriendsMock() }));
vi.mock('@/lib/auth-store', () => ({ useAuth: () => useAuthMock() }));
vi.mock('@/components/settle/settle-dialog', () => ({
  SettleUpDialog: (props: { open: boolean; prefill?: unknown }) => {
    capturedOpenProp = props.open;
    capturedPrefillProp = props.prefill;
    return null;
  },
}));

import { FriendsPreview } from './friends-preview';

const SHOW_LABEL = /show per-group breakdown/i;
const DIRECT_LABEL = 'Direct (outside groups)';

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

function fixtureBucket(overrides: Partial<FriendBalanceBucket> = {}): FriendBalanceBucket {
  return {
    group: null,
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
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

function setup(friends: FriendDto[]) {
  useAuthMock.mockReturnValue({ user: fixtureMe() });
  useFriendsMock.mockReturnValue({ isPending: false, isError: false, data: friends });
}

describe('FriendsPreview — WI-082 hairline connector dashboard parity', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    capturedOpenProp = undefined;
    capturedPrefillProp = undefined;
  });

  it('renders no text glyphs, uses mid/terminal connectors, and keeps the settle-dialog path intact', async () => {
    const user = userEvent.setup();
    setup([
      fixtureFriend({
        balancesNative: [{ currency: 'USD', amount: 4000 }],
        balancesConverted: { currency: 'GBP', amount: 3163 },
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'group-trip', name: 'Trip to Rome', emoji: '🧳' },
            balancesNative: [{ currency: 'USD', amount: 5000 }],
            balancesConverted: { currency: 'GBP', amount: 3954 },
            expenseCount: 3,
            settlementCount: 1,
          }),
          fixtureBucket({
            group: null,
            balancesNative: [{ currency: 'USD', amount: -1000 }],
            balancesConverted: { currency: 'GBP', amount: -791 },
            expenseCount: 0,
            settlementCount: 2,
          }),
        ],
      }),
    ]);
    render(<FriendsPreview />);

    await user.click(screen.getByRole('button', { name: SHOW_LABEL }));

    const panel = screen.getByRole('link', { name: /Trip to Rome/i }).closest('[class*="divide-y"]');
    expect(panel?.textContent).not.toMatch(/[├└─|_]/);
    expect(panel?.querySelector('.font-mono')).toBeNull();

    const connectors = screen.getAllByTestId('tree-connector');
    expect(connectors).toHaveLength(2);
    expect(connectors[0]).toHaveAttribute('data-connector', 'mid');
    expect(connectors[1]).toHaveAttribute('data-connector', 'terminal');

    // Primary row click still opens the settle dialog (WI-050 regression guard).
    await user.click(screen.getByRole('button', { name: /sam lee/i }));
    expect(capturedOpenProp).toBe(true);
    expect(capturedPrefillProp).toEqual({
      fromUserId: 'sam',
      toUserId: 'me',
      amount: 4000,
      currency: 'USD',
    });
  });

  it('puts the terminal elbow on the overflow toggle when >5 buckets are collapsed', async () => {
    const user = userEvent.setup();
    const buckets = Array.from({ length: 6 }, (_, i) =>
      fixtureBucket({
        group: { id: `group-${i + 1}`, name: `Group ${i + 1}`, emoji: '👥' },
        balancesNative: [{ currency: 'USD', amount: 100 * (i + 1) }],
        balancesConverted: { currency: 'USD', amount: 100 * (i + 1) },
      }),
    );
    setup([fixtureFriend({ balancesByGroup: buckets })]);
    render(<FriendsPreview />);

    await user.click(screen.getByRole('button', { name: SHOW_LABEL }));

    const toggle = screen.getByRole('button', { name: '+2 more groups' });
    expect(within(toggle).getByTestId('tree-connector')).toHaveAttribute(
      'data-connector',
      'terminal',
    );
  });
});
