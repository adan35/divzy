import type { ExpenseDto } from '@divzy/shared';

/**
 * WI-039 — host-agnostic expense edit/delete actions (mobile slice, spec-WI-039 §3).
 *
 * `createExpenseActions` is the pure wiring lifted verbatim from
 * `app/expense/[id].tsx`'s inline edit/delete logic. It has no React/React
 * Native/Expo dependency of its own — every side-effecting concern (fetching
 * the expense, mutating, navigating, showing the confirm/error alert, and
 * haptics) is injected by the caller — so it's unit-testable without a
 * component-test harness (project constraint: no jest-expo/RTL in
 * apps/mobile). `useExpenseActions` (src/hooks/useExpenseActions.ts) is the
 * thin React hook that supplies the real implementations.
 */

export interface ExpenseActionsCallbacks {
  /** Runs after a successful delete — replaces today's hardcoded router.back() (D2). */
  onDeleted: () => void;
  /** Optional override; default preserves today's /expense/new?expenseId= route. */
  onEditNavigate?: () => void;
  /**
   * WI-054b — optional; runs after a successful restore. Unlike `onDeleted`,
   * there is no default navigation: the now-active expense stays on screen
   * (spec-WI-054b §4.4 — do not `router.back()`).
   */
  onRestored?: () => void;
}

export interface ExpenseActionsResult {
  editExpense: () => void;
  confirmDelete: () => void;
  isDeleting: boolean;
  /** WI-054b — undo a soft delete. No confirmation step (safe, reversible). */
  restoreExpense: () => void;
  isRestoring: boolean;
}

export interface DeleteConfirmConfig {
  title: string;
  message: string;
  onConfirm: () => void;
}

export interface ExpenseActionsDeps {
  /** The already-loaded expense (or undefined while it's still fetching). */
  expense: ExpenseDto | undefined;
  isDeleting: boolean;
  deleteExpense: (
    variables: { expenseId: string; groupId?: string | null },
    options: { onSuccess: () => void; onError: (err: unknown) => void },
  ) => void;
  navigateToEdit: () => void;
  notifyDeleteSuccess: () => void;
  showDeleteConfirm: (config: DeleteConfirmConfig) => void;
  showDeleteError: (err: unknown) => void;
  callbacks: ExpenseActionsCallbacks;
  /** WI-054b */
  isRestoring: boolean;
  restoreExpense: (
    variables: { expenseId: string; groupId?: string | null },
    options: { onSuccess: () => void; onError: (err: unknown) => void },
  ) => void;
  notifyRestoreSuccess: () => void;
  showRestoreError: (err: unknown) => void;
}

export function createExpenseActions(deps: ExpenseActionsDeps): ExpenseActionsResult {
  const editExpense = () => {
    if (deps.callbacks.onEditNavigate) {
      deps.callbacks.onEditNavigate();
    } else {
      deps.navigateToEdit();
    }
  };

  const confirmDelete = () => {
    const expense = deps.expense;
    if (!expense) return;
    deps.showDeleteConfirm({
      title: 'Delete expense?',
      message: `“${expense.description}” will be removed from everyone's balances.`,
      onConfirm: () =>
        deps.deleteExpense(
          { expenseId: expense.id, groupId: expense.groupId },
          {
            onSuccess: () => {
              deps.notifyDeleteSuccess();
              deps.callbacks.onDeleted();
            },
            onError: (err) => deps.showDeleteError(err),
          },
        ),
    });
  };

  // WI-054b — restore is authorized identically to delete (visibility-only,
  // no creator/admin gate), so no confirmation dialog is needed: it's a
  // safe, reversible undo, unlike delete.
  const restoreExpense = () => {
    const expense = deps.expense;
    if (!expense) return;
    deps.restoreExpense(
      { expenseId: expense.id, groupId: expense.groupId },
      {
        onSuccess: () => {
          deps.notifyRestoreSuccess();
          deps.callbacks.onRestored?.();
        },
        onError: (err) => deps.showRestoreError(err),
      },
    );
  };

  return {
    editExpense,
    confirmDelete,
    isDeleting: deps.isDeleting,
    restoreExpense,
    isRestoring: deps.isRestoring,
  };
}
