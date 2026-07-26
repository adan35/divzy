import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FriendBalanceBucket, FriendDto, UserDto } from '@divzy/shared';

const useFriendsMock = vi.fn();
const useAuthMock = vi.fn();
let capturedGroupId: string | undefined;
let capturedPrefill: unknown;

vi.mock('@/lib/hooks', () => ({ useFriends: () => useFriendsMock() }));
vi.mock('@/lib/auth-store', () => ({ useAuth: () => useAuthMock() }));
vi.mock('@/components/settle/settle-dialog', () => ({
  SettleUpDialog: (props: { open: boolean; groupId?: string; prefill?: unknown }) => {
    capturedGroupId = props.groupId;
    capturedPrefill = props.prefill;
    return null;
  },
}));

import { FriendsPreview } from './friends-preview';

const SHOW_LABEL = /show per-group breakdown/i;

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

function fixtureFriend(overrides: Partial<FriendDto> = {}): FriendDto {
  return {
    user: { id: 'ana', name: 'Ana Diaz', avatarColor: '#222' },
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

function setup(friends: FriendDto[]) {
  useAuthMock.mockReturnValue({ user: fixtureMe() });
  useFriendsMock.mockReturnValue({ isPending: false, isError: false, data: friends });
}

describe('FriendsPreview — WI-084 bucket-line settle-up', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    capturedGroupId = undefined;
    capturedPrefill = undefined;
  });

  it('bucket-line click opens the group-scoped dialog with the bucket prefill', async () => {
    const user = userEvent.setup();
    setup([
      fixtureFriend({
        balancesConverted: { currency: 'GBP', amount: 220 },
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'g-trip', name: 'Trip to Lahore', emoji: '🇵🇰' },
            balancesNative: [{ currency: 'PKR', amount: 50000 }],
            balances: [{ currency: 'PKR', amount: 50000 }],
            balancesConverted: null,
          }),
          fixtureBucket({
            group: null,
            balancesNative: [{ currency: 'USD', amount: -1000 }],
            balances: [{ currency: 'USD', amount: -1000 }],
            balancesConverted: null,
          }),
        ],
      }),
    ]);
    render(<FriendsPreview />);

    await user.click(screen.getByRole('button', { name: SHOW_LABEL }));
    await user.click(screen.getByRole('button', { name: /Settle up with Ana in Trip to Lahore/i }));

    expect(capturedGroupId).toBe('g-trip');
    expect(capturedPrefill).toEqual({
      fromUserId: 'ana',
      toUserId: 'me',
      amount: 50000,
      currency: 'PKR',
    });
  });

  it('whole-row click still uses the overall-friend prefill (WI-050)', async () => {
    const user = userEvent.setup();
    setup([
      fixtureFriend({
        balances: [],
        balancesNative: [{ currency: 'USD', amount: 4000 }],
        balancesConverted: { currency: 'GBP', amount: 316 },
      }),
    ]);
    render(<FriendsPreview />);

    await user.click(screen.getByRole('button', { name: /ana diaz/i }));

    expect(capturedGroupId).toBeUndefined();
    expect(capturedPrefill).toEqual({
      fromUserId: 'ana',
      toUserId: 'me',
      amount: 4000,
      currency: 'USD',
    });
  });

  it('bucket-line click does not fire the whole-row click handler', async () => {
    const user = userEvent.setup();
    setup([
      fixtureFriend({
        balances: [],
        balancesNative: [{ currency: 'USD', amount: 4000 }],
        balancesConverted: { currency: 'GBP', amount: 316 },
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'g-other', name: 'Other', emoji: 'O' },
            balancesNative: [{ currency: 'USD', amount: 1000 }],
            balances: [{ currency: 'USD', amount: 1000 }],
            balancesConverted: null,
          }),
          fixtureBucket({
            group: { id: 'g-trip', name: 'Trip', emoji: '🇵🇰' },
            balancesNative: [{ currency: 'PKR', amount: 50000 }],
            balances: [{ currency: 'PKR', amount: 50000 }],
            balancesConverted: null,
          }),
        ],
      }),
    ]);
    render(<FriendsPreview />);

    await user.click(screen.getByRole('button', { name: SHOW_LABEL }));
    await user.click(screen.getByRole('button', { name: /Settle up with Ana in Trip/i }));

    expect(capturedGroupId).toBe('g-trip');
    expect(capturedPrefill).toEqual(
      expect.objectContaining({ currency: 'PKR', amount: 50000 }),
    );
  });
});
