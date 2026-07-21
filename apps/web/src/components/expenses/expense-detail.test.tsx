import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  formatMoney,
  type ExpenseDto,
  type ExpenseRevisionDto,
  type PublicUserDto,
} from '@divzy/shared';
import { useAuth } from '@/lib/auth-store';
import {
  useAddComment,
  useComments,
  useExpense,
  useExpenseHistory,
  useRestoreExpense,
} from '@/lib/hooks';
import { ExpenseDetailDialog } from './expense-detail';

// The editor dialog and the delete-confirmation unit (WI-039) are separate
// components with their own (unrelated) hook dependencies; stub them out so
// this file only exercises ExpenseDetailDialog's own rendering logic (WI-011's
// detail-dialog caption). DeleteExpenseDialog's own behavior is covered by
// delete-expense-dialog.test.tsx.
vi.mock('./expense-editor', () => ({
  ExpenseEditorDialog: () => null,
}));

vi.mock('./delete-expense-dialog', () => ({
  DeleteExpenseDialog: () => null,
}));

vi.mock('@/lib/auth-store', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/lib/hooks', () => ({
  errorMessage: (error: unknown) => String(error),
  useExpense: vi.fn(),
  useComments: vi.fn(),
  useAddComment: vi.fn(),
  useExpenseHistory: vi.fn(),
  useRestoreExpense: vi.fn(),
}));

const mePublic: PublicUserDto = { id: 'me', name: 'Me', avatarColor: '#111111' };
const ana: PublicUserDto = { id: 'ana', name: 'Ana', avatarColor: '#222222' };
const ben: PublicUserDto = { id: 'ben', name: 'Ben', avatarColor: '#333333' };

// `getByText`'s default normalizer only runs on the DOM side of the
// comparison, not on the matcher string — so a raw `formatMoney()` result
// (which uses a non-breaking space, e.g. "PKR 8.00") never matches the
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

function renderDialog(
  expense: ExpenseDto,
  historyOverride?: Partial<{
    data: ExpenseRevisionDto[];
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  }>,
  restoreOverride?: Partial<{ mutate: Mock; isPending: boolean }>,
) {
  (useAuth as unknown as Mock).mockReturnValue({
    user: { ...mePublic, email: 'me@example.com', defaultCurrency: 'PKR', emailNotifications: false, createdAt: '2026-01-01T00:00:00.000Z' },
    status: 'authed',
  });
  (useExpense as unknown as Mock).mockReturnValue({
    data: expense,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  (useComments as unknown as Mock).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
  });
  (useAddComment as unknown as Mock).mockReturnValue({ mutate: vi.fn(), isPending: false });
  (useRestoreExpense as unknown as Mock).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    ...restoreOverride,
  });
  (useExpenseHistory as unknown as Mock).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...historyOverride,
  });

  return render(
    <ExpenseDetailDialog expenseId={expense.id} open onOpenChange={() => {}} />,
  );
}

describe('ExpenseDetailDialog — "at the time" caption (WI-011, story-WI-011-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scenario: nonzero lens (you lent) — caption renders beneath the unchanged badge', () => {
    const expense = makeExpense(
      [{ user: mePublic, amount: 1600 }],
      [
        { user: mePublic, amount: 800, shares: null, percentBps: null, adjustment: null },
        { user: ana, amount: 800, shares: null, percentBps: null, adjustment: null },
      ],
    );
    renderDialog(expense);

    expect(screen.getByText(`You lent ${money(800, 'PKR')}`)).toBeInTheDocument();
    expect(screen.getByText('at the time')).toBeInTheDocument();
  });

  it('scenario: nonzero lens (you borrowed) — caption renders beneath the unchanged badge', () => {
    const expense = makeExpense(
      [{ user: ana, amount: 1600 }],
      [
        { user: mePublic, amount: 800, shares: null, percentBps: null, adjustment: null },
        { user: ana, amount: 800, shares: null, percentBps: null, adjustment: null },
      ],
    );
    renderDialog(expense);

    expect(screen.getByText(`You borrowed ${money(800, 'PKR')}`)).toBeInTheDocument();
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
    renderDialog(expense);

    expect(screen.getByText('No balance for you')).toBeInTheDocument();
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
    renderDialog(expense);

    // paid (500) - split (400) = 100 lent — unchanged multi-payer math, plus caption.
    expect(screen.getByText(`You lent ${money(100, 'PKR')}`)).toBeInTheDocument();
    expect(screen.getByText('at the time')).toBeInTheDocument();
  });

  it('scenario: not-yet-settled / regression check — not-involved is unaffected, no caption', () => {
    const expense = makeExpense(
      [{ user: ana, amount: 1600 }],
      [{ user: ana, amount: 1600, shares: null, percentBps: null, adjustment: null }],
    );
    renderDialog(expense);

    expect(screen.getByText('You’re not involved')).toBeInTheDocument();
    expect(screen.queryByText('at the time')).not.toBeInTheDocument();
  });
});

const APPROX_LABEL =
  "Approximate — today's rate; the rate on this expense's date isn't available";

describe('ExpenseDetailDialog — converted amount (WI-014)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scenario: convertedAmount present — renders the ≈ converted figure next to the hero total', () => {
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
    renderDialog(expense);

    expect(screen.getByText('≈')).toBeInTheDocument();
    expect(screen.getByText(money(500, 'USD'))).toBeInTheDocument();
  });

  it('scenario: converted block absent — renders exactly as before, no converted figure', () => {
    const expense = makeExpense(
      [{ user: ana, amount: 1600 }],
      [{ user: ana, amount: 1600, shares: null, percentBps: null, adjustment: null }],
    );
    renderDialog(expense);

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
    renderDialog(expense);

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
    renderDialog(expense);

    expect(screen.queryByTitle(APPROX_LABEL)).not.toBeInTheDocument();
  });
});

describe('ExpenseDetailDialog — history (WI-017)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeRevision(overrides: Partial<ExpenseRevisionDto> = {}): ExpenseRevisionDto {
    return {
      id: 'rev-1',
      expenseId: 'exp-1',
      actor: mePublic,
      kind: 'CREATED',
      changes: [],
      createdAt: '2026-07-01T00:00:00.000Z',
      ...overrides,
    };
  }

  function baseExpense(): ExpenseDto {
    return makeExpense(
      [{ user: ana, amount: 1600 }],
      [{ user: ana, amount: 1600, shares: null, percentBps: null, adjustment: null }],
    );
  }

  it('scenario: CREATED-only entry renders "created this expense"', () => {
    const revision = makeRevision({ actor: ben, kind: 'CREATED', changes: [] });
    renderDialog(baseExpense(), { data: [revision] });

    expect(screen.getByText('created this expense')).toBeInTheDocument();
    expect(screen.getByText('Ben')).toBeInTheDocument();
  });

  it('scenario: single-field UPDATED entry (amount) renders correct before/after text', () => {
    const revision = makeRevision({
      kind: 'UPDATED',
      changes: [
        { field: 'amount', from: 1000, fromCurrency: 'PKR', to: 1600, toCurrency: 'PKR' },
      ],
    });
    renderDialog(baseExpense(), { data: [revision] });

    expect(
      screen.getByText(
        `changed amount from ${money(1000, 'PKR')} to ${money(1600, 'PKR')}`,
      ),
    ).toBeInTheDocument();
  });

  it('scenario: single-field UPDATED entry (category) renders correct before/after text', () => {
    const revision = makeRevision({
      kind: 'UPDATED',
      changes: [{ field: 'category', from: 'FOOD_DRINK', to: 'TRAVEL' }],
    });
    renderDialog(baseExpense(), { data: [revision] });

    expect(
      screen.getByText('changed category from Food & drink to Travel'),
    ).toBeInTheDocument();
  });

  it('scenario: multi-field UPDATED entry renders multiple <li> lines within one block, not two entries', () => {
    const revision = makeRevision({
      kind: 'UPDATED',
      changes: [
        { field: 'description', from: 'Dinner', to: 'Lunch' },
        { field: 'currency', from: 'PKR', to: 'USD' },
      ],
    });
    renderDialog(baseExpense(), { data: [revision] });

    expect(
      screen.getByText('changed description: "Dinner" → "Lunch"'),
    ).toBeInTheDocument();
    expect(screen.getByText('changed currency from PKR to USD')).toBeInTheDocument();
    // Both lines belong to the same entry — only one actor/time header rendered.
    // Dialog renders via a portal to document.body, so query the document, not
    // the RTL-created `container` (which sits outside the portal target).
    expect(screen.getAllByTestId('history-entry')).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="history-entry"] li')).toHaveLength(2);
  });

  it('scenario: loading state renders a skeleton, no entries or empty-state text', () => {
    renderDialog(baseExpense(), { isLoading: true, data: undefined });

    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText('No history yet')).not.toBeInTheDocument();
    expect(screen.queryByText('created this expense')).not.toBeInTheDocument();
  });

  it('scenario: error state renders the error message, matching the Comments retry idiom', () => {
    renderDialog(baseExpense(), {
      isError: true,
      error: new Error('Could not load history'),
      data: undefined,
    });

    expect(screen.getByText(/Could not load history/)).toBeInTheDocument();
  });

  it('scenario: empty history renders "No history yet" without crashing', () => {
    renderDialog(baseExpense(), { data: [] });

    expect(screen.getByText('No history yet')).toBeInTheDocument();
  });
});

describe('ExpenseDetailDialog — split chart (WI-039 fast-follow, ADR-022)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scenario: multi-participant expense — renders the split breakdown chart', () => {
    const expense = makeExpense(
      [{ user: mePublic, amount: 1600 }],
      [
        { user: mePublic, amount: 800, shares: null, percentBps: null, adjustment: null },
        { user: ana, amount: 800, shares: null, percentBps: null, adjustment: null },
      ],
    );
    renderDialog(expense);

    expect(
      screen.getByRole('img', { name: 'Expense split breakdown' }),
    ).toBeInTheDocument();
  });

  it('scenario: single-split expense — chart renders one 100% segment without crashing', () => {
    const expense = makeExpense(
      [{ user: ana, amount: 1600 }],
      [{ user: ana, amount: 1600, shares: null, percentBps: null, adjustment: null }],
    );
    renderDialog(expense);

    expect(
      screen.getByRole('img', { name: 'Expense split breakdown' }),
    ).toBeInTheDocument();
  });

  it('scenario: zero-split expense — no chart rendered, no crash', () => {
    const expense = makeExpense([{ user: ana, amount: 1600 }], []);
    renderDialog(expense);

    expect(
      screen.queryByRole('img', { name: 'Expense split breakdown' }),
    ).not.toBeInTheDocument();
  });
});

describe('ExpenseDetailDialog — Split details strip (WI-058)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeExpenseOfType(
    splitType: ExpenseDto['splitType'],
    payers: ExpenseDto['payers'],
    splits: ExpenseDto['splits'],
    itemsOverride?: ExpenseDto['items'],
  ): ExpenseDto {
    return { ...makeExpense(payers, splits), splitType, items: itemsOverride ?? [] };
  }

  it('scenario: EQUAL — each owed amount appears once per person (chart only), no mechanics strip', () => {
    const expense = makeExpenseOfType(
      'EQUAL',
      [{ user: mePublic, amount: 1600 }],
      [
        // Equal split of an odd total so the two amounts are distinct and each
        // is unambiguously traceable to exactly one rendered occurrence.
        { user: mePublic, amount: 800, shares: null, percentBps: null, adjustment: null },
        { user: ana, amount: 801, shares: null, percentBps: null, adjustment: null },
      ],
    );
    renderDialog(expense);

    expect(screen.getAllByText(money(800, 'PKR'))).toHaveLength(1);
    expect(screen.getAllByText(money(801, 'PKR'))).toHaveLength(1);
    expect(screen.queryByTestId('split-mechanics')).not.toBeInTheDocument();
  });

  it('scenario: EXACT — owed amount once, no mechanics text (none exists)', () => {
    const expense = makeExpenseOfType(
      'EXACT',
      [{ user: mePublic, amount: 1600 }],
      [
        { user: mePublic, amount: 1000, shares: null, percentBps: null, adjustment: null },
        { user: ana, amount: 600, shares: null, percentBps: null, adjustment: null },
      ],
    );
    renderDialog(expense);

    expect(screen.getAllByText(money(1000, 'PKR'))).toHaveLength(1);
    expect(screen.getAllByText(money(600, 'PKR'))).toHaveLength(1);
    expect(screen.queryByTestId('split-mechanics')).not.toBeInTheDocument();
  });

  it('scenario: PERCENT — mechanics line shows the raw input percent, not the chart-computed share, once per person', () => {
    const expense = makeExpenseOfType(
      'PERCENT',
      [{ user: mePublic, amount: 999 }],
      [
        { user: mePublic, amount: 250, shares: null, percentBps: 2500, adjustment: null },
        { user: ana, amount: 749, shares: null, percentBps: 7500, adjustment: null },
      ],
    );
    renderDialog(expense);

    // Raw input percent (25% / 75%) is preserved verbatim, distinct from
    // whatever largestRemainderPercents computes from the amounts.
    expect(screen.getByText('You · 25%')).toBeInTheDocument();
    expect(screen.getByText('Ana · 75%')).toBeInTheDocument();
    expect(screen.getAllByText(money(250, 'PKR'))).toHaveLength(1);
    expect(screen.getAllByText(money(749, 'PKR'))).toHaveLength(1);
  });

  it('scenario: SHARES — mechanics line shows share count (singular/plural), once per person', () => {
    const expense = makeExpenseOfType(
      'SHARES',
      [{ user: mePublic, amount: 1200 }],
      [
        { user: mePublic, amount: 400, shares: 1, percentBps: null, adjustment: null },
        { user: ana, amount: 800, shares: 2, percentBps: null, adjustment: null },
      ],
    );
    renderDialog(expense);

    expect(screen.getByText('You · 1 share')).toBeInTheDocument();
    expect(screen.getByText('Ana · 2 shares')).toBeInTheDocument();
  });

  it('scenario: ADJUSTMENT — mechanics line shows signed adjustment amount, once per person', () => {
    const expense = makeExpenseOfType(
      'ADJUSTMENT',
      [{ user: mePublic, amount: 1600 }],
      [
        { user: mePublic, amount: 900, shares: null, percentBps: null, adjustment: 100 },
        { user: ana, amount: 700, shares: null, percentBps: null, adjustment: -100 },
      ],
    );
    renderDialog(expense);

    expect(screen.getByText(`You · +${money(100, 'PKR')}`)).toBeInTheDocument();
    expect(screen.getByText(`Ana · −${money(100, 'PKR')}`)).toBeInTheDocument();
  });

  it('scenario: ADJUSTMENT with a zero adjustment — that person gets no mechanics line', () => {
    const expense = makeExpenseOfType(
      'ADJUSTMENT',
      [{ user: mePublic, amount: 1600 }],
      [
        { user: mePublic, amount: 800, shares: null, percentBps: null, adjustment: 0 },
        { user: ana, amount: 800, shares: null, percentBps: null, adjustment: null },
      ],
    );
    renderDialog(expense);

    expect(screen.queryByTestId('split-mechanics')).not.toBeInTheDocument();
  });

  it('scenario: ITEMIZED — owed amount once, Items table still renders, no mechanics strip', () => {
    const expense = makeExpenseOfType(
      'ITEMIZED',
      [{ user: mePublic, amount: 1000 }],
      [
        { user: mePublic, amount: 500, shares: null, percentBps: null, adjustment: null },
        { user: ana, amount: 500, shares: null, percentBps: null, adjustment: null },
      ],
      [{ id: 'item-1', name: 'Pizza', amount: 1000, participantIds: [mePublic.id, ana.id] }],
    );
    renderDialog(expense);

    expect(screen.getAllByText(money(500, 'PKR'))).toHaveLength(2);
    expect(screen.getByText('Pizza')).toBeInTheDocument();
    expect(screen.queryByTestId('split-mechanics')).not.toBeInTheDocument();
  });

  it('scenario: zero-amount SHARES participant is not dropped from the mechanics strip', () => {
    const expense = makeExpenseOfType(
      'SHARES',
      [{ user: mePublic, amount: 1600 }],
      [
        { user: mePublic, amount: 1600, shares: 5, percentBps: null, adjustment: null },
        { user: ana, amount: 0, shares: 0, percentBps: null, adjustment: null },
      ],
    );
    renderDialog(expense);

    expect(screen.getByText('You · 5 shares')).toBeInTheDocument();
    expect(screen.getByText('Ana · 0 shares')).toBeInTheDocument();
  });
});

describe('ExpenseDetailDialog — Restore (WI-054b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeDeletedExpense(): ExpenseDto {
    return {
      ...makeExpense(
        [{ user: mePublic, amount: 1600 }],
        [{ user: mePublic, amount: 1600, shares: null, percentBps: null, adjustment: null }],
      ),
      deletedAt: '2026-07-18T00:00:00.000Z',
    };
  }

  it('scenario: Restore is absent on an active (non-deleted) expense — only Edit/Delete show', () => {
    const expense = makeExpense(
      [{ user: mePublic, amount: 1600 }],
      [{ user: mePublic, amount: 1600, shares: null, percentBps: null, adjustment: null }],
    );
    renderDialog(expense);

    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('scenario: Restore is shown on a soft-deleted expense, and Edit/Delete stay hidden', () => {
    const expense = makeDeletedExpense();
    renderDialog(expense);

    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    expect(screen.getByText('Deleted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('scenario: clicking Restore calls the mutation with the expense id and groupId, no confirmation step', () => {
    const expense = { ...makeDeletedExpense(), groupId: 'group-1' };
    const mutate = vi.fn();
    renderDialog(expense, undefined, { mutate });

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    expect(mutate).toHaveBeenCalledWith(
      { expenseId: expense.id, groupId: expense.groupId },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('scenario: Restore button shows a loading state while the mutation is pending', () => {
    const expense = makeDeletedExpense();
    renderDialog(expense, undefined, { isPending: true });

    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
  });

  it('scenario: on success, the dialog reflects the expense as active — badge clears, Edit/Delete reappear', () => {
    const deleted = makeDeletedExpense();
    const { rerender } = renderDialog(deleted);

    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    expect(screen.getByText('Deleted')).toBeInTheDocument();

    // Simulate the post-restore refetch (driven in production by
    // `useRestoreExpense`'s `invalidateForExpenseChange` call) landing a
    // fresh, now-active DTO in `useExpense`'s cache.
    const active: ExpenseDto = { ...deleted, deletedAt: null };
    (useExpense as unknown as Mock).mockReturnValue({
      data: active,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    rerender(<ExpenseDetailDialog expenseId={active.id} open onOpenChange={() => {}} />);

    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
    expect(screen.queryByText('Deleted')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });
});
