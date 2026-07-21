/**
 * WI-039b / WI-054b — host-agnostic settlement delete + restore actions
 * (mobile slice, spec-WI-054b §4.2). `createSettlementActions` is the pure
 * confirm/delete/restore wiring, mirroring `createExpenseActions`
 * (spec-WI-039 §3): it has no React/React Native/Expo dependency of its own
 * — every side-effecting concern (the mutations, the confirmation alert,
 * the success/error alerts) is injected by the caller — so it's
 * unit-testable without a component-test harness (project constraint: no
 * jest-expo/RTL in apps/mobile). `useSettlementActions`
 * (src/hooks/useSettlementActions.ts) is the thin React hook that supplies
 * the real implementations, including computing `canDelete`/`canRestore`
 * via `canDeleteSettlement`/`canRestoreSettlement` (src/lib/settlements.ts).
 *
 * The client-side gates (`canDelete`/`canRestore`) are UX convenience only
 * — the DELETE/RESTORE endpoints' additive group-admin authz
 * (settlements.ts, spec §2.1) is the actual enforcement boundary regardless
 * of what this hides (spec-WI-054b §4.2, "the server still 403s a direct
 * call — client gate is UX only").
 *
 * Neither a successful delete nor a successful restore navigates away: the
 * dialog/modal stays open and re-renders into the new state once the
 * settlement query refetches (spec §4.2 "on restore success the modal must
 * stay open") — so there is no `onDeleted`/navigate callback here at all.
 *
 * Restore, unlike delete, fires with NO confirmation alert (single tap) —
 * spec-WI-054b §4.2.
 */

export interface SettlementDeleteConfirmConfig {
  title: string;
  message: string;
  onConfirm: () => void;
}

export interface SettlementActionsDeps {
  /** The already-loaded settlement (or undefined while it's still fetching). */
  settlement: { id: string; groupId: string | null } | undefined;
  /** Client-side delete gate (canDeleteSettlement's result) — UX only. */
  canDelete: boolean;
  isDeleting: boolean;
  deleteSettlement: (
    variables: { settlementId: string; groupId?: string | null },
    options: { onSuccess: () => void; onError: (err: unknown) => void },
  ) => void;
  notifyDeleteSuccess: () => void;
  showDeleteConfirm: (config: SettlementDeleteConfirmConfig) => void;
  showDeleteError: (err: unknown) => void;
  /** Client-side restore gate (canRestoreSettlement's result) — UX only. */
  canRestore: boolean;
  isRestoring: boolean;
  restoreSettlement: (
    variables: { settlementId: string; groupId?: string | null },
    options: { onSuccess: () => void; onError: (err: unknown) => void },
  ) => void;
  notifyRestoreSuccess: () => void;
  showRestoreError: (err: unknown) => void;
}

export interface SettlementActionsResult {
  confirmDelete: () => void;
  isDeleting: boolean;
  restore: () => void;
  isRestoring: boolean;
}

export function createSettlementActions(deps: SettlementActionsDeps): SettlementActionsResult {
  const confirmDelete = () => {
    const settlement = deps.settlement;
    if (!settlement || !deps.canDelete) return;
    deps.showDeleteConfirm({
      title: 'Delete settlement?',
      message: "This settlement will be removed for everyone. This can't be undone.",
      onConfirm: () =>
        deps.deleteSettlement(
          { settlementId: settlement.id, groupId: settlement.groupId },
          {
            onSuccess: () => deps.notifyDeleteSuccess(),
            onError: (err) => deps.showDeleteError(err),
          },
        ),
    });
  };

  const restore = () => {
    const settlement = deps.settlement;
    if (!settlement || !deps.canRestore) return;
    deps.restoreSettlement(
      { settlementId: settlement.id, groupId: settlement.groupId },
      {
        onSuccess: () => deps.notifyRestoreSuccess(),
        onError: (err) => deps.showRestoreError(err),
      },
    );
  };

  return {
    confirmDelete,
    isDeleting: deps.isDeleting,
    restore,
    isRestoring: deps.isRestoring,
  };
}
