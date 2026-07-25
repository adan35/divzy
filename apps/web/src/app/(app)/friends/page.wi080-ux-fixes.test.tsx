// spec-WI-080 — Friends page per-group breakdown UX fixes (web surface).
//
// Covers: truthful direct-bucket label "Direct (outside groups)", per-bucket
// composition count hints (singular/plural, zero-kind omission, mixed ordering,
// absent counts), single-affordance rule (plus/minus toggle on expandable rows,
// chevron-right on single-bucket rows, never two glyphs), tree-line prefixes
// including the truncation boundary, and bucket-line navigation with event
// isolation.
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
const DIRECT_LABEL = 'Direct (outside groups)';

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

function rowLinkFor(name: string): HTMLElement {
  const link = screen.getByText(name).closest('a');
  if (!link) throw new Error(`could not find row link for "${name}"`);
  return link as HTMLElement;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bucketLinkFor(label: string): HTMLElement {
  const el = screen.getByRole('link', { name: new RegExp(escapeRegExp(label), 'i') });
  if (!el) throw new Error(`could not find bucket link for "${label}"`);
  return el as HTMLElement;
}

/** Decorative tree connector for a bucket label. */
function connectorFor(label: string): HTMLElement {
  const link = bucketLinkFor(label);
  const span = link.querySelector('[data-testid="tree-connector"]');
  if (!span) throw new Error(`could not find tree connector for "${label}"`);
  return span as HTMLElement;
}

describe('FriendsPage — WI-080 per-group breakdown UX fixes', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('direct bucket label is "Direct (outside groups)" and never contains "expenses"', async () => {
    const user = userEvent.setup();
    setup([
      fixtureFriend({
        balancesByGroup: [
          fixtureBucket({
            group: null,
            balancesNative: [{ currency: 'USD', amount: -500 }],
            balancesConverted: { currency: 'USD', amount: -500 },
          }),
          fixtureBucket({
            group: { id: 'group-trip', name: 'Trip to Rome', emoji: '🧳' },
            balancesNative: [{ currency: 'USD', amount: 2000 }],
            balancesConverted: { currency: 'USD', amount: 2000 },
          }),
        ],
      }),
    ]);
    render(<FriendsPage />);

    await user.click(screen.getByRole('button', { name: SHOW_LABEL }));

    expect(screen.queryByText('Direct expenses')).not.toBeInTheDocument();
    expect(screen.getByText(DIRECT_LABEL, { exact: false })).toBeInTheDocument();
  });

  it('count hint pluralizes expenses and settlements correctly', async () => {
    const user = userEvent.setup();
    setup([
      fixtureFriend({
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'g1', name: 'One Expense', emoji: '1' },
            balancesNative: [{ currency: 'USD', amount: 100 }],
            balancesConverted: { currency: 'USD', amount: 100 },
            expenseCount: 1,
            settlementCount: 0,
          }),
          fixtureBucket({
            group: { id: 'g2', name: 'Two Expenses', emoji: '2' },
            balancesNative: [{ currency: 'USD', amount: 200 }],
            balancesConverted: { currency: 'USD', amount: 200 },
            expenseCount: 2,
            settlementCount: 0,
          }),
          fixtureBucket({
            group: { id: 'g3', name: 'One Settlement', emoji: '3' },
            balancesNative: [{ currency: 'USD', amount: 300 }],
            balancesConverted: { currency: 'USD', amount: 300 },
            expenseCount: 0,
            settlementCount: 1,
          }),
          fixtureBucket({
            group: { id: 'g4', name: 'Two Settlements', emoji: '4' },
            balancesNative: [{ currency: 'USD', amount: 400 }],
            balancesConverted: { currency: 'USD', amount: 400 },
            expenseCount: 0,
            settlementCount: 2,
          }),
        ],
      }),
    ]);
    render(<FriendsPage />);
    await user.click(screen.getByRole('button', { name: SHOW_LABEL }));

    expect(screen.getByText('1 expense')).toBeInTheDocument();
    expect(screen.getByText('2 expenses')).toBeInTheDocument();
    expect(screen.getByText('1 settlement')).toBeInTheDocument();
    expect(screen.getByText('2 settlements')).toBeInTheDocument();
  });

  it('count hint orders mixed kinds by descending count, expenses first on ties', async () => {
    const user = userEvent.setup();
    setup([
      fixtureFriend({
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'g-more-settlements', name: 'More Settlements', emoji: 'S' },
            balancesNative: [{ currency: 'USD', amount: 100 }],
            balancesConverted: { currency: 'USD', amount: 100 },
            expenseCount: 1,
            settlementCount: 2,
          }),
          fixtureBucket({
            group: { id: 'g-more-expenses', name: 'More Expenses', emoji: 'E' },
            balancesNative: [{ currency: 'USD', amount: 200 }],
            balancesConverted: { currency: 'USD', amount: 200 },
            expenseCount: 3,
            settlementCount: 1,
          }),
          fixtureBucket({
            group: { id: 'g-tie', name: 'Tie', emoji: 'T' },
            balancesNative: [{ currency: 'USD', amount: 300 }],
            balancesConverted: { currency: 'USD', amount: 300 },
            expenseCount: 2,
            settlementCount: 2,
          }),
        ],
      }),
    ]);
    render(<FriendsPage />);
    await user.click(screen.getByRole('button', { name: SHOW_LABEL }));

    expect(screen.getByText('2 settlements · 1 expense')).toBeInTheDocument();
    expect(screen.getByText('3 expenses · 1 settlement')).toBeInTheDocument();
    expect(screen.getByText('2 expenses · 2 settlements')).toBeInTheDocument();
  });

  it('count hint omits zero kinds entirely (settlements-only bucket does not show "0 expenses")', async () => {
    const user = userEvent.setup();
    setup([
      fixtureFriend({
        balancesByGroup: [
          fixtureBucket({
            group: null,
            balancesNative: [{ currency: 'USD', amount: -500 }],
            balancesConverted: { currency: 'USD', amount: -500 },
            expenseCount: 0,
            settlementCount: 2,
          }),
          fixtureBucket({
            group: { id: 'g-other', name: 'Other Group', emoji: 'O' },
            balancesNative: [{ currency: 'USD', amount: 100 }],
            balancesConverted: { currency: 'USD', amount: 100 },
            expenseCount: 1,
            settlementCount: 0,
          }),
        ],
      }),
    ]);
    render(<FriendsPage />);
    await user.click(screen.getByRole('button', { name: SHOW_LABEL }));

    expect(screen.getByText('2 settlements')).toBeInTheDocument();
    expect(screen.queryByText(/0 expenses?/i)).not.toBeInTheDocument();
  });

  it('absent counts render no composition hint (backward-compatible fixtures)', async () => {
    const user = userEvent.setup();
    setup([
      fixtureFriend({
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'g1', name: 'No Counts', emoji: 'N' },
            balancesNative: [{ currency: 'USD', amount: 100 }],
            balancesConverted: { currency: 'USD', amount: 100 },
          }),
          fixtureBucket({
            group: { id: 'g2', name: 'Also No Counts', emoji: 'A' },
            balancesNative: [{ currency: 'USD', amount: 200 }],
            balancesConverted: { currency: 'USD', amount: 200 },
          }),
        ],
      }),
    ]);
    render(<FriendsPage />);
    await user.click(screen.getByRole('button', { name: SHOW_LABEL }));

    expect(screen.getByText(/N No Counts/)).toBeInTheDocument();
    expect(screen.queryByText(/expense|settlement/i)).not.toBeInTheDocument();
  });

  it('expandable rows have exactly one affordance (plus/minus toggle) and no decorative chevron', () => {
    setup([
      fixtureFriend({
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'g1', name: 'Group One', emoji: '1' },
            balancesNative: [{ currency: 'USD', amount: 100 }],
            balancesConverted: { currency: 'USD', amount: 100 },
          }),
          fixtureBucket({
            group: { id: 'g2', name: 'Group Two', emoji: '2' },
            balancesNative: [{ currency: 'USD', amount: 200 }],
            balancesConverted: { currency: 'USD', amount: 200 },
          }),
        ],
      }),
    ]);
    render(<FriendsPage />);

    const row = rowLinkFor('Priya Owe').parentElement;
    if (!row) throw new Error('row wrapper not found');
    expect(within(row).getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: SHOW_LABEL })).toBeInTheDocument();
    // No decorative navigation chevron remains on the right.
    expect(row.querySelector('svg.lucide-chevron-right')).not.toBeInTheDocument();
    expect(row.querySelectorAll('svg').length).toBe(1);
  });

  it('single-bucket rows keep only the chevron-right navigation affordance and no expand toggle', () => {
    setup([
      fixtureFriend({
        balancesNative: [{ currency: 'USD', amount: 100 }],
        balancesConverted: { currency: 'USD', amount: 100 },
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'g1', name: 'Only Group', emoji: '1' },
            balancesNative: [{ currency: 'USD', amount: 100 }],
            balancesConverted: { currency: 'USD', amount: 100 },
          }),
        ],
      }),
    ]);
    render(<FriendsPage />);

    expect(screen.queryByRole('button', { name: SHOW_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: HIDE_LABEL })).not.toBeInTheDocument();
    const row = rowLinkFor('Priya Owe').parentElement;
    if (!row) throw new Error('row wrapper not found');
    // Exactly one chevron glyph (the navigation indicator).
    expect(row.querySelectorAll('svg').length).toBe(1);
    expect(row.querySelector('svg')).toHaveClass('lucide-chevron-right');
  });

  it('expand toggle has state-aware aria-label and aria-expanded', async () => {
    const user = userEvent.setup();
    setup([
      fixtureFriend({
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'g1', name: 'Group One', emoji: '1' },
            balancesNative: [{ currency: 'USD', amount: 100 }],
            balancesConverted: { currency: 'USD', amount: 100 },
          }),
          fixtureBucket({
            group: { id: 'g2', name: 'Group Two', emoji: '2' },
            balancesNative: [{ currency: 'USD', amount: 200 }],
            balancesConverted: { currency: 'USD', amount: 200 },
          }),
        ],
      }),
    ]);
    render(<FriendsPage />);

    const toggle = screen.getByRole('button', { name: SHOW_LABEL });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(screen.getByRole('button', { name: HIDE_LABEL })).toHaveAttribute('aria-expanded', 'true');
  });

  it('tree-line connectors: non-last lines use mid and the last visible line uses terminal', async () => {
    const user = userEvent.setup();
    setup([
      fixtureFriend({
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'g1', name: 'Alpha', emoji: 'A' },
            balancesNative: [{ currency: 'USD', amount: 100 }],
            balancesConverted: { currency: 'USD', amount: 100 },
          }),
          fixtureBucket({
            group: { id: 'g2', name: 'Beta', emoji: 'B' },
            balancesNative: [{ currency: 'USD', amount: 200 }],
            balancesConverted: { currency: 'USD', amount: 200 },
          }),
          fixtureBucket({
            group: { id: 'g3', name: 'Gamma', emoji: 'G' },
            balancesNative: [{ currency: 'USD', amount: 300 }],
            balancesConverted: { currency: 'USD', amount: 300 },
          }),
        ],
      }),
    ]);
    render(<FriendsPage />);
    await user.click(screen.getByRole('button', { name: SHOW_LABEL }));

    const panel = connectorFor('Alpha').closest('div');
    expect(panel?.textContent).not.toMatch(/[├└─|_]/);
    expect(panel?.querySelector('.font-mono')).toBeNull();

    expect(connectorFor('Alpha')).toHaveAttribute('data-connector', 'mid');
    expect(connectorFor('Beta')).toHaveAttribute('data-connector', 'mid');
    expect(connectorFor('Gamma')).toHaveAttribute('data-connector', 'terminal');
  });

  it('truncation boundary: 6 buckets shows first 4, the 4th is mid, overflow toggle is terminal', async () => {
    const user = userEvent.setup();
    const buckets = Array.from({ length: 6 }, (_, i) =>
      fixtureBucket({
        group: { id: `group-${i + 1}`, name: `Group ${i + 1}`, emoji: '👥' },
        balancesNative: [{ currency: 'USD', amount: 100 * (i + 1) }],
        balancesConverted: { currency: 'USD', amount: 100 * (i + 1) },
      }),
    );
    setup([fixtureFriend({ balancesByGroup: buckets })]);
    render(<FriendsPage />);
    await user.click(screen.getByRole('button', { name: SHOW_LABEL }));

    for (const n of [1, 2, 3, 4]) {
      expect(connectorFor(`Group ${n}`)).toHaveAttribute('data-connector', 'mid');
    }
    expect(screen.queryByText(/Group 5/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Group 6/)).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: '+2 more groups' });
    expect(toggle).toBeInTheDocument();
    expect(within(toggle).getByTestId('tree-connector')).toHaveAttribute(
      'data-connector',
      'terminal',
    );
  });

  it('group bucket lines link to /groups/[id] and direct line links to /friends/[friendId]', async () => {
    const user = userEvent.setup();
    setup([
      fixtureFriend({
        user: { id: 'friend-abc', name: 'Priya Owe', avatarColor: '#111' },
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'group-trip', name: 'Trip to Rome', emoji: '🧳' },
            balancesNative: [{ currency: 'USD', amount: 2000 }],
            balancesConverted: { currency: 'USD', amount: 2000 },
          }),
          fixtureBucket({
            group: null,
            balancesNative: [{ currency: 'USD', amount: -500 }],
            balancesConverted: { currency: 'USD', amount: -500 },
          }),
        ],
      }),
    ]);
    render(<FriendsPage />);
    await user.click(screen.getByRole('button', { name: SHOW_LABEL }));

    expect(bucketLinkFor('Trip to Rome')).toHaveAttribute('href', '/groups/group-trip');
    expect(bucketLinkFor(DIRECT_LABEL)).toHaveAttribute('href', '/friends/friend-abc');
  });

  it('clicking a bucket line does not trigger row navigation or toggle expansion', async () => {
    const user = userEvent.setup();
    const rowNavigate = vi.fn();
    setup([
      fixtureFriend({
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'group-trip', name: 'Trip to Rome', emoji: '🧳' },
            balancesNative: [{ currency: 'USD', amount: 2000 }],
            balancesConverted: { currency: 'USD', amount: 2000 },
          }),
          fixtureBucket({
            group: { id: 'group-home', name: 'Home', emoji: '🏠' },
            balancesNative: [{ currency: 'USD', amount: -500 }],
            balancesConverted: { currency: 'USD', amount: -500 },
          }),
        ],
      }),
    ]);
    render(<FriendsPage />);
    await user.click(screen.getByRole('button', { name: SHOW_LABEL }));

    const row = rowLinkFor('Priya Owe');
    row.addEventListener('click', rowNavigate);

    const groupLine = bucketLinkFor('Trip to Rome');
    await user.click(groupLine);

    // The Link still navigates via href (we assert href above), but bubbling
    // to the row Link is stopped.
    expect(rowNavigate).not.toHaveBeenCalled();
    // Expansion state is unchanged (still expanded).
    expect(screen.getByRole('button', { name: HIDE_LABEL })).toBeInTheDocument();
  });
});
