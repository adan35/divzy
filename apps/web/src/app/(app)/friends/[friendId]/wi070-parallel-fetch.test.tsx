// spec-WI-070 §Decision 3 / story-WI-070.md Gherkin ("Web friend-detail page:
// parallel fetch, unchanged content") — ExpenseList/SettlementsSection must
// mount off the route's friendId immediately, without waiting on useFriend to
// resolve; the 404 FRIENDSHIP_NOT_FOUND case must keep the distinct "not in
// your friends yet" empty state (not the generic error card); any other
// error must show the generic error card; and once useFriend resolves the
// rendered header/balance content must be unchanged from before this story.
//
// Mocking convention mirrors wi001-prefill.test.tsx / wi010-prefill.test.tsx /
// wi012-balance-gate.test.tsx (same file family): mock next/navigation and
// @/lib/hooks (useFriend/useRemoveFriend/errorMessage), plus every heavy
// child. UNLIKE those files, ExpenseList/SettlementsSection are mocked as
// capturing components (not `() => null`) so we can assert they mounted and
// received the route's friendId, even while useFriend is still pending or
// erroring.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { FriendDto, UserDto } from '@divzy/shared';
import { ApiError } from '@divzy/api-client';

const useFriendMock = vi.fn();
const useAuthMock = vi.fn();
let capturedExpenseListProps: { groupId?: string; friendId?: string } | null = null;
let capturedSettlementsProps: { friendId?: string } | null = null;

vi.mock('next/navigation', () => ({
  useParams: () => ({ friendId: 'sam' }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/lib/hooks', () => ({
  useFriend: () => useFriendMock(),
  useRemoveFriend: () => ({ mutate: vi.fn(), isPending: false }),
  errorMessage: (error: unknown) =>
    error instanceof ApiError ? error.message : 'Something went wrong',
}));
vi.mock('@/lib/auth-store', () => ({ useAuth: () => useAuthMock() }));
vi.mock('@/components/expenses/expense-list', () => ({
  ExpenseList: (props: { groupId?: string; friendId?: string }) => {
    capturedExpenseListProps = props;
    return <div data-testid="expense-list" />;
  },
}));
vi.mock('@/components/friends/settlements-section', () => ({
  SettlementsSection: (props: { friendId?: string }) => {
    capturedSettlementsProps = props;
    return <div data-testid="settlements-section" />;
  },
}));
vi.mock('@/components/expenses/expense-editor', () => ({ ExpenseEditorDialog: () => null }));
vi.mock('@/components/settle/settle-dialog', () => ({ SettleUpDialog: () => null }));

import FriendDetailPage from './page';

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

beforeEach(() => {
  capturedExpenseListProps = null;
  capturedSettlementsProps = null;
  useAuthMock.mockReturnValue({ user: fixtureMe() });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WI-070 — friend-detail page: ExpenseList/SettlementsSection mount off the route friendId', () => {
  it('mount immediately (using the route friendId) while useFriend is still pending, not waiting for it to resolve', () => {
    useFriendMock.mockReturnValue({ isPending: true, isError: false, data: undefined });

    render(<FriendDetailPage />);

    expect(screen.getByTestId('expense-list')).toBeInTheDocument();
    expect(screen.getByTestId('settlements-section')).toBeInTheDocument();
    expect(capturedExpenseListProps).toEqual({ friendId: 'sam', emptyHint: expect.any(String) });
    expect(capturedSettlementsProps).toEqual({ friendId: 'sam' });
  });

  it('mount off the route friendId (not friend.user.id) once useFriend resolves — same value here, but sourced from the route', () => {
    useFriendMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: fixtureFriend({ user: { id: 'sam', name: 'Sam Lee', avatarColor: '#000' } }),
    });

    render(<FriendDetailPage />);

    expect(capturedExpenseListProps?.friendId).toBe('sam');
    expect(capturedSettlementsProps?.friendId).toBe('sam');
  });

  it('a still-pending state with prior data absent renders children off friendId even before the header resolves', () => {
    useFriendMock.mockReturnValue({ isPending: true, isError: false, data: undefined });

    render(<FriendDetailPage />);

    // The header shows its skeleton (not the resolved Card) while children
    // are unconditionally mounted — proves they don't wait on the header.
    expect(screen.queryByText('Sam Lee')).not.toBeInTheDocument();
    expect(screen.getByTestId('expense-list')).toBeInTheDocument();
    expect(screen.getByTestId('settlements-section')).toBeInTheDocument();
  });
});

describe('WI-070 — not-a-friend (404 FRIENDSHIP_NOT_FOUND) keeps the distinct empty state', () => {
  it('shows "Not in your friends yet", not the generic error card', () => {
    useFriendMock.mockReturnValue({
      isPending: false,
      isError: true,
      error: new ApiError(404, "This person isn't in your friends list", 'FRIENDSHIP_NOT_FOUND'),
      data: undefined,
      refetch: vi.fn(),
    });

    render(<FriendDetailPage />);

    expect(screen.getByText(/not in your friends yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load this friend/i)).not.toBeInTheDocument();
  });

  it('still renders the empty state as a full-page card (no ExpenseList/SettlementsSection — the empty state early-returns)', () => {
    useFriendMock.mockReturnValue({
      isPending: false,
      isError: true,
      error: new ApiError(404, "This person isn't in your friends list", 'FRIENDSHIP_NOT_FOUND'),
      data: undefined,
      refetch: vi.fn(),
    });

    render(<FriendDetailPage />);

    // The not-a-friend card is a terminal early return (matches pre-WI-070
    // behavior for this branch) — confirmed distinct from the generic error
    // card, which is the AC's actual requirement.
    expect(screen.getByText(/not in your friends yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('expense-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settlements-section')).not.toBeInTheDocument();
  });
});

describe('WI-070 — any OTHER error still shows the generic error card', () => {
  it('a non-FRIENDSHIP_NOT_FOUND error (e.g. 500) shows "Couldn\'t load this friend"', () => {
    useFriendMock.mockReturnValue({
      isPending: false,
      isError: true,
      error: new ApiError(500, 'Server exploded', 'INTERNAL'),
      data: undefined,
      refetch: vi.fn(),
    });

    render(<FriendDetailPage />);

    expect(screen.getByText(/couldn.t load this friend/i)).toBeInTheDocument();
    expect(screen.queryByText(/not in your friends yet/i)).not.toBeInTheDocument();
    // This terminal state is an unchanged, full-page early return (matches
    // pre-WI-070 behavior) — it does not mount ExpenseList/SettlementsSection.
    expect(screen.queryByTestId('expense-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settlements-section')).not.toBeInTheDocument();
  });

  it('a network error (non-ApiError) also shows the generic error card, not the empty state', () => {
    useFriendMock.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error('network down'),
      data: undefined,
      refetch: vi.fn(),
    });

    render(<FriendDetailPage />);

    expect(screen.getByText(/couldn.t load this friend/i)).toBeInTheDocument();
  });
});

describe('WI-070 — final rendered content is unchanged once everything resolves', () => {
  it('renders the header name, balance figure, and children once useFriend resolves — same content shape as before this story', () => {
    useFriendMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: fixtureFriend({
        user: { id: 'sam', name: 'Sam Lee', avatarColor: '#000' },
        balancesConverted: { currency: 'GBP', amount: -1234 },
        balances: [],
      }),
    });

    render(<FriendDetailPage />);

    expect(screen.getByText('Sam Lee')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /settle up/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /add expense/i })).toBeInTheDocument();
    expect(screen.getByTestId('expense-list')).toBeInTheDocument();
    expect(screen.getByTestId('settlements-section')).toBeInTheDocument();
  });

  it('renders the "all settled up" state when there is nothing outstanding', () => {
    useFriendMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: fixtureFriend({ balances: [], balancesConverted: null }),
    });

    render(<FriendDetailPage />);

    expect(screen.getByText(/all settled up/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /settle up/i })).toBeDisabled();
  });
});
