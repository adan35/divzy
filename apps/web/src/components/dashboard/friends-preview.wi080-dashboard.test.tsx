// spec-WI-080 — Dashboard friends-preview per-group breakdown UX fixes.
//
// Covers the same shared-breakdown behavior as the friends page, plus
// dashboard-specific event isolation: bucket-line clicks do NOT open the
// settle dialog, and the primary row button still opens it (WI-050 regression).
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

const SHOW_LABEL = /show per-group breakdown/i;
const HIDE_LABEL = /hide per-group breakdown/i;
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bucketLinkFor(label: string): HTMLElement {
  const el = screen.getByRole('link', { name: new RegExp(escapeRegExp(label), 'i') });
  if (!el) throw new Error(`could not find bucket link for "${label}"`);
  return el as HTMLElement;
}

function prefixFor(label: string): HTMLElement {
  const link = bucketLinkFor(label);
  const span = link.querySelector('p > span.font-mono');
  if (!span) throw new Error(`could not find prefix span for "${label}"`);
  return span as HTMLElement;
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
  });
}

describe('FriendsPreview — WI-080 per-group breakdown UX fixes', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    capturedOpenProp = undefined;
    capturedPrefillProp = undefined;
  });

  it('shows the truthful direct-bucket label and composition counts', async () => {
    const user = userEvent.setup();
    setup([twoBucketFriend()]);
    render(<FriendsPreview />);

    await user.click(screen.getByRole('button', { name: SHOW_LABEL }));

    expect(screen.queryByText('Direct expenses')).not.toBeInTheDocument();
    expect(screen.getByText(DIRECT_LABEL, { exact: false })).toBeInTheDocument();
    expect(screen.getByText('3 expenses · 1 settlement')).toBeInTheDocument();
    expect(screen.getByText('2 settlements')).toBeInTheDocument();
  });

  it('expandable rows have only the plus/minus toggle and no decorative chevron', () => {
    setup([twoBucketFriend()]);
    render(<FriendsPreview />);

    const row = screen.getByRole('button', { name: /sam lee/i }).parentElement;
    if (!row) throw new Error('row wrapper not found');
    expect(screen.queryByRole('button', { name: SHOW_LABEL })).toBeInTheDocument();
    expect(row.querySelector('svg.lucide-chevron-right')).not.toBeInTheDocument();
    expect(row.querySelectorAll('svg').length).toBe(1);
  });

  it('single-bucket rows keep the chevron-right affordance and suppress the expand toggle', () => {
    setup([
      fixtureFriend({
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'g1', name: 'Only Group', emoji: '1' },
            balancesNative: [{ currency: 'USD', amount: 100 }],
            balancesConverted: { currency: 'GBP', amount: 79 },
          }),
        ],
      }),
    ]);
    render(<FriendsPreview />);

    expect(screen.queryByRole('button', { name: SHOW_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: HIDE_LABEL })).not.toBeInTheDocument();
    const row = screen.getByRole('button', { name: /sam lee/i }).parentElement;
    if (!row) throw new Error('row wrapper not found');
    expect(row.querySelectorAll('svg').length).toBe(1);
    expect(row.querySelector('svg')).toHaveClass('lucide-chevron-right');
  });

  it('tree-line prefixes render and the last visible line uses └─', async () => {
    const user = userEvent.setup();
    setup([twoBucketFriend()]);
    render(<FriendsPreview />);
    await user.click(screen.getByRole('button', { name: SHOW_LABEL }));

    expect(prefixFor('Trip to Rome').textContent).toBe('├─ ');
    expect(prefixFor(DIRECT_LABEL).textContent).toBe('└─ ');
  });

  it('bucket lines link to /groups/[id] and /friends/[friendId]', async () => {
    const user = userEvent.setup();
    setup([twoBucketFriend()]);
    render(<FriendsPreview />);
    await user.click(screen.getByRole('button', { name: SHOW_LABEL }));

    expect(bucketLinkFor('Trip to Rome')).toHaveAttribute('href', '/groups/group-trip');
    expect(bucketLinkFor(DIRECT_LABEL)).toHaveAttribute('href', '/friends/sam');
  });

  it('clicking a bucket line does not open the settle dialog', async () => {
    const user = userEvent.setup();
    setup([twoBucketFriend()]);
    render(<FriendsPreview />);
    await user.click(screen.getByRole('button', { name: SHOW_LABEL }));

    expect(capturedOpenProp).toBe(false);

    await user.click(bucketLinkFor('Trip to Rome'));

    expect(capturedOpenProp).toBe(false);
    expect(capturedPrefillProp).toBeUndefined();
  });

  it('primary row click still opens the prefilled settle dialog (WI-050 intact)', async () => {
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
});
