import { describe, expect, it, vi } from 'vitest';
import type { ExpenseDto } from '@divzy/shared';
import { createExpenseActions } from './expenseActions';

// WI-039 — host-agnostic expense edit/delete actions (mobile slice).
// `createExpenseActions` is the pure wiring extracted from
// `app/expense/[id].tsx`'s inline edit/delete logic (spec-WI-039 §3) so it's
// unit-testable without a React Native component-test harness: every
// side-effecting dependency (fetch result, mutate, navigate, alert, haptics)
// is injected.

function makeExpense(overrides: Partial<ExpenseDto> = {}): ExpenseDto {
  return {
    id: 'exp-1',
    groupId: 'group-1',
    group: { id: 'group-1', name: 'Roommates', emoji: '🏠', currency: 'USD' },
    description: 'Dinner',
    amount: 4200,
    currency: 'USD',
    category: 'FOOD',
    date: '2026-07-01',
    splitType: 'EQUAL',
    notes: null,
    receiptUrl: null,
    payers: [],
    splits: [],
    items: [],
    createdBy: { id: 'u1', name: 'Alice', avatarColor: '#000' },
    updatedBy: null,
    commentCount: 0,
    deletedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  } as ExpenseDto;
}

interface MakeDepsOverrides {
  expense?: ExpenseDto | undefined;
  isDeleting?: boolean;
  isRestoring?: boolean;
  callbacks?: {
    onDeleted: ReturnType<typeof vi.fn>;
    onEditNavigate?: ReturnType<typeof vi.fn>;
    onRestored?: ReturnType<typeof vi.fn>;
  };
}

function makeDeps(overrides: MakeDepsOverrides = {}) {
  return {
    expense: makeExpense(),
    isDeleting: false,
    deleteExpense: vi.fn(),
    navigateToEdit: vi.fn(),
    notifyDeleteSuccess: vi.fn(),
    showDeleteConfirm: vi.fn(),
    showDeleteError: vi.fn(),
    callbacks: { onDeleted: vi.fn() },
    // WI-054b
    isRestoring: false,
    restoreExpense: vi.fn(),
    notifyRestoreSuccess: vi.fn(),
    showRestoreError: vi.fn(),
    ...overrides,
  };
}

describe('createExpenseActions (WI-039)', () => {
  describe('editExpense', () => {
    it('navigates via the default route when no onEditNavigate override is supplied', () => {
      const deps = makeDeps();
      const actions = createExpenseActions(deps);
      actions.editExpense();
      expect(deps.navigateToEdit).toHaveBeenCalledTimes(1);
    });

    it('defers to callbacks.onEditNavigate when supplied, instead of the default route', () => {
      const onEditNavigate = vi.fn();
      const deps = makeDeps({ callbacks: { onDeleted: vi.fn(), onEditNavigate } });
      const actions = createExpenseActions(deps);
      actions.editExpense();
      expect(onEditNavigate).toHaveBeenCalledTimes(1);
      expect(deps.navigateToEdit).not.toHaveBeenCalled();
    });
  });

  describe('confirmDelete', () => {
    it('does nothing when the expense has not loaded yet', () => {
      const deps = makeDeps({ expense: undefined });
      const actions = createExpenseActions(deps);
      actions.confirmDelete();
      expect(deps.showDeleteConfirm).not.toHaveBeenCalled();
    });

    it('shows the confirmation with the expense description in the copy, verbatim', () => {
      const deps = makeDeps({ expense: makeExpense({ description: 'Groceries' }) });
      const actions = createExpenseActions(deps);
      actions.confirmDelete();
      expect(deps.showDeleteConfirm).toHaveBeenCalledTimes(1);
      const config = deps.showDeleteConfirm.mock.calls[0][0];
      expect(config.title).toBe('Delete expense?');
      expect(config.message).toBe("“Groceries” will be removed from everyone's balances.");
    });

    it('deletes with the expense id + groupId, and fires onDeleted + haptics on success', () => {
      const onDeleted = vi.fn();
      const deps = makeDeps({
        expense: makeExpense({ id: 'exp-42', groupId: 'group-9' }),
        callbacks: { onDeleted },
      });
      const actions = createExpenseActions(deps);
      actions.confirmDelete();
      const { onConfirm } = deps.showDeleteConfirm.mock.calls[0][0];
      onConfirm();

      expect(deps.deleteExpense).toHaveBeenCalledTimes(1);
      const [variables, options] = deps.deleteExpense.mock.calls[0];
      expect(variables).toEqual({ expenseId: 'exp-42', groupId: 'group-9' });

      expect(onDeleted).not.toHaveBeenCalled();
      options.onSuccess();
      expect(deps.notifyDeleteSuccess).toHaveBeenCalledTimes(1);
      expect(onDeleted).toHaveBeenCalledTimes(1);
    });

    it('surfaces a delete error to the host instead of swallowing it', () => {
      const deps = makeDeps();
      const actions = createExpenseActions(deps);
      actions.confirmDelete();
      const { onConfirm } = deps.showDeleteConfirm.mock.calls[0][0];
      onConfirm();
      const [, options] = deps.deleteExpense.mock.calls[0];
      const err = new Error('network down');
      options.onError(err);
      expect(deps.showDeleteError).toHaveBeenCalledWith(err);
    });

    it('canceling (never invoking onConfirm) deletes nothing', () => {
      const deps = makeDeps();
      const actions = createExpenseActions(deps);
      actions.confirmDelete();
      expect(deps.deleteExpense).not.toHaveBeenCalled();
    });
  });

  describe('isDeleting', () => {
    it('reflects the injected pending state', () => {
      expect(createExpenseActions(makeDeps({ isDeleting: true })).isDeleting).toBe(true);
      expect(createExpenseActions(makeDeps({ isDeleting: false })).isDeleting).toBe(false);
    });
  });

  // WI-054b — restore (undelete). No confirmation step (safe, reversible
  // undo, per spec-WI-054b §4.4), unlike confirmDelete.
  describe('restoreExpense', () => {
    it('does nothing when the expense has not loaded yet', () => {
      const deps = makeDeps({ expense: undefined });
      const actions = createExpenseActions(deps);
      actions.restoreExpense();
      expect(deps.restoreExpense).not.toHaveBeenCalled();
    });

    it('calls restore directly with the expense id + groupId, no confirmation dialog', () => {
      const deps = makeDeps({ expense: makeExpense({ id: 'exp-7', groupId: 'group-3' }) });
      const actions = createExpenseActions(deps);
      actions.restoreExpense();

      expect(deps.restoreExpense).toHaveBeenCalledTimes(1);
      const [variables] = deps.restoreExpense.mock.calls[0];
      expect(variables).toEqual({ expenseId: 'exp-7', groupId: 'group-3' });
    });

    it('fires onRestored + a success notification on success, without navigating away', () => {
      const onRestored = vi.fn();
      const deps = makeDeps({ callbacks: { onDeleted: vi.fn(), onRestored } });
      const actions = createExpenseActions(deps);
      actions.restoreExpense();

      const [, options] = deps.restoreExpense.mock.calls[0];
      expect(onRestored).not.toHaveBeenCalled();
      options.onSuccess();
      expect(deps.notifyRestoreSuccess).toHaveBeenCalledTimes(1);
      expect(onRestored).toHaveBeenCalledTimes(1);
    });

    it('does not throw when callbacks.onRestored is not supplied', () => {
      const deps = makeDeps();
      const actions = createExpenseActions(deps);
      actions.restoreExpense();
      const [, options] = deps.restoreExpense.mock.calls[0];
      expect(() => options.onSuccess()).not.toThrow();
    });

    it('surfaces a restore error to the host instead of swallowing it', () => {
      const deps = makeDeps();
      const actions = createExpenseActions(deps);
      actions.restoreExpense();
      const [, options] = deps.restoreExpense.mock.calls[0];
      const err = new Error('network down');
      options.onError(err);
      expect(deps.showRestoreError).toHaveBeenCalledWith(err);
    });
  });

  describe('isRestoring', () => {
    it('reflects the injected pending state', () => {
      expect(createExpenseActions(makeDeps({ isRestoring: true })).isRestoring).toBe(true);
      expect(createExpenseActions(makeDeps({ isRestoring: false })).isRestoring).toBe(false);
    });
  });
});
