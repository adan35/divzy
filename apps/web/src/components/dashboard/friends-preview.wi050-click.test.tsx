import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FriendDto, UserDto } from '@divzy/shared';

/**
 * Build-stage TDD coverage for spec-WI-050 §3/§4: clicking a dashboard
 * Friends-row opens `SettleUpDialog`, prefilled/gated by the same
 * `friendSettleIntent` logic the friend-detail page uses. Mocking approach
 * mirrors the friend-detail page's own wi001/wi010/wi012 prefill tests: the
 * real `SettleUpDialog` import is replaced with a capture shim so we can
 * assert on the exact `open`/`prefill` props without re-deriving the logic.
 *
 * spec-WI-050 (REOPENED, 2026-07-18): direction fixtures below deliberately
 * leave `balances` (the WI-001-narrowed field) empty and populate
 * `balancesNative` instead — the exact shape that exposed the reopened bug
 * (the shipped helper read `balances`, silently falling back to
 * from=me/to=friend whenever it was empty).
 */

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

describe('WI-050 — FriendsPreview opens the prefilled, zero-gated settle-up dialog on row click', () => {
  it('single native currency, friend owes me -> opens with the debtor-pays-creditor prefill', async () => {
    useAuthMock.mockReturnValue({ user: fixtureMe() });
    useFriendsMock.mockReturnValue({
      isPending: false,
      isError: false,
      // balances (narrowed) stays [] — the common post-WI-001 case; direction
      // must come from balancesNative, not the narrowed leftover field.
      // balancesConverted non-zero because USD is (per the DTO invariant)
      // convertible — that's exactly why `balances` is empty here.
      data: [
        fixtureFriend({
          balances: [],
          balancesNative: [{ currency: 'USD', amount: 4000 }],
          balancesConverted: { currency: 'GBP', amount: 3163 },
        }),
      ],
    });

    render(<FriendsPreview />);
    expect(capturedOpenProp).toBe(false);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /sam lee/i }));

    expect(capturedOpenProp).toBe(true);
    expect(capturedPrefillProp).toEqual({
      fromUserId: 'sam',
      toUserId: 'me',
      amount: 4000,
      currency: 'USD',
    });
  });

  it('single native currency, I owe friend -> opens with direction reversed', async () => {
    useAuthMock.mockReturnValue({ user: fixtureMe() });
    useFriendsMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: [
        fixtureFriend({
          user: { id: 'ana', name: 'Ana Diaz', avatarColor: '#222' },
          balances: [],
          balancesNative: [{ currency: 'PKR', amount: -80000 }],
          balancesConverted: { currency: 'GBP', amount: -220 },
        }),
      ],
    });

    render(<FriendsPreview />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /ana diaz/i }));

    expect(capturedOpenProp).toBe(true);
    expect(capturedPrefillProp).toEqual({
      fromUserId: 'me',
      toUserId: 'ana',
      amount: 80000,
      currency: 'PKR',
    });
  });

  it('ambiguous non-zero balance (two native leftovers) -> opens with the amount:0 fallback', async () => {
    useAuthMock.mockReturnValue({ user: fixtureMe() });
    useFriendsMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: [
        fixtureFriend({
          user: { id: 'deepa', name: 'Deepa Rao', avatarColor: '#333' },
          // Both currencies unconvertible here, so `balances` (narrowed)
          // realistically holds both leftovers too — also sufficient on its
          // own to keep the disable gate's nothingOutstanding false.
          balances: [
            { currency: 'JPY', amount: -50000 },
            { currency: 'USD', amount: 4000 },
          ],
          balancesNative: [
            { currency: 'JPY', amount: -50000 },
            { currency: 'USD', amount: 4000 },
          ],
        }),
      ],
    });

    render(<FriendsPreview />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /deepa rao/i }));

    expect(capturedOpenProp).toBe(true);
    expect(capturedPrefillProp).toEqual({
      fromUserId: 'me',
      toUserId: 'deepa',
      amount: 0,
      currency: 'GBP',
    });
  });

  it('nothing outstanding -> the dialog does not open', async () => {
    useAuthMock.mockReturnValue({ user: fixtureMe() });
    useFriendsMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: [
        fixtureFriend({
          user: { id: 'beth', name: 'Beth Fox', avatarColor: '#444' },
          balances: [],
          balancesConverted: null,
        }),
      ],
    });

    render(<FriendsPreview />);
    expect(screen.getByText('Settled up')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /beth fox/i }));

    expect(capturedOpenProp).toBe(false);
    expect(capturedPrefillProp).toBeUndefined();
  });

  it('the row is a real keyboard-accessible button and the section header link is untouched', () => {
    useAuthMock.mockReturnValue({ user: fixtureMe() });
    useFriendsMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: [fixtureFriend({ balances: [{ currency: 'USD', amount: 4000 }] })],
    });

    render(<FriendsPreview />);
    expect(screen.getByRole('button', { name: /sam lee/i }).tagName).toBe('BUTTON');
    expect(screen.getByRole('link', { name: /see all/i })).toHaveAttribute('href', '/friends');
  });
});
