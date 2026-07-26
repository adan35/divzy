// spec-WI-049 §4 regression guard — Test-stage addition.
//
// Build's own review (reviews/build-WI-049.md, "Coverage") flagged that the
// `FriendRow` defect fix (switching from `friend.balances` to
// `collapsedBalanceEntries(friend.balancesConverted, friend.balances)`) had
// no *direct* assertion: the existing `page.wi037-balance-filter.test.tsx`
// fixtures only set `balancesNative` (used by the WI-037 filter predicate),
// never `balancesConverted`/`balances`, so every row in that file collapses
// to an empty entries list and renders "Settled up" regardless of the fix —
// it can't catch a regression back to the old `friend.balances`-only read.
//
// This file exercises the fix directly: a friend whose balance is FULLY
// convertible (`balancesConverted` set, `balances` empty) must render a
// colored, signed amount — never "Settled up" (the pre-fix defect this
// story's build pass corrected).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { FriendDto } from '@divzy/shared';
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

/**
 * The summary card above the list can coincidentally render the same
 * formatted-money text as a single friend's row amount (e.g. one friend ⇒
 * the card's "Net" figure equals that friend's own balance) — scope
 * assertions to the row itself (the `<a>` link) so they can't accidentally
 * pass/fail against the card instead of the row under test.
 */
function rowFor(name: string): HTMLElement {
  const link = screen.getByText(name).closest('a');
  if (!link) throw new Error(`could not find row link for "${name}"`);
  return link as HTMLElement;
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

describe('FriendsPage — FriendRow row-level regression (spec-WI-049 §4)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('a fully-converted friend (balancesConverted set, balances empty) shows a colored signed amount, NOT "Settled up"', () => {
    const owesMe = fixtureFriend({
      user: { id: 'friend-owed', name: 'Priya Owed', avatarColor: '#222' },
      balancesConverted: { currency: 'USD', amount: 2000 },
      balances: [],
    });
    setup([owesMe]);

    render(<FriendsPage />);

    const row = rowFor('Priya Owed');
    expect(within(row).queryByText('Settled up')).not.toBeInTheDocument();
    expect(within(row).getByText('+$20.00')).toBeInTheDocument();
  });

  it('a truly settled friend (balancesConverted null, balances empty) still shows "Settled up"', () => {
    const settled = fixtureFriend({
      user: { id: 'friend-settled', name: 'Sam Settled', avatarColor: '#333' },
      balancesConverted: null,
      balances: [],
    });
    setup([settled]);

    render(<FriendsPage />);

    const row = rowFor('Sam Settled');
    expect(within(row).getByText('Settled up')).toBeInTheDocument();
  });

  it('a fully-converted negative balance renders the signed negative amount in the negative color token', () => {
    const iOwe = fixtureFriend({
      user: { id: 'friend-iowe', name: 'Chris Owe', avatarColor: '#444' },
      balancesConverted: { currency: 'USD', amount: -1500 },
      balances: [],
    });
    setup([iOwe]);

    render(<FriendsPage />);

    const row = rowFor('Chris Owe');
    const amountEl = within(row).getByText('-$15.00');
    expect(amountEl).toBeInTheDocument();
    expect(amountEl).toHaveClass('text-neg');
  });

  it('a partially-resolved friend (converted + unresolved leftover) shows both entries and the fallback-rate note when applicable', () => {
    const partial = fixtureFriend({
      user: { id: 'friend-partial', name: 'Mika Mixed', avatarColor: '#555' },
      balancesConverted: { currency: 'USD', amount: -1000 },
      balances: [{ currency: 'XYZ', amount: 300 }],
      usedFallbackRates: true,
    });
    setup([partial]);

    render(<FriendsPage />);

    const row = rowFor('Mika Mixed');
    expect(within(row).queryByText('Settled up')).not.toBeInTheDocument();
    expect(within(row).getByText('-$10.00')).toBeInTheDocument();
    expect(within(row).getByText('est. rate')).toBeInTheDocument();
  });
});
