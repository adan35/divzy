import { describe, expect, it, vi } from 'vitest';
import { createSettlementActions } from './settlementActions';

// WI-039b / WI-054b — host-agnostic settlement delete + restore actions
// (mobile slice, spec-WI-054b §4.2). Mirrors `createExpenseActions`
// (spec-WI-039 §3): the pure confirm/delete/restore wiring lifted out of the
// screen so it's unit-testable without a React Native component-test
// harness. Every side-effecting dependency (the mutation, the confirm
// alert, the success/error alert) is injected by the caller;
// `useSettlementActions` (src/hooks/useSettlementActions.ts) supplies the
// real implementations.
//
// Unlike expense delete, a successful delete or restore does NOT navigate
// away (spec §3 "do not close-and-lose so the user sees the result") —
// there is no `onDeleted`/navigate callback here at all; the caller's own
// `useSettlement` query refetches into the new state via the existing
// `invalidateForExpenseChange` wiring.
//
// Restore, unlike delete, fires with NO confirmation alert (spec-WI-054b
// §4.2 "no confirm alert" — single tap).

interface MakeDepsOverrides {
  settlement?: { id: string; groupId: string | null } | undefined;
  canDelete?: boolean;
  isDeleting?: boolean;
  canRestore?: boolean;
  isRestoring?: boolean;
}

function makeDeps(overrides: MakeDepsOverrides = {}) {
  return {
    settlement: { id: 'settle-1', groupId: 'group-1' as string | null },
    canDelete: true,
    isDeleting: false,
    canRestore: false,
    isRestoring: false,
    deleteSettlement: vi.fn(),
    notifyDeleteSuccess: vi.fn(),
    showDeleteConfirm: vi.fn(),
    showDeleteError: vi.fn(),
    restoreSettlement: vi.fn(),
    notifyRestoreSuccess: vi.fn(),
    showRestoreError: vi.fn(),
    ...overrides,
  };
}

describe('createSettlementActions (WI-039b / WI-054b)', () => {
  describe('confirmDelete', () => {
    it('does nothing when the settlement has not loaded yet', () => {
      const deps = makeDeps({ settlement: undefined });
      const actions = createSettlementActions(deps);
      actions.confirmDelete();
      expect(deps.showDeleteConfirm).not.toHaveBeenCalled();
    });

    it('does nothing when the client-side gate says delete is not allowed (defensive — UX gate only)', () => {
      const deps = makeDeps({ canDelete: false });
      const actions = createSettlementActions(deps);
      actions.confirmDelete();
      expect(deps.showDeleteConfirm).not.toHaveBeenCalled();
    });

    it('shows a confirmation before deleting anything', () => {
      const deps = makeDeps();
      const actions = createSettlementActions(deps);
      actions.confirmDelete();
      expect(deps.showDeleteConfirm).toHaveBeenCalledTimes(1);
      expect(deps.deleteSettlement).not.toHaveBeenCalled();
      const config = deps.showDeleteConfirm.mock.calls[0][0];
      expect(config.title).toBe('Delete settlement?');
      expect(config.message).toBe(
        "This settlement will be removed for everyone. This can't be undone.",
      );
    });

    it('canceling (never invoking onConfirm) deletes nothing', () => {
      const deps = makeDeps();
      const actions = createSettlementActions(deps);
      actions.confirmDelete();
      expect(deps.deleteSettlement).not.toHaveBeenCalled();
    });

    it('deletes with the settlement id + groupId, and notifies success, once confirmed', () => {
      const deps = makeDeps({ settlement: { id: 'settle-42', groupId: 'group-9' } });
      const actions = createSettlementActions(deps);
      actions.confirmDelete();
      const { onConfirm } = deps.showDeleteConfirm.mock.calls[0][0];
      onConfirm();

      expect(deps.deleteSettlement).toHaveBeenCalledTimes(1);
      const [variables, options] = deps.deleteSettlement.mock.calls[0];
      expect(variables).toEqual({ settlementId: 'settle-42', groupId: 'group-9' });

      expect(deps.notifyDeleteSuccess).not.toHaveBeenCalled();
      options.onSuccess();
      expect(deps.notifyDeleteSuccess).toHaveBeenCalledTimes(1);
    });

    it('works for a direct settlement (groupId null) the same way', () => {
      const deps = makeDeps({ settlement: { id: 'settle-1', groupId: null } });
      const actions = createSettlementActions(deps);
      actions.confirmDelete();
      const { onConfirm } = deps.showDeleteConfirm.mock.calls[0][0];
      onConfirm();
      const [variables] = deps.deleteSettlement.mock.calls[0];
      expect(variables).toEqual({ settlementId: 'settle-1', groupId: null });
    });

    it('surfaces a delete error to the host instead of swallowing it', () => {
      const deps = makeDeps();
      const actions = createSettlementActions(deps);
      actions.confirmDelete();
      const { onConfirm } = deps.showDeleteConfirm.mock.calls[0][0];
      onConfirm();
      const [, options] = deps.deleteSettlement.mock.calls[0];
      const err = new Error('network down');
      options.onError(err);
      expect(deps.showDeleteError).toHaveBeenCalledWith(err);
      expect(deps.notifyDeleteSuccess).not.toHaveBeenCalled();
    });
  });

  describe('isDeleting', () => {
    it('reflects the injected pending state', () => {
      expect(createSettlementActions(makeDeps({ isDeleting: true })).isDeleting).toBe(true);
      expect(createSettlementActions(makeDeps({ isDeleting: false })).isDeleting).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // WI-054b — restore path: single tap, NO confirmation alert.
  // ---------------------------------------------------------------------
  describe('restore', () => {
    it('does nothing when the settlement has not loaded yet', () => {
      const deps = makeDeps({ settlement: undefined, canRestore: true });
      const actions = createSettlementActions(deps);
      actions.restore();
      expect(deps.restoreSettlement).not.toHaveBeenCalled();
    });

    it('does nothing when the client-side gate says restore is not allowed (defensive — UX gate only)', () => {
      const deps = makeDeps({ canRestore: false });
      const actions = createSettlementActions(deps);
      actions.restore();
      expect(deps.restoreSettlement).not.toHaveBeenCalled();
    });

    it('calls restoreSettlement immediately, with no confirmation step', () => {
      const deps = makeDeps({
        settlement: { id: 'settle-42', groupId: 'group-9' },
        canRestore: true,
      });
      const actions = createSettlementActions(deps);
      actions.restore();

      expect(deps.showDeleteConfirm).not.toHaveBeenCalled();
      expect(deps.restoreSettlement).toHaveBeenCalledTimes(1);
      const [variables] = deps.restoreSettlement.mock.calls[0];
      expect(variables).toEqual({ settlementId: 'settle-42', groupId: 'group-9' });
    });

    it('works for a direct settlement (groupId null) the same way', () => {
      const deps = makeDeps({ settlement: { id: 'settle-1', groupId: null }, canRestore: true });
      const actions = createSettlementActions(deps);
      actions.restore();
      const [variables] = deps.restoreSettlement.mock.calls[0];
      expect(variables).toEqual({ settlementId: 'settle-1', groupId: null });
    });

    it('notifies success once the restore mutation resolves', () => {
      const deps = makeDeps({ canRestore: true });
      const actions = createSettlementActions(deps);
      actions.restore();
      const [, options] = deps.restoreSettlement.mock.calls[0];
      expect(deps.notifyRestoreSuccess).not.toHaveBeenCalled();
      options.onSuccess();
      expect(deps.notifyRestoreSuccess).toHaveBeenCalledTimes(1);
    });

    it('surfaces a restore error to the host instead of swallowing it', () => {
      const deps = makeDeps({ canRestore: true });
      const actions = createSettlementActions(deps);
      actions.restore();
      const [, options] = deps.restoreSettlement.mock.calls[0];
      const err = new Error('network down');
      options.onError(err);
      expect(deps.showRestoreError).toHaveBeenCalledWith(err);
      expect(deps.notifyRestoreSuccess).not.toHaveBeenCalled();
    });
  });

  describe('isRestoring', () => {
    it('reflects the injected pending state', () => {
      expect(createSettlementActions(makeDeps({ isRestoring: true })).isRestoring).toBe(true);
      expect(createSettlementActions(makeDeps({ isRestoring: false })).isRestoring).toBe(false);
    });
  });
});
