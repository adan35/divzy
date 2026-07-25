// spec-WI-079 §6.1 — Friends page per-group balance breakdown (web surface).
//
// Covers the story-WI-079 web scenarios: collapsed-by-default chevron toggle
// (NEVER an overloaded row tap — the row Link keeps its navigation), one
// ledger line per bucket with group emoji+name / "Direct (outside groups)" copy,
// signed you-owe/owes-you phrasing per bucket, ≤1-bucket affordance
// suppression (D11 — governed by bucket count, never the friend's settled
// state), >5-bucket "+N more groups" in-expansion overflow toggle (D10), and
// the per-bucket `est. rate` fallback notice (D9). Zero-bucket friends render
// exactly as today; loading/error/empty states and the WI-037 filter /
// WI-049 summary are untouched (guarded by their own unmodified suites).
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

const TOGGLE_NAME = /show per-group breakdown/i;
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

/**
 * Balance sentences render their money portion through a nested `<MoneyText>`
 * span, so RTL's default string matching can't see the full sentence — match
 * on the innermost element whose aggregated textContent equals the target
 * (same convention as friends-preview.test.tsx).
 */
function textMatcher(expected: string) {
  return (_: string, element: Element | null) => {
    if (element?.textContent !== expected) return false;
    const onlyChild = element.children.length === 1 ? element.children[0] : null;
    return onlyChild?.textContent !== expected;
  };
}

function rowLinkFor(name: string): HTMLElement {
  const link = screen.getByText(name).closest('a');
  if (!link) throw new Error(`could not find row link for "${name}"`);
  return link as HTMLElement;
}

/** The expanded bucket line containing a given label (matched by its aria-label). */
function bucketLineFor(label: string): HTMLElement {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const el = screen.getByRole('link', { name: new RegExp(escaped, 'i') });
  if (!el) throw new Error(`could not find bucket line for "${label}"`);
  return el as HTMLElement;
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

function twoBucketFriend(): FriendDto {
  return fixtureFriend({
    balancesNative: [{ currency: 'USD', amount: 1500 }],
    balancesConverted: { currency: 'USD', amount: 1500 },
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
  });
}

describe('FriendsPage — per-group balance breakdown (spec-WI-079 §6.1)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('is collapsed by default: a multi-bucket friend shows a chevron toggle (aria-expanded=false) and no bucket lines', () => {
    setup([twoBucketFriend()]);
    render(<FriendsPage />);

    const toggle = screen.getByRole('button', { name: TOGGLE_NAME });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/🧳 Trip to Rome/)).not.toBeInTheDocument();
    expect(screen.queryByText(DIRECT_LABEL, { exact: false })).not.toBeInTheDocument();
    // The collapsed row itself is untouched — still a link to friend detail.
    expect(rowLinkFor('Priya Owe')).toHaveAttribute('href', '/friends/friend-1');
  });

  it('expanding renders one ledger line per bucket: group label, signed direction phrasing, and the "Direct (outside groups)" direct bucket', async () => {
    const user = userEvent.setup();
    setup([twoBucketFriend()]);
    render(<FriendsPage />);

    const toggle = screen.getByRole('button', { name: TOGGLE_NAME });
    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // D7: the plus/minus icon swaps when expanded.
    expect(toggle.querySelector('svg')).toHaveClass('lucide-minus');

    const groupLine = bucketLineFor('Trip to Rome');
    expect(within(groupLine).getByText(textMatcher('Priya owes you $20.00'))).toBeInTheDocument();

    const directLine = bucketLineFor(DIRECT_LABEL);
    // D8: direct bucket carries no emoji and the secondary text-ink-3 styling.
    expect(screen.getByText(DIRECT_LABEL, { exact: false })).toHaveClass('text-ink-3');
    expect(within(directLine).getByText(textMatcher('You owe Priya $5.00'))).toBeInTheDocument();

    // Collapsing again hides the breakdown.
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/🧳 Trip to Rome/)).not.toBeInTheDocument();
  });

  it('a zero-bucket friend renders exactly as today — no toggle, no breakdown', () => {
    setup([fixtureFriend()]);
    render(<FriendsPage />);

    expect(screen.queryByRole('button', { name: TOGGLE_NAME })).not.toBeInTheDocument();
    expect(within(rowLinkFor('Priya Owe')).getByText('Settled up')).toBeInTheDocument();
  });

  it('a single-bucket friend never gets the expand affordance (D11 — one bucket would duplicate the collapsed row)', () => {
    setup([
      fixtureFriend({
        balancesNative: [{ currency: 'USD', amount: 2000 }],
        balancesConverted: { currency: 'USD', amount: 2000 },
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'group-trip', name: 'Trip to Rome', emoji: '🧳' },
            balancesNative: [{ currency: 'USD', amount: 2000 }],
            balancesConverted: { currency: 'USD', amount: 2000 },
          }),
        ],
      }),
    ]);
    render(<FriendsPage />);

    expect(screen.queryByRole('button', { name: TOGGLE_NAME })).not.toBeInTheDocument();
    expect(screen.queryByText(/🧳 Trip to Rome/)).not.toBeInTheDocument();
  });

  it('a cross-bucket-cancel friend (collapsed net ZERO) keeps the toggle and both nonzero bucket lines while the row still reads "Settled up" (D11/R3)', async () => {
    const user = userEvent.setup();
    setup([
      fixtureFriend({
        // Top-level net is zero — buckets +1000 / -1000 cancel; the DTO still
        // carries both nonzero buckets (settled buckets are dropped API-side,
        // so the UI renders only what the DTO carries).
        balancesNative: [],
        balancesConverted: null,
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'group-a', name: 'Alpha Group', emoji: '🏠' },
            balancesNative: [{ currency: 'USD', amount: 1000 }],
            balancesConverted: { currency: 'USD', amount: 1000 },
          }),
          fixtureBucket({
            group: { id: 'group-b', name: 'Beta Group', emoji: '🎿' },
            balancesNative: [{ currency: 'USD', amount: -1000 }],
            balancesConverted: { currency: 'USD', amount: -1000 },
          }),
        ],
      }),
    ]);
    render(<FriendsPage />);

    // Collapsed row, WI-037 filter, and WI-049 summary all keep reading the
    // (correct) zero top-level net.
    expect(within(rowLinkFor('Priya Owe')).getByText('Settled up')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: TOGGLE_NAME }));
    expect(within(bucketLineFor('Alpha Group')).getByText(textMatcher('Priya owes you $10.00'))).toBeInTheDocument();
    expect(within(bucketLineFor('Beta Group')).getByText(textMatcher('You owe Priya $10.00'))).toBeInTheDocument();
  });

  it('>5 buckets renders the first 4 plus a "+N more groups" in-expansion toggle that reveals the rest (D10)', async () => {
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

    await user.click(screen.getByRole('button', { name: TOGGLE_NAME }));

    for (const n of [1, 2, 3, 4]) {
      expect(screen.getByText(`👥 Group ${n}`)).toBeInTheDocument();
    }
    expect(screen.queryByText('👥 Group 5')).not.toBeInTheDocument();
    expect(screen.queryByText('👥 Group 6')).not.toBeInTheDocument();

    const moreToggle = screen.getByRole('button', { name: '+2 more groups' });
    await user.click(moreToggle);

    expect(screen.getByText('👥 Group 5')).toBeInTheDocument();
    expect(screen.getByText('👥 Group 6')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more groups/ })).not.toBeInTheDocument();
  });

  it('per-bucket fallback notice renders only on the flagged bucket (D9), never as a blanket breakdown notice', async () => {
    const user = userEvent.setup();
    setup([
      fixtureFriend({
        // Top-level flag stays false so the collapsed row carries no notice —
        // the ONLY "est. rate" in the document must be the flagged bucket's.
        usedFallbackRates: false,
        balancesNative: [{ currency: 'USD', amount: 3000 }],
        balancesConverted: { currency: 'USD', amount: 3000 },
        balancesByGroup: [
          fixtureBucket({
            group: { id: 'group-trip', name: 'Trip to Rome', emoji: '🧳' },
            balancesNative: [{ currency: 'USD', amount: 2000 }],
            balancesConverted: { currency: 'USD', amount: 2000 },
            usedFallbackRates: true,
          }),
          fixtureBucket({
            group: null,
            balancesNative: [{ currency: 'USD', amount: 1000 }],
            balancesConverted: { currency: 'USD', amount: 1000 },
          }),
        ],
      }),
    ]);
    render(<FriendsPage />);

    expect(screen.queryByText('est. rate')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: TOGGLE_NAME }));

    const flaggedLine = bucketLineFor('Trip to Rome');
    expect(within(flaggedLine).getByText('est. rate')).toBeInTheDocument();
    const directLine = bucketLineFor(DIRECT_LABEL);
    expect(within(directLine).queryByText('est. rate')).not.toBeInTheDocument();
    // Exactly one notice across the whole surface.
    expect(screen.getAllByText('est. rate')).toHaveLength(1);
  });
});
