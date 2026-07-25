// spec-WI-083 — Remove trailing chevron from settled friend rows (web surface).
//
// Covers: settled-up rows on the Friends page render no ChevronRight and no
// expand toggle; the layout slot is reserved by an invisible spacer; row
// navigation remains intact; cross-bucket-cancel rows keep the toggle;
// single-bucket outstanding rows keep the chevron; multi-bucket outstanding
// rows keep the toggle.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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

const SHOW_LABEL = /show per-group breakdown/i;
const HIDE_LABEL = /hide per-group breakdown/i;

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

function rowWrapperFor(name: string): HTMLElement {
  const link = screen.getByText(name).closest('a');
  if (!link) throw new Error(`row link for "${name}" not found`);
  return link.parentElement as HTMLElement;
}

describe('FriendsPage — WI-083 settled-row trailing affordance', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('settled-up row renders no affordance glyphs and reserves the trailing slot with an invisible spacer', () => {
    setup([
      fixtureFriend({
        user: { id: 'sam', name: 'Sam Settled', avatarColor: '#222' },
        balancesConverted: null,
        balances: [],
        balancesByGroup: [],
      }),
    ]);
    render(<FriendsPage />);

    const row = rowWrapperFor('Sam Settled');
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    expect(row.querySelector('svg.lucide-chevron-right')).not.toBeInTheDocument();
    expect(row.querySelectorAll('svg')).toHaveLength(0);
    expect(
      row.querySelector('span[aria-hidden="true"].mx-2.h-4.w-4.shrink-0'),
    ).toBeInTheDocument();
  });

  it('settled-up row still navigates via its Link', () => {
    setup([
      fixtureFriend({
        user: { id: 'sam', name: 'Sam Settled', avatarColor: '#222' },
        balancesConverted: null,
        balances: [],
        balancesByGroup: [],
      }),
    ]);
    render(<FriendsPage />);

    expect(rowWrapperFor('Sam Settled').querySelector('a')).toHaveAttribute('href', '/friends/sam');
  });

  it('cross-bucket-cancel settled row keeps the expand toggle and expands its breakdown', async () => {
    const user = userEvent.setup();
    setup([
      fixtureFriend({
        user: { id: 'cross', name: 'Cross Bucket', avatarColor: '#333' },
        balancesConverted: null,
        balances: [],
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

    const row = rowWrapperFor('Cross Bucket');
    expect(within(row).getByRole('button', { name: SHOW_LABEL })).toBeInTheDocument();
    expect(row.querySelector('svg.lucide-chevron-right')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: SHOW_LABEL }));
    expect(screen.getByRole('button', { name: HIDE_LABEL })).toBeInTheDocument();
    expect(screen.getByText(/Alpha/)).toBeInTheDocument();
    expect(screen.getByText(/Beta/)).toBeInTheDocument();
  });

  it('single-bucket outstanding row keeps the chevron-right affordance and no toggle', () => {
    setup([
      fixtureFriend({
        user: { id: 'priya', name: 'Priya Owed', avatarColor: '#444' },
        balancesNative: [{ currency: 'USD', amount: 2000 }],
        balancesConverted: { currency: 'USD', amount: 2000 },
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'g1', name: 'Only Group', emoji: '1' },
            balancesNative: [{ currency: 'USD', amount: 2000 }],
            balancesConverted: { currency: 'USD', amount: 2000 },
          }),
        ],
      }),
    ]);
    render(<FriendsPage />);

    const row = rowWrapperFor('Priya Owed');
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    expect(row.querySelectorAll('svg').length).toBe(1);
    expect(row.querySelector('svg')).toHaveClass('lucide-chevron-right');
  });

  it('multi-bucket outstanding row keeps the expand toggle and no chevron', () => {
    setup([
      fixtureFriend({
        user: { id: 'mika', name: 'Mika Mixed', avatarColor: '#555' },
        balancesNative: [{ currency: 'USD', amount: 2000 }],
        balancesConverted: { currency: 'USD', amount: 2000 },
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'g1', name: 'Group One', emoji: '1' },
            balancesNative: [{ currency: 'USD', amount: 3000 }],
            balancesConverted: { currency: 'USD', amount: 3000 },
          }),
          fixtureBucket({
            group: { id: 'g2', name: 'Group Two', emoji: '2' },
            balancesNative: [{ currency: 'USD', amount: -1000 }],
            balancesConverted: { currency: 'USD', amount: -1000 },
          }),
        ],
      }),
    ]);
    render(<FriendsPage />);

    const row = rowWrapperFor('Mika Mixed');
    expect(within(row).getByRole('button', { name: SHOW_LABEL })).toBeInTheDocument();
    expect(row.querySelector('svg.lucide-chevron-right')).not.toBeInTheDocument();
    expect(row.querySelectorAll('svg').length).toBe(1);
  });
});
