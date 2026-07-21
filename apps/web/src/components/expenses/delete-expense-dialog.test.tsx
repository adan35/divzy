import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { formatMoney, type ExpenseDto, type PublicUserDto } from '@divzy/shared';
import { useDeleteExpense, useExpense } from '@/lib/hooks';
import { DeleteExpenseDialog } from './delete-expense-dialog';

vi.mock('@/lib/hooks', () => ({
  errorMessage: (error: unknown) => String(error),
  useExpense: vi.fn(),
  useDeleteExpense: vi.fn(),
}));

const mePublic: PublicUserDto = { id: 'me', name: 'Me', avatarColor: '#111111' };

function money(minor: number, currency: string): string {
  return formatMoney(minor, currency).replace(/\s+/g, ' ');
}

function makeExpense(overrides: Partial<ExpenseDto> = {}): ExpenseDto {
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
    payers: [{ user: mePublic, amount: 1600 }],
    splits: [{ user: mePublic, amount: 1600, shares: null, percentBps: null, adjustment: null }],
    items: [],
    createdBy: mePublic,
    updatedBy: null,
    commentCount: 0,
    deletedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('DeleteExpenseDialog (WI-039, host-agnostic delete unit)', () => {
  let mutate: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mutate = vi.fn();
    (useDeleteExpense as unknown as Mock).mockReturnValue({ mutate, isPending: false });
    (useExpense as unknown as Mock).mockReturnValue({ data: undefined, isLoading: false });
  });

  it('scenario: confirm deletes via the existing delete path and fires the host-supplied onDeleted', () => {
    const expense = makeExpense();
    const onDeleted = vi.fn();
    mutate.mockImplementation((_vars, opts) => opts?.onSuccess?.());

    render(
      <DeleteExpenseDialog
        expenseId={expense.id}
        expense={expense}
        open
        onOpenChange={() => {}}
        onDeleted={onDeleted}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete expense' }));

    expect(mutate).toHaveBeenCalledWith(
      { expenseId: expense.id, groupId: expense.groupId },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(onDeleted).toHaveBeenCalledWith(expense);
  });

  it('scenario: canceling does not delete anything and returns control to the host', () => {
    const expense = makeExpense();
    const onOpenChange = vi.fn();

    render(
      <DeleteExpenseDialog
        expenseId={expense.id}
        expense={expense}
        open
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mutate).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('scenario: expense omitted — fetches internally via useExpense and renders the correct confirmation copy once loaded', () => {
    const expense = makeExpense({ description: 'Groceries', amount: 2500, currency: 'USD' });
    (useExpense as unknown as Mock).mockReturnValue({ data: expense, isLoading: false });

    render(
      <DeleteExpenseDialog expenseId={expense.id} open onOpenChange={() => {}} />,
    );

    expect(useExpense).toHaveBeenCalledWith(expense.id, true);
    expect(
      screen.getByText(`“Groceries” (${money(2500, 'USD')}) will be removed for everyone. This can't be undone.`),
    ).toBeInTheDocument();
  });

  it('scenario: expense not yet loaded — renders the generic fallback copy, not a crash', () => {
    (useExpense as unknown as Mock).mockReturnValue({ data: undefined, isLoading: true });

    render(<DeleteExpenseDialog expenseId="exp-1" open onOpenChange={() => {}} />);

    expect(
      screen.getByText('This expense will be removed for everyone.'),
    ).toBeInTheDocument();
  });

  it('scenario: mid-delete — cannot be dismissed and the delete button shows a pending state', () => {
    const expense = makeExpense();
    (useDeleteExpense as unknown as Mock).mockReturnValue({ mutate, isPending: true });

    render(
      <DeleteExpenseDialog expenseId={expense.id} expense={expense} open onOpenChange={() => {}} />,
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('scenario: already-loaded expense supplied — does not fetch (dedupes / avoids a redundant request)', () => {
    const expense = makeExpense();

    render(
      <DeleteExpenseDialog expenseId={expense.id} expense={expense} open onOpenChange={() => {}} />,
    );

    expect(useExpense).toHaveBeenCalledWith(expense.id, false);
  });
});
