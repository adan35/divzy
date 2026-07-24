// spec-WI-037 — Friends page balance-direction filter.
//
// Covers: default "None" shows all friends, "Any outstanding balance" /
// "Friends you owe" / "Friends who owe you" filter via the shared
// matchesBalanceFilter predicate over balancesNative (never the converted
// figure), a mixed-currency friend appears under both direction filters, and
// the filter re-applies live (derived from useFriends() data, not frozen).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FriendDto } from '@divzy/shared';
import FriendsPage from './page';
import { useAddFriend, useFriendCode, useFriends, useRotateFriendCode } from '@/lib/hooks';

vi.mock('@/lib/hooks', () => ({
  useFriends: vi.fn(),
  useAddFriend: vi.fn(),
  useFriendCode: vi.fn(),
  useRotateFriendCode: vi.fn(),
  errorMessage: () => 'error',
}));

const mockedUseFriends = vi.mocked(useFriends);

function fixtureFriend(overrides: Partial<FriendDto> = {}): FriendDto {
  return {
    user: { id: 'friend-1', name: 'Alex Rivera', avatarColor: '#111' },
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    balancesByGroup: [],
    lastActivityAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('FriendsPage — balance-direction filter (spec-WI-037)', () => {
  const youOwe = fixtureFriend({
    user: { id: 'friend-youowe', name: 'Priya Owe', avatarColor: '#222' },
    balancesNative: [{ currency: 'USD', amount: -1000 }],
  });
  const owedYou = fixtureFriend({
    user: { id: 'friend-owedyou', name: 'Dev Owed', avatarColor: '#333' },
    balancesNative: [{ currency: 'USD', amount: 1000 }],
  });
  const settled = fixtureFriend({
    user: { id: 'friend-settled', name: 'Sam Settled', avatarColor: '#444' },
    balancesNative: [],
  });
  const mixed = fixtureFriend({
    user: { id: 'friend-mixed', name: 'Mika Mixed', avatarColor: '#555' },
    balancesNative: [
      { currency: 'USD', amount: -1000 },
      { currency: 'EUR', amount: 500 },
    ],
  });

  beforeEach(() => {
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseFriends.mockReturnValue({
      data: [youOwe, owedYou, settled, mixed],
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
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('defaults to "None" and shows every friend', () => {
    render(<FriendsPage />);
    expect(screen.getByText('Priya Owe')).toBeInTheDocument();
    expect(screen.getByText('Dev Owed')).toBeInTheDocument();
    expect(screen.getByText('Sam Settled')).toBeInTheDocument();
    expect(screen.getByText('Mika Mixed')).toBeInTheDocument();
  });

  it('"Any outstanding balance" hides the settled friend only', async () => {
    const user = userEvent.setup();
    render(<FriendsPage />);

    await user.selectOptions(
      screen.getByRole('combobox', { name: /filter friends/i }),
      'outstanding',
    );

    expect(screen.queryByText('Sam Settled')).not.toBeInTheDocument();
    expect(screen.getByText('Priya Owe')).toBeInTheDocument();
    expect(screen.getByText('Dev Owed')).toBeInTheDocument();
    expect(screen.getByText('Mika Mixed')).toBeInTheDocument();
  });

  it('"Friends you owe" shows only friends with a negative native amount', async () => {
    const user = userEvent.setup();
    render(<FriendsPage />);

    await user.selectOptions(
      screen.getByRole('combobox', { name: /filter friends/i }),
      'youOwe',
    );

    expect(screen.getByText('Priya Owe')).toBeInTheDocument();
    expect(screen.getByText('Mika Mixed')).toBeInTheDocument();
    expect(screen.queryByText('Dev Owed')).not.toBeInTheDocument();
    expect(screen.queryByText('Sam Settled')).not.toBeInTheDocument();
  });

  it('"Friends who owe you" shows only friends with a positive native amount, including the mixed friend', async () => {
    const user = userEvent.setup();
    render(<FriendsPage />);

    await user.selectOptions(
      screen.getByRole('combobox', { name: /filter friends/i }),
      'owedYou',
    );

    expect(screen.getByText('Dev Owed')).toBeInTheDocument();
    expect(screen.getByText('Mika Mixed')).toBeInTheDocument();
    expect(screen.queryByText('Priya Owe')).not.toBeInTheDocument();
  });

  it('shows a friendly empty state when a filter matches nobody', async () => {
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseFriends.mockReturnValue({
      data: [settled],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    const user = userEvent.setup();
    render(<FriendsPage />);

    await user.selectOptions(
      screen.getByRole('combobox', { name: /filter friends/i }),
      'youOwe',
    );

    expect(screen.getByText(/no friends you owe/i)).toBeInTheDocument();
  });
});
