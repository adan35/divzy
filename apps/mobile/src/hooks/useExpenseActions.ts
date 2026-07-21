import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  createExpenseActions,
  type ExpenseActionsCallbacks,
  type ExpenseActionsResult,
} from '@/lib/expenseActions';
import { errorMessage, useDeleteExpense, useExpense, useRestoreExpense } from '@/lib/hooks';

export type { ExpenseActionsCallbacks, ExpenseActionsResult } from '@/lib/expenseActions';

/**
 * WI-039 — host-agnostic expense edit/delete actions (spec-WI-039 §3).
 *
 * Self-sufficient: given just an `expenseId`, fetches/mutates internally via
 * `useExpense`/`useDeleteExpense` (React Query dedupes against any query the
 * host screen already ran — D1), so any screen can mount this with only an
 * id. Success/navigation behavior is caller-supplied via `callbacks` (D2);
 * confirmation copy and error surfacing are carried over verbatim from
 * `app/expense/[id].tsx`'s previous inline implementation (D4). No
 * server-side behavior changes (D5).
 */
export function useExpenseActions(
  expenseId: string,
  callbacks: ExpenseActionsCallbacks,
): ExpenseActionsResult {
  const router = useRouter();
  const expenseQuery = useExpense(expenseId, expenseId.length > 0);
  const deleteExpense = useDeleteExpense();
  const restoreExpense = useRestoreExpense();

  return createExpenseActions({
    expense: expenseQuery.data,
    isDeleting: deleteExpense.isPending,
    deleteExpense: (variables, options) => deleteExpense.mutate(variables, options),
    navigateToEdit: () => router.push({ pathname: '/expense/new', params: { expenseId } }),
    notifyDeleteSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    },
    showDeleteConfirm: ({ title, message, onConfirm }) =>
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: onConfirm },
      ]),
    showDeleteError: (err) => Alert.alert('Could not delete', errorMessage(err)),
    // WI-054b — restore
    isRestoring: restoreExpense.isPending,
    restoreExpense: (variables, options) => restoreExpense.mutate(variables, options),
    notifyRestoreSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    },
    showRestoreError: (err) => Alert.alert('Could not restore', errorMessage(err)),
    callbacks,
  });
}
