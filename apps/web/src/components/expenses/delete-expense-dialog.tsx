'use client';

import { formatMoney, type ExpenseDto } from '@divzy/shared';
import { useDeleteExpense, useExpense } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface DeleteExpenseDialogProps {
  expenseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs after a successful delete — the host closes/navigates/toasts as it wants (D2/D3). */
  onDeleted?: (expense: ExpenseDto) => void;
  /** Optional already-loaded DTO; when omitted the dialog fetches it itself (D1). */
  expense?: ExpenseDto;
}

/**
 * Host-agnostic delete-confirmation unit (WI-039), extracted verbatim from
 * `ExpenseDetailDialog`'s former inline delete logic. Self-sufficient: given
 * only an `expenseId` it fetches the expense itself (deduped against any
 * query the host already ran); an already-loaded `expense` skips that fetch.
 * Success/navigation/toast behavior is entirely the caller's responsibility
 * via `onDeleted` — this component owns no default toast (D3).
 */
export function DeleteExpenseDialog({
  expenseId,
  open,
  onOpenChange,
  onDeleted,
  expense,
}: DeleteExpenseDialogProps) {
  const fetched = useExpense(expenseId, open && !expense);
  const data = expense ?? fetched.data;
  const deleteExpense = useDeleteExpense();

  const confirmDelete = () => {
    if (!data || deleteExpense.isPending) return;
    deleteExpense.mutate(
      { expenseId: data.id, groupId: data.groupId },
      {
        onSuccess: () => onDeleted?.(data),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !deleteExpense.isPending) onOpenChange(false);
      }}
      size="sm"
      ariaLabel="Delete expense"
      dismissible={!deleteExpense.isPending}
    >
      <DialogHeader>
        <DialogTitle>Delete this expense?</DialogTitle>
        <DialogDescription>
          {data
            ? `“${data.description}” (${formatMoney(data.amount, data.currency)}) will be removed for everyone. This can't be undone.`
            : 'This expense will be removed for everyone.'}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={deleteExpense.isPending}>
          Cancel
        </Button>
        <Button variant="danger" loading={deleteExpense.isPending} onClick={confirmDelete}>
          Delete expense
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
