// Test-stage (test-social-groups) boundary coverage for WI-079 D10 on the web
// surface: the overflow threshold is EXACTLY 5 — a friend with exactly 5
// buckets renders all five lines with NO "+N more groups" toggle, while 6
// buckets (covered by Build's wi079-group-breakdown.test.tsx) collapses to
// first 4 + toggle. Written from spec-WI-079 §5 D10 ("balancesByGroup.length
// > 5 → render the first 4 …"), not from the implementation.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FriendBalanceBucket, FriendDto } from '@divzy/shared';
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

const TOGGLE_NAME = /show per-group breakdown/i;

function fixtureFriend(overrides: Partial<FriendDto> = {}): FriendDto {
  return {
    user: { id: 'friend-1', name: 'Priya Owe', avatarColor: '#111' },
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

describe('FriendsPage — D10 overflow boundary at exactly 5 buckets (WI-079, test-stage)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('exactly 5 buckets renders all five lines with no "+N more groups" toggle and the 5th line terminal', async () => {
    const user = userEvent.setup();
    const buckets = Array.from({ length: 5 }, (_, i) =>
      fixtureBucket({
        group: { id: `group-${i + 1}`, name: `Group ${i + 1}`, emoji: '👥' },
        balancesNative: [{ currency: 'USD', amount: 100 * (i + 1) }],
        balancesConverted: { currency: 'USD', amount: 100 * (i + 1) },
      }),
    );
    setup([fixtureFriend({ balancesByGroup: buckets })]);
    render(<FriendsPage />);

    await user.click(screen.getByRole('button', { name: TOGGLE_NAME }));

    for (const n of [1, 2, 3, 4, 5]) {
      expect(screen.getByText(`👥 Group ${n}`)).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /more groups/ })).not.toBeInTheDocument();

    const connectors = screen.getAllByTestId('tree-connector');
    expect(connectors).toHaveLength(5);
    connectors.slice(0, 4).forEach((connector) => {
      expect(connector).toHaveAttribute('data-connector', 'mid');
    });
    expect(connectors[4]).toHaveAttribute('data-connector', 'terminal');
  });
});
