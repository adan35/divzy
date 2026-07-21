import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { SettlementDto } from '@divzy/shared';
import { createSettlementActions } from '@/lib/settlementActions';
import { canDeleteSettlement, canRestoreSettlement } from '@/lib/settlements';
import {
  errorMessage,
  useDeleteSettlement,
  useGroup,
  useRestoreSettlement,
  useSettlement,
} from '@/lib/hooks';
import { useAuth } from '@/lib/auth';

export interface UseSettlementActionsResult {
  settlement: SettlementDto | undefined;
  isLoading: boolean;
  isError: boolean;
  isRefetching: boolean;
  error: unknown;
  refetch: () => void;
  /** Client-side delete gate (spec-WI-054b §4.2) — UX convenience only. */
  canDelete: boolean;
  isDeleting: boolean;
  confirmDelete: () => void;
  /** Client-side restore gate (spec-WI-054b §4.2) — UX convenience only. */
  canRestore: boolean;
  isRestoring: boolean;
  restore: () => void;
}

/**
 * WI-039b / WI-054b — self-sufficient settlement detail + delete/restore
 * actions, mirroring `useExpenseActions`'s "given just an id, fetch/mutate/
 * gate internally" design (spec-WI-039 §3 D1): any screen can mount this
 * with only a `settlementId`. React Query dedupes the `useSettlement`/
 * `useGroup` reads against whatever the host screen already ran.
 *
 * Group-admin gating mirrors `group/[id].tsx`'s existing derivation
 * (`group.members.find(m => m.user.id === meId)?.role === 'ADMIN'`) rather
 * than inventing a new pattern (spec-WI-039b §4).
 *
 * Restore fires immediately, with no confirmation alert (spec-WI-054b §4.2 —
 * unlike delete, which is still gated behind a confirm Alert) and never
 * navigates away — the same success haptic fires, and the caller's own
 * `useSettlement` refetches into the active state via `useRestoreSettlement`'s
 * invalidation.
 */
export function useSettlementActions(settlementId: string): UseSettlementActionsResult {
  const { user: me } = useAuth();
  const settlementQuery = useSettlement(settlementId, settlementId.length > 0);
  const settlement = settlementQuery.data;

  const groupId = settlement?.groupId ?? '';
  const groupQuery = useGroup(groupId, groupId.length > 0);
  const isGroupAdmin =
    !!me && groupQuery.data?.members.find((m) => m.user.id === me.id)?.role === 'ADMIN';

  const canDelete = settlement ? canDeleteSettlement(settlement, me?.id ?? '', isGroupAdmin) : false;
  const canRestore = settlement
    ? canRestoreSettlement(settlement, me?.id ?? '', isGroupAdmin)
    : false;

  const deleteSettlement = useDeleteSettlement();
  const restoreSettlement = useRestoreSettlement();

  const { confirmDelete, isDeleting, restore, isRestoring } = createSettlementActions({
    settlement,
    canDelete,
    isDeleting: deleteSettlement.isPending,
    deleteSettlement: (variables, options) => deleteSettlement.mutate(variables, options),
    notifyDeleteSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    },
    showDeleteConfirm: ({ title, message, onConfirm }) =>
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: onConfirm },
      ]),
    showDeleteError: (err) => Alert.alert('Could not delete', errorMessage(err)),
    canRestore,
    isRestoring: restoreSettlement.isPending,
    restoreSettlement: (variables, options) => restoreSettlement.mutate(variables, options),
    notifyRestoreSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    },
    showRestoreError: (err) => Alert.alert('Could not restore', errorMessage(err)),
  });

  return {
    settlement,
    isLoading: settlementQuery.isLoading,
    isError: settlementQuery.isError,
    isRefetching: settlementQuery.isRefetching,
    error: settlementQuery.error,
    refetch: () => void settlementQuery.refetch(),
    canDelete,
    isDeleting,
    confirmDelete,
    canRestore,
    isRestoring,
    restore,
  };
}
