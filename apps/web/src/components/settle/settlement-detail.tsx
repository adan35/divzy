'use client';

import { useState } from 'react';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import {
  formatMoney,
  SETTLEMENT_METHODS,
  type SettlementMethod,
} from '@divzy/shared';
import { apiUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import {
  errorMessage,
  useDeleteSettlement,
  useGroup,
  useRestoreSettlement,
  useSettlement,
} from '@/lib/hooks';
import { formatDateFull } from '@/lib/format';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MoneyText } from '@/components/ui/money-text';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/groups/confirm-dialog';

export interface SettlementDetailDialogProps {
  settlementId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  // WI-068 §2 type scale: section labels are 12px/600/uppercase/+0.06em, ink-3.
  return (
    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-ink-3">{children}</p>
  );
}

function methodLabel(method: SettlementMethod): string {
  return SETTLEMENT_METHODS.find((m) => m.key === method)?.label ?? 'Other';
}

// Same PDF-vs-image heuristic as expense-detail.tsx's receipt block and
// settlements-section.tsx's proof link — the settlement proof reuses the
// exact same upload endpoint/storage.
function isPdfUrl(url: string): boolean {
  return /\.pdf(\?.*)?$/i.test(url);
}

/**
 * Full settlement detail: amount hero, who-paid-whom, date, method, group
 * (when group-scoped), note, proof attachment, and client-side-gated
 * Delete / Restore actions (WI-039b, renamed + Restore added in WI-054b).
 * Mirrors `ExpenseDetailDialog`'s pattern (loading skeleton / error+retry /
 * data branches).
 *
 * Soft-delete contract (DRB condition 2 — the exact WI-036/039 defect this
 * endpoint/dialog must not repeat): `GET /settlements/:id` never 404s a
 * deleted settlement, so `deletedAt` is rendered as a normal data field
 * (a "Deleted" badge), never routed through the error/retry branch.
 *
 * Naming invariant (spec-WI-054b §4.3): for any single settlement state,
 * exactly one of {Delete, Restore} is offered to an authorized viewer,
 * never both, and the word "Revert"/"Reverted" appears nowhere here.
 */
export function SettlementDetailDialog({
  settlementId,
  open,
  onOpenChange,
}: SettlementDetailDialogProps) {
  const { user: me } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const settlementQuery = useSettlement(settlementId, open);
  const settlement = settlementQuery.data;

  const groupQuery = useGroup(settlement?.groupId ?? '', open && !!settlement?.groupId);
  const group = groupQuery.data;

  const deleteSettlement = useDeleteSettlement();
  const restoreSettlement = useRestoreSettlement();

  const isParty =
    !!settlement &&
    !!me &&
    (settlement.from.id === me.id ||
      settlement.to.id === me.id ||
      settlement.createdBy.id === me.id);

  // isAdmin is only ever meaningful for a group settlement — `group` is only
  // fetched (and thus only populated) when `settlement.groupId` is set.
  const isAdmin =
    !!settlement?.groupId &&
    !!group &&
    !!me &&
    group.members.some((m) => m.user.id === me.id && m.role === 'ADMIN');

  const canDelete = !!settlement && !settlement.deletedAt && (isParty || isAdmin);
  const canRestore = !!settlement?.deletedAt && (isParty || isAdmin);

  const fromLabel = settlement && me && settlement.from.id === me.id ? 'You' : settlement?.from.name;
  const toLabel = settlement && me && settlement.to.id === me.id ? 'you' : settlement?.to.name;

  const proofIsPdf = !!settlement?.proofUrl && isPdfUrl(settlement.proofUrl);

  const confirmDelete = () => {
    if (!settlement || deleteSettlement.isPending) return;
    deleteSettlement.mutate(
      { settlementId: settlement.id, groupId: settlement.groupId },
      {
        onSuccess: () => {
          setConfirming(false);
          toast.success('Settlement deleted — balances updated');
        },
      },
    );
  };

  // WI-054b: symmetric Restore — single click, no ConfirmDialog (restore is
  // low-risk/reversible, unlike delete). The dialog must stay open and
  // re-render into the active state via `useRestoreSettlement`'s
  // `queryKeys.settlement(id)` invalidation — never close or navigate away.
  const handleRestore = () => {
    if (!settlement || restoreSettlement.isPending) return;
    restoreSettlement.mutate(
      { settlementId: settlement.id, groupId: settlement.groupId },
      {
        onSuccess: () => {
          toast.success('Settlement restored — balances updated');
        },
      },
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} size="md" ariaLabel="Settlement details">
        {settlementQuery.isLoading ? (
          <>
            <DialogHeader>
              <Skeleton className="h-6 w-2/5" />
              <Skeleton className="h-4 w-1/4" />
            </DialogHeader>
            <DialogBody className="space-y-4 pb-6" aria-hidden="true">
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-16 w-full" />
            </DialogBody>
          </>
        ) : settlementQuery.isError || !settlement ? (
          <>
            <DialogHeader>
              <DialogTitle>Settlement</DialogTitle>
            </DialogHeader>
            <DialogBody className="pb-4">
              <p
                className="rounded-xl border border-hairline bg-neg-soft px-4 py-3 text-sm text-neg"
                role="alert"
              >
                {settlementQuery.error
                  ? errorMessage(settlementQuery.error)
                  : 'This settlement could not be loaded.'}
              </p>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => void settlementQuery.refetch()}>
                Try again
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Payment</DialogTitle>
              <DialogDescription className="text-ink-3">
                {methodLabel(settlement.method)} · {formatDateFull(settlement.date)}
                {settlement.group && (
                  <>
                    {' '}
                    · {settlement.group.emoji} {settlement.group.name}
                  </>
                )}
              </DialogDescription>
            </DialogHeader>

            <DialogBody className="space-y-5 pb-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <MoneyText
                  amount={settlement.amount}
                  currency={settlement.currency}
                  className="text-3xl font-semibold tracking-tight"
                />
                {settlement.deletedAt && <Badge variant="neg">Deleted</Badge>}
              </div>

              <div className="flex items-center gap-2.5">
                <Avatar user={settlement.from} size="sm" />
                <span className="text-sm text-ink">
                  <span className="font-medium">{fromLabel}</span> paid{' '}
                  <span className="font-medium">{toLabel}</span>
                </span>
                <Avatar user={settlement.to} size="sm" />
              </div>

              {settlement.note && (
                <div>
                  <SectionLabel>Note</SectionLabel>
                  <p className="whitespace-pre-wrap text-sm text-ink-2">{settlement.note}</p>
                </div>
              )}

              {settlement.proofUrl && (
                <div>
                  <SectionLabel>Proof</SectionLabel>
                  <a
                    href={apiUrl(settlement.proofUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-3 rounded-xl border border-hairline p-2 pr-3 transition-colors hover:bg-surface-2"
                  >
                    {proofIsPdf ? (
                      <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
                        <FileText className="h-6 w-6" aria-hidden="true" />
                      </span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={apiUrl(settlement.proofUrl)}
                        alt="Payment proof"
                        className="h-14 w-14 rounded-lg border border-hairline object-cover"
                      />
                    )}
                    <span className="text-sm font-medium text-brand">
                      View proof{proofIsPdf ? ' (PDF)' : ''}
                    </span>
                  </a>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
                <p className="text-xs text-ink-3">
                  Recorded by{' '}
                  {settlement.createdBy.id === me?.id ? 'you' : settlement.createdBy.name}
                </p>
                {canDelete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:bg-neg-soft hover:text-danger"
                    onClick={() => setConfirming(true)}
                  >
                    Delete
                  </Button>
                )}
                {canRestore && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRestore}
                    disabled={restoreSettlement.isPending}
                  >
                    Restore
                  </Button>
                )}
              </div>
            </DialogBody>
          </>
        )}
      </Dialog>

      {/* Confirmation step (spec §3) — mirrors ConfirmDialog's existing use
          for settlement delete in settlements-section.tsx. */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={(o) => {
          if (!o && !deleteSettlement.isPending) setConfirming(false);
        }}
        title="Delete this settlement?"
        description={
          settlement
            ? `${formatMoney(settlement.amount, settlement.currency)} will be removed for everyone. This can't be undone.`
            : 'This settlement will be removed for everyone.'
        }
        confirmLabel="Delete settlement"
        destructive
        loading={deleteSettlement.isPending}
        onConfirm={confirmDelete}
      />
    </>
  );
}
