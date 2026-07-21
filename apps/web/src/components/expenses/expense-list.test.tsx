import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  formatMoney,
  type ExpenseDto,
  type PublicUserDto,
  type UserDto,
} from '@divzy/shared';
import { useAuth } from '@/lib/auth-store';
import { useExpensesInfinite, useUsedCategories } from '@/lib/hooks';
import { ExpenseList } from './expense-list';

// Isolate ExpenseList's own row-rendering logic: the detail dialog and editor
// are separate components with their own hook dependencies, not relevant to
// what this file tests (WI-011's list-row caption).
vi.mock('./expense-detail', () => ({
  ExpenseDetailDialog: () => null,
}));
vi.mock('./expense-editor', () => ({
  ExpenseEditorDialog: () => null,
}));

vi.mock('@/lib/auth-store', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/lib/hooks', () => ({
  errorMessage: (error: unknown) => String(error),
  useExpensesInfinite: vi.fn(),
  useUsedCategories: vi.fn(),
}));

const mePublic: PublicUserDto = { id: 'me', name: 'Me', avatarColor: '#111111' };
const meUser: UserDto = {
  ...mePublic,
  email: 'me@example.com',
  defaultCurrency: 'PKR',
  emailNotifications: false,
  staleBalanceRemindersEnabled: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const ana: PublicUserDto = { id: 'ana', name: 'Ana', avatarColor: '#222222' };
const ben: PublicUserDto = { id: 'ben', name: 'Ben', avatarColor: '#333333' };

// `getByText`'s default normalizer only runs on the DOM side of the
// comparison, not on the matcher string — so a raw `formatMoney()` result
// (which uses a non-breaking space, e.g. "PKR 8.00") never matches the
// normalized DOM text ("PKR 8.00"). Collapse it the same way here.
function money(minor: number, currency: string): string {
  return formatMoney(minor, currency).replace(/\s+/g, ' ');
}

function makeExpense(
  payers: ExpenseDto['payers'],
  splits: ExpenseDto['splits'],
): ExpenseDto {
  return {
    id: 'exp-1',
    groupId: null,
    group: null,
    description: 'Dinner',
    amount: 1600,
    currency: 'PKR',
    category: 'FOOD_DRINK',
    date: '2026-07-01T00:00:00.000Z',
    splitType: 'EQUAL',
    notes: null,
    receiptUrl: null,
    payers,
    splits,
    items: [],
    createdBy: mePublic,
    updatedBy: null,
    commentCount: 0,
    deletedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function renderRow(expense: ExpenseDto) {
  (useAuth as unknown as Mock).mockReturnValue({ user: meUser, status: 'authed' });
  (useExpensesInfinite as unknown as Mock).mockReturnValue({
    data: { pages: [{ items: [expense], nextCursor: null }] },
    isLoading: false,
    isError: false,
    error: null,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  });
  // Unscoped by default (no groupId/friendId prop) — useUsedCategories is
  // disabled in that case in the real hook, so its return value is inert.
  (useUsedCategories as unknown as Mock).mockReturnValue({ data: undefined });
  return render(<ExpenseList />);
}

describe('ExpenseList row — "at the time" caption (WI-011, story-WI-011-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scenario: nonzero lens (you lent) — caption renders beneath the unchanged amount', () => {
    const expense = makeExpense(
      [{ user: mePublic, amount: 1600 }],
      [
        { user: mePublic, amount: 800, shares: null, percentBps: null, adjustment: null },
        { user: ana, amount: 800, shares: null, percentBps: null, adjustment: null },
      ],
    );
    renderRow(expense);

    expect(screen.getByText('you lent')).toBeInTheDocument();
    expect(screen.getByText(money(800, 'PKR'))).toBeInTheDocument();
    expect(screen.getByText('at the time')).toBeInTheDocument();
  });

  it('scenario: nonzero lens (you borrowed) — caption renders beneath the unchanged amount', () => {
    const expense = makeExpense(
      [{ user: ana, amount: 1600 }],
      [
        { user: mePublic, amount: 800, shares: null, percentBps: null, adjustment: null },
        { user: ana, amount: 800, shares: null, percentBps: null, adjustment: null },
      ],
    );
    renderRow(expense);

    expect(screen.getByText('you borrowed')).toBeInTheDocument();
    expect(screen.getByText(money(800, 'PKR'))).toBeInTheDocument();
    expect(screen.getByText('at the time')).toBeInTheDocument();
  });

  it('scenario: not-yet-settled / regression check — zero lens is unaffected, no caption', () => {
    const expense = makeExpense(
      [
        { user: mePublic, amount: 800 },
        { user: ana, amount: 800 },
      ],
      [
        { user: mePublic, amount: 800, shares: null, percentBps: null, adjustment: null },
        { user: ana, amount: 800, shares: null, percentBps: null, adjustment: null },
      ],
    );
    renderRow(expense);

    expect(screen.getByText('no balance')).toBeInTheDocument();
    expect(screen.queryByText('at the time')).not.toBeInTheDocument();
  });

  it('scenario: multi-payer expense (3 payers) — lens still sums matching payer rows and caption renders (story-WI-011-1 scenario 3)', () => {
    const expense = makeExpense(
      [
        { user: mePublic, amount: 500 },
        { user: ana, amount: 500 },
        { user: ben, amount: 600 },
      ],
      [
        { user: mePublic, amount: 400, shares: null, percentBps: null, adjustment: null },
        { user: ana, amount: 600, shares: null, percentBps: null, adjustment: null },
        { user: ben, amount: 600, shares: null, percentBps: null, adjustment: null },
      ],
    );
    renderRow(expense);

    // paid (500) - split (400) = 100 lent — unchanged multi-payer math, plus caption.
    expect(screen.getByText('you lent')).toBeInTheDocument();
    expect(screen.getByText(money(100, 'PKR'))).toBeInTheDocument();
    expect(screen.getByText('at the time')).toBeInTheDocument();
  });

  it('scenario: not-yet-settled / regression check — not-involved is unaffected, no caption', () => {
    const expense = makeExpense(
      [{ user: ana, amount: 1600 }],
      [{ user: ana, amount: 1600, shares: null, percentBps: null, adjustment: null }],
    );
    renderRow(expense);

    expect(screen.getByText('not involved')).toBeInTheDocument();
    expect(screen.queryByText('at the time')).not.toBeInTheDocument();
  });
});

const APPROX_LABEL =
  "Approximate — today's rate; the rate on this expense's date isn't available";

describe('ExpenseList row — converted amount (WI-014)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scenario: convertedAmount present — renders the ≈ converted figure next to the amount', () => {
    const expense: ExpenseDto = {
      ...makeExpense(
        [{ user: ana, amount: 1600 }],
        [{ user: ana, amount: 1600, shares: null, percentBps: null, adjustment: null }],
      ),
      convertedAmount: 500,
      convertedCurrency: 'USD',
      rateBasis: 'exact',
      isApproximateRate: false,
    };
    renderRow(expense);

    expect(screen.getByText('≈')).toBeInTheDocument();
    expect(screen.getByText(money(500, 'USD'))).toBeInTheDocument();
  });

  it('scenario: converted block absent — renders exactly as before, no converted figure', () => {
    const expense = makeExpense(
      [{ user: ana, amount: 1600 }],
      [{ user: ana, amount: 1600, shares: null, percentBps: null, adjustment: null }],
    );
    renderRow(expense);

    expect(screen.queryByText('≈')).not.toBeInTheDocument();
  });

  it('scenario: isApproximateRate true — renders a distinguishable approximation marker', () => {
    const expense: ExpenseDto = {
      ...makeExpense(
        [{ user: ana, amount: 1600 }],
        [{ user: ana, amount: 1600, shares: null, percentBps: null, adjustment: null }],
      ),
      convertedAmount: 500,
      convertedCurrency: 'USD',
      rateBasis: 'approximated',
      isApproximateRate: true,
    };
    renderRow(expense);

    expect(screen.getByTitle(APPROX_LABEL)).toBeInTheDocument();
  });

  it('scenario: isApproximateRate false — does not render the approximation marker', () => {
    const expense: ExpenseDto = {
      ...makeExpense(
        [{ user: ana, amount: 1600 }],
        [{ user: ana, amount: 1600, shares: null, percentBps: null, adjustment: null }],
      ),
      convertedAmount: 500,
      convertedCurrency: 'USD',
      rateBasis: 'exact',
      isApproximateRate: false,
    };
    renderRow(expense);

    expect(screen.queryByTitle(APPROX_LABEL)).not.toBeInTheDocument();
  });
});

describe('ExpenseList — category pills narrow to used categories when scoped (WI-063)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useAuth as unknown as Mock).mockReturnValue({ user: meUser, status: 'authed' });
    (useExpensesInfinite as unknown as Mock).mockReturnValue({
      data: { pages: [{ items: [], nextCursor: null }] },
      isLoading: false,
      isError: false,
      error: null,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    });
  });

  function pillGroup() {
    return screen.getByRole('group', { name: 'Filter by category' });
  }

  function pillLabels() {
    return within(pillGroup())
      .getAllByRole('button')
      .map((b) => b.textContent?.trim());
  }

  it('scenario Sc.1/Sc.8: groupId-scoped mount shows only "All" + used categories, in canonical order', () => {
    (useUsedCategories as unknown as Mock).mockReturnValue({
      data: { categories: ['GROCERIES', 'FOOD_DRINK'] },
    });
    render(<ExpenseList groupId="group-1" />);

    const labels = pillLabels();
    expect(labels[0]).toBe('All');
    // Canonical order (EXPENSE_CATEGORIES) is FOOD_DRINK before GROCERIES,
    // even though the server returned GROCERIES first (D3).
    expect(labels.slice(1)).toEqual(['🍕 Food & drink', '🛒 Groceries']);
  });

  it('scenario Sc.2: friendId-scoped mount narrows the same way as groupId', () => {
    (useUsedCategories as unknown as Mock).mockReturnValue({
      data: { categories: ['TRAVEL'] },
    });
    render(<ExpenseList friendId="friend-1" />);

    expect(pillLabels()).toEqual(['All', '✈️ Travel']);
  });

  it('scenario Sc.3: "All" pill is always present and unconditional even when narrowed', () => {
    (useUsedCategories as unknown as Mock).mockReturnValue({ data: { categories: [] } });
    render(<ExpenseList groupId="group-1" />);

    expect(within(pillGroup()).getByRole('button', { name: 'All' })).toBeInTheDocument();
  });

  it('scenario Sc.5: zero used categories in a scoped context shows only "All"', () => {
    (useUsedCategories as unknown as Mock).mockReturnValue({ data: { categories: [] } });
    render(<ExpenseList groupId="group-1" />);

    expect(pillLabels()).toEqual(['All']);
  });

  it('scenario Sc.5 (full): a brand-new group with zero expenses shows only "All" AND the existing "no expenses yet" empty state still renders below it', () => {
    (useUsedCategories as unknown as Mock).mockReturnValue({ data: { categories: [] } });
    render(<ExpenseList groupId="group-1" />);

    expect(pillLabels()).toEqual(['All']);
    expect(screen.getByText('No expenses yet')).toBeInTheDocument();
  });

  it('WI-064: unscoped mount (no groupId/friendId) narrows the same way as a scoped mount, using the unscoped aggregate', () => {
    (useUsedCategories as unknown as Mock).mockReturnValue({
      data: { categories: ['GROCERIES'] },
    });
    render(<ExpenseList />);

    expect(pillLabels()).toEqual(['All', '🛒 Groceries']);
  });

  it('WI-064: unscoped mount calls useUsedCategories with the unscoped opt-in', () => {
    (useUsedCategories as unknown as Mock).mockReturnValue({ data: { categories: [] } });
    render(<ExpenseList />);

    expect(useUsedCategories).toHaveBeenCalledWith(
      { groupId: undefined, friendId: undefined },
      { unscoped: true },
    );
  });

  it('WI-064: unscoped mount with zero used categories shows only "All"', () => {
    (useUsedCategories as unknown as Mock).mockReturnValue({ data: { categories: [] } });
    render(<ExpenseList />);

    expect(pillLabels()).toEqual(['All']);
  });

  it('story-WI-064 Sc.4: a brand-new user with zero expenses anywhere (unscoped "All expenses" mount) shows only "All" AND the existing "no expenses yet" empty state still renders correctly', () => {
    (useUsedCategories as unknown as Mock).mockReturnValue({ data: { categories: [] } });
    render(<ExpenseList emptyHint="Add your first expense to start tracking who owes what." />);

    expect(pillLabels()).toEqual(['All']);
    expect(screen.getByText('No expenses yet')).toBeInTheDocument();
    expect(
      screen.getByText('Add your first expense to start tracking who owes what.'),
    ).toBeInTheDocument();
  });

  it('while the scoped query is loading (no data yet), only "All" shows — no flash of all 16', () => {
    (useUsedCategories as unknown as Mock).mockReturnValue({ data: undefined });
    render(<ExpenseList groupId="group-1" />);

    expect(pillLabels()).toEqual(['All']);
  });

  it('scenario Sc.9: selecting a shown (narrowed) category pill still filters the list exactly as it does today', () => {
    (useUsedCategories as unknown as Mock).mockReturnValue({
      data: { categories: ['FOOD_DRINK', 'GROCERIES'] },
    });
    render(<ExpenseList groupId="group-1" />);

    (useExpensesInfinite as unknown as Mock).mockClear();
    fireEvent.click(within(pillGroup()).getByRole('button', { name: /Groceries/ }));

    // Re-queries useExpensesInfinite with the selected category in filters —
    // the pre-existing, unmodified-by-WI-063 filtering mechanism (setCategory
    // -> filters.category -> useExpensesInfinite(filters)).
    expect(useExpensesInfinite).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'group-1', category: 'GROCERIES' }),
    );

    // Clicking the now-active pill again clears the filter back to "All".
    (useExpensesInfinite as unknown as Mock).mockClear();
    fireEvent.click(within(pillGroup()).getByRole('button', { name: /Groceries/ }));
    expect(useExpensesInfinite).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'group-1', category: undefined }),
    );
  });

  it('scenario D4: selecting a pill then having it drop out of the used set resets the selection to "All"', () => {
    (useUsedCategories as unknown as Mock).mockReturnValue({
      data: { categories: ['FOOD_DRINK', 'GROCERIES'] },
    });
    const { rerender } = render(<ExpenseList groupId="group-1" />);

    fireEvent.click(within(pillGroup()).getByRole('button', { name: /Groceries/ }));
    expect(within(pillGroup()).getByRole('button', { name: /Groceries/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // GROCERIES no longer used — a fresh fetch (e.g. after invalidation) drops it.
    (useUsedCategories as unknown as Mock).mockReturnValue({
      data: { categories: ['FOOD_DRINK'] },
    });
    rerender(<ExpenseList groupId="group-1" />);

    expect(within(pillGroup()).getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(pillGroup()).queryByRole('button', { name: /Groceries/ })).not.toBeInTheDocument();
  });
});
