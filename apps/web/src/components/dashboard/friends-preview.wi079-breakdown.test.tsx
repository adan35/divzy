// spec-WI-079 §6.2 — Dashboard friends-preview per-group balance breakdown.
//
// Same breakdown and expand interaction as the friends page (story AC forbids
// a divergent simplified view), with the row restructured to an outer <div>
// so the chevron toggle and the WI-050 settle-intent row button never nest.
// Verifies: collapsed by default, expand renders the same bucket lines, the
// toggle click does NOT open the settle dialog, the row click still opens the
// prefilled dialog (WI-050 intact), and ≤1-bucket suppression (D11).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

const TOGGLE_NAME = /show per-group breakdown/i;

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

function textMatcher(expected: string) {
  return (_: string, element: Element | null) => {
    if (element?.textContent !== expected) return false;
    const onlyChild = element.children.length === 1 ? element.children[0] : null;
    return onlyChild?.textContent !== expected;
  };
}

function setup(friends: FriendDto[]) {
  useAuthMock.mockReturnValue({ user: fixtureMe() });
  useFriendsMock.mockReturnValue({ isPending: false, isError: false, data: friends });
}

function twoBucketFriend(): FriendDto {
  return fixtureFriend({
    balancesNative: [{ currency: 'USD', amount: 4000 }],
    balancesConverted: { currency: 'GBP', amount: 3163 },
    balancesByGroup: [
      fixtureBucket({
        group: { id: 'group-trip', name: 'Trip to Rome', emoji: '🧳' },
        balancesNative: [{ currency: 'USD', amount: 5000 }],
        balancesConverted: { currency: 'GBP', amount: 3954 },
      }),
      fixtureBucket({
        group: null,
        balancesNative: [{ currency: 'USD', amount: -1000 }],
        balancesConverted: { currency: 'GBP', amount: -791 },
      }),
    ],
  });
}

describe('FriendsPreview — per-group balance breakdown (spec-WI-079 §6.2)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    capturedOpenProp = undefined;
    capturedPrefillProp = undefined;
  });

  it('is collapsed by default and expands to the same bucket lines as the friends page', async () => {
    const user = userEvent.setup();
    setup([twoBucketFriend()]);
    render(<FriendsPreview />);

    const toggle = screen.getByRole('button', { name: TOGGLE_NAME });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('🧳 Trip to Rome')).not.toBeInTheDocument();
    expect(screen.queryByText('Direct expenses')).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('🧳 Trip to Rome')).toBeInTheDocument();
    expect(screen.getByText('Direct expenses')).toBeInTheDocument();
    expect(screen.getByText(textMatcher('Sam owes you £39.54'))).toBeInTheDocument();
    expect(screen.getByText(textMatcher('You owe Sam £7.91'))).toBeInTheDocument();
  });

  it('clicking the expand toggle does NOT open the settle dialog', async () => {
    const user = userEvent.setup();
    setup([twoBucketFriend()]);
    render(<FriendsPreview />);
    expect(capturedOpenProp).toBe(false);

    await user.click(screen.getByRole('button', { name: TOGGLE_NAME }));

    expect(capturedOpenProp).toBe(false);
    expect(capturedPrefillProp).toBeUndefined();
  });

  it('the row click still opens the prefilled settle dialog (WI-050 intact after the no-nested-buttons restructure)', async () => {
    const user = userEvent.setup();
    setup([twoBucketFriend()]);
    render(<FriendsPreview />);

    await user.click(screen.getByRole('button', { name: /sam lee/i }));

    expect(capturedOpenProp).toBe(true);
    expect(capturedPrefillProp).toEqual({
      fromUserId: 'sam',
      toUserId: 'me',
      amount: 4000,
      currency: 'USD',
    });
  });

  it('suppresses the expand affordance for ≤1 bucket (D11) and for zero-bucket friends', () => {
    setup([
      fixtureFriend({
        balancesByGroup: [
          fixtureBucket({
            group: null,
            balancesNative: [{ currency: 'USD', amount: 4000 }],
            balancesConverted: { currency: 'GBP', amount: 3163 },
          }),
        ],
      }),
    ]);
    render(<FriendsPreview />);
    expect(screen.queryByRole('button', { name: TOGGLE_NAME })).not.toBeInTheDocument();

    cleanup();
    setup([fixtureFriend()]);
    render(<FriendsPreview />);
    expect(screen.queryByRole('button', { name: TOGGLE_NAME })).not.toBeInTheDocument();
  });
});
