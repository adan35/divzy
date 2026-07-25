// spec-WI-083 — Remove trailing chevron from settled friend rows (dashboard).
//
// Covers: settled-up rows in the dashboard friends preview render no
// ChevronRight and no expand toggle; the layout slot is reserved by an
// invisible spacer; the row button remains a focusable button and the
// settle-dialog path is gated as before; cross-bucket-cancel rows keep the
// toggle; single-bucket outstanding rows keep the chevron; multi-bucket
// outstanding rows keep the toggle.
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
const HIDE_LABEL = /hide per-group breakdown/i;

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

function rowWrapperFor(name: string): HTMLElement {
  const btn = screen.getByRole('button', { name: new RegExp(name, 'i') });
  return btn.parentElement as HTMLElement;
}

describe('FriendsPreview — WI-083 settled-row trailing affordance', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    capturedOpenProp = undefined;
    capturedPrefillProp = undefined;
  });

  it('settled-up row renders no affordance glyphs and reserves the trailing slot with an invisible spacer', () => {
    setup([
      fixtureFriend({
        user: { id: 'settled', name: 'Sam Settled', avatarColor: '#222' },
        balancesConverted: null,
        balances: [],
        balancesByGroup: [],
      }),
    ]);
    render(<FriendsPreview />);

    const row = rowWrapperFor('Sam Settled');
    expect(within(row).queryByRole('button', { name: SHOW_LABEL })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: HIDE_LABEL })).not.toBeInTheDocument();
    expect(row.querySelector('svg.lucide-chevron-right')).not.toBeInTheDocument();
    expect(row.querySelectorAll('svg')).toHaveLength(0);
    expect(
      row.querySelector('span[aria-hidden="true"].mx-2.h-4.w-4.shrink-0'),
    ).toBeInTheDocument();
  });

  it('settled-up row is still a focusable button and the settle dialog remains closed on click (WI-050 gating intact)', async () => {
    setup([
      fixtureFriend({
        user: { id: 'settled', name: 'Sam Settled', avatarColor: '#222' },
        balancesConverted: null,
        balances: [],
        balancesByGroup: [],
      }),
    ]);
    render(<FriendsPreview />);

    const rowButton = screen.getByRole('button', { name: /sam settled/i });
    expect(rowButton.tagName).toBe('BUTTON');
    expect(capturedOpenProp).toBe(false);

    const user = userEvent.setup();
    await user.click(rowButton);

    expect(capturedOpenProp).toBe(false);
    expect(capturedPrefillProp).toBeUndefined();
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
    render(<FriendsPreview />);

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
        balancesConverted: { currency: 'GBP', amount: 1582 },
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'g1', name: 'Only Group', emoji: '1' },
            balancesNative: [{ currency: 'USD', amount: 2000 }],
            balancesConverted: { currency: 'GBP', amount: 1582 },
          }),
        ],
      }),
    ]);
    render(<FriendsPreview />);

    const row = rowWrapperFor('Priya Owed');
    expect(within(row).queryByRole('button', { name: SHOW_LABEL })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: HIDE_LABEL })).not.toBeInTheDocument();
    expect(row.querySelectorAll('svg').length).toBe(1);
    expect(row.querySelector('svg')).toHaveClass('lucide-chevron-right');
  });

  it('multi-bucket outstanding row keeps the expand toggle and no chevron', () => {
    setup([
      fixtureFriend({
        user: { id: 'mika', name: 'Mika Mixed', avatarColor: '#555' },
        balancesNative: [{ currency: 'USD', amount: 2000 }],
        balancesConverted: { currency: 'GBP', amount: 1582 },
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'g1', name: 'Group One', emoji: '1' },
            balancesNative: [{ currency: 'USD', amount: 3000 }],
            balancesConverted: { currency: 'GBP', amount: 2373 },
          }),
          fixtureBucket({
            group: { id: 'g2', name: 'Group Two', emoji: '2' },
            balancesNative: [{ currency: 'USD', amount: -1000 }],
            balancesConverted: { currency: 'GBP', amount: -791 },
          }),
        ],
      }),
    ]);
    render(<FriendsPreview />);

    const row = rowWrapperFor('Mika Mixed');
    expect(within(row).getByRole('button', { name: SHOW_LABEL })).toBeInTheDocument();
    expect(row.querySelector('svg.lucide-chevron-right')).not.toBeInTheDocument();
    expect(row.querySelectorAll('svg').length).toBe(1);
  });
});
