import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FriendBalanceBucket, FriendDto, UserDto } from '@divzy/shared';
import FriendsPage from './page';
import { useAddFriend, useFriendCode, useFriends, useRotateFriendCode } from '@/lib/hooks';

vi.mock('@/lib/hooks', () => ({
  useFriends: vi.fn(),
  useAddFriend: vi.fn(),
  useFriendCode: vi.fn(),
  useRotateFriendCode: vi.fn(),
  errorMessage: () => 'error',
  useGroup: vi.fn(() => ({ data: undefined, isLoading: false, isError: false, error: null })),
  useGroupBalances: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })),
  useCreateSettlement: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
  })),
  useUploadReceipt: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
  })),
}));
vi.mock('@/lib/auth-store', () => ({
  useAuth: () => ({ user: fixtureMe() }),
}));

let capturedGroupId: string | undefined;
let capturedPrefill: unknown;

vi.mock('@/components/settle/settle-dialog', () => ({
  SettleUpDialog: (props: { open: boolean; groupId?: string; prefill?: unknown }) => {
    capturedGroupId = props.groupId;
    capturedPrefill = props.prefill;
    return null;
  },
}));

const mockedUseFriends = vi.mocked(useFriends);

const TOGGLE_NAME = /show per-group breakdown/i;

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
  // @ts-expect-error -- test setup only (partial UseQueryResult)
  mockedUseFriends.mockReturnValue({
    data: friends,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
  // @ts-expect-error -- test setup only
  vi.mocked(useAddFriend).mockReturnValue({ mutate: vi.fn(), isPending: false });
  // @ts-expect-error -- test setup only
  vi.mocked(useFriendCode).mockReturnValue({ data: undefined, isLoading: true, isError: false });
  // @ts-expect-error -- test setup only
  vi.mocked(useRotateFriendCode).mockReturnValue({ mutate: vi.fn(), isPending: false });
}

describe('FriendsPage — WI-084 bucket-line settle-up', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    capturedGroupId = undefined;
    capturedPrefill = undefined;
  });

  it('clicking a group bucket line opens the group-scoped dialog with correct prefill', async () => {
    const user = userEvent.setup();
    setup([
      fixtureFriend({
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'g-trip', name: 'Trip to Lahore', emoji: '🇵🇰' },
            balancesNative: [{ currency: 'PKR', amount: 50000 }],
            balances: [{ currency: 'PKR', amount: 50000 }],
            balancesConverted: null,
          }),
          fixtureBucket({
            group: { id: 'g-other', name: 'Other', emoji: 'O' },
            balancesNative: [{ currency: 'USD', amount: 1000 }],
            balances: [{ currency: 'USD', amount: 1000 }],
            balancesConverted: null,
          }),
        ],
      }),
    ]);
    render(<FriendsPage />);

    await user.click(screen.getByRole('button', { name: TOGGLE_NAME }));
    await user.click(screen.getByRole('button', { name: /Settle up with Ana in Trip to Lahore/i }));

    expect(capturedGroupId).toBe('g-trip');
    expect(capturedPrefill).toEqual({
      fromUserId: 'ana',
      toUserId: 'me',
      amount: 50000,
      currency: 'PKR',
    });
  });

  it('clicking a direct bucket line opens a non-group dialog', async () => {
    const user = userEvent.setup();
    setup([
      fixtureFriend({
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'g-other', name: 'Other', emoji: 'O' },
            balancesNative: [{ currency: 'USD', amount: 1000 }],
            balances: [{ currency: 'USD', amount: 1000 }],
            balancesConverted: null,
          }),
          fixtureBucket({
            group: null,
            balancesNative: [{ currency: 'USD', amount: -1250 }],
            balances: [{ currency: 'USD', amount: -1250 }],
            balancesConverted: null,
          }),
        ],
      }),
    ]);
    render(<FriendsPage />);

    await user.click(screen.getByRole('button', { name: TOGGLE_NAME }));
    await user.click(screen.getByRole('button', { name: /Settle up with Ana \(outside groups\)/i }));

    expect(capturedGroupId).toBeUndefined();
    expect(capturedPrefill).toEqual({
      fromUserId: 'me',
      toUserId: 'ana',
      amount: 1250,
      currency: 'USD',
    });
  });

  it('cross-bucket-cancel friend keeps each bucket individually clickable with opposite directions', async () => {
    const user = userEvent.setup();
    setup([
      fixtureFriend({
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'g-a', name: 'Alpha', emoji: 'A' },
            balancesNative: [{ currency: 'USD', amount: 1000 }],
            balancesConverted: { currency: 'USD', amount: 1000 },
          }),
          fixtureBucket({
            group: { id: 'g-b', name: 'Beta', emoji: 'B' },
            balancesNative: [{ currency: 'USD', amount: -1000 }],
            balancesConverted: { currency: 'USD', amount: -1000 },
          }),
        ],
      }),
    ]);
    render(<FriendsPage />);

    await user.click(screen.getByRole('button', { name: TOGGLE_NAME }));

    await user.click(screen.getByRole('button', { name: /Settle up with Ana in Alpha/i }));
    expect(capturedPrefill).toEqual({
      fromUserId: 'ana',
      toUserId: 'me',
      amount: 1000,
      currency: 'USD',
    });

    await user.click(screen.getByRole('button', { name: /Settle up with Ana in Beta/i }));
    expect(capturedPrefill).toEqual({
      fromUserId: 'me',
      toUserId: 'ana',
      amount: 1000,
      currency: 'USD',
    });
  });
});
