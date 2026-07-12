'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Banknote,
  CreditCard,
  HandCoins,
  Landmark,
  Smartphone,
  Trash2,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  SETTLEMENT_METHODS,
  type SettlementDto,
  type SettlementMethod,
} from '@divzy/shared';
import { useDeleteSettlement, useSettlementsInfinite, errorMessage } from '@/lib/hooks';
import { useAuth } from '@/lib/auth-store';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MoneyText } from '@/components/ui/money-text';
import { SkeletonList } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { ConfirmDialog } from '@/components/groups/confirm-dialog';

const METHOD_ICONS: Record<SettlementMethod, LucideIcon> = {
  CASH: Banknote,
  BANK_TRANSFER: Landmark,
  UPI: Smartphone,
  PAYPAL: CreditCard,
  VENMO: Wallet,
  OTHER: HandCoins,
};

function methodLabel(method: SettlementMethod): string {
  return SETTLEMENT_METHODS.find((m) => m.key === method)?.label ?? 'Other';
}

function SettlementRow({
  settlement,
  meId,
  onDelete,
}: {
  settlement: SettlementDto;
  meId: string | null;
  onDelete: (settlement: SettlementDto) => void;
}) {
  const Icon = METHOD_ICONS[settlement.method];
  const fromLabel = meId !== null && settlement.from.id === meId ? 'You' : settlement.from.name;
  const toLabel = meId !== null && settlement.to.id === meId ? 'you' : settlement.to.name;
  const canDelete =
    meId !== null &&
    (settlement.from.id === meId ||
      settlement.to.id === meId ||
      settlement.createdBy.id === meId);

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2"
        aria-hidden="true"
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">
          <span className="font-medium">{fromLabel}</span> paid{' '}
          <span className="font-medium">{toLabel}</span>
          {settlement.group && (
            <>
              {' '}
              <Link
                href={`/groups/${settlement.group.id}`}
                className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 align-middle text-xs font-medium text-ink-2 transition-colors hover:bg-brand-soft hover:text-brand"
              >
                <span aria-hidden="true">{settlement.group.emoji}</span>
                {settlement.group.name}
              </Link>
            </>
          )}
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-3">
          {methodLabel(settlement.method)} · {formatDate(settlement.date)}
          {settlement.note ? ` · “${settlement.note}”` : ''}
        </p>
      </div>
      <MoneyText
        amount={settlement.amount}
        currency={settlement.currency}
        className="shrink-0 text-sm font-medium text-ink"
      />
      {canDelete && (
        <button
          type="button"
          aria-label="Delete this payment"
          onClick={() => onDelete(settlement)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-neg-soft hover:text-danger"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export interface SettlementsSectionProps {
  /** Show payments shared with this friend (their user id). */
  friendId: string;
}

/**
 * Payments recorded between you and a friend — method icon rows with
 * delete (soft) for payments you're a party to.
 */
export function SettlementsSection({ friendId }: SettlementsSectionProps) {
  const { user: me } = useAuth();
  const settlements = useSettlementsInfinite({ friendId });
  const deleteSettlement = useDeleteSettlement();
  const [pendingDelete, setPendingDelete] = useState<SettlementDto | null>(null);

  const items = settlements.data?.pages.flatMap((p) => p.items) ?? [];

  const handleDelete = () => {
    if (!pendingDelete || deleteSettlement.isPending) return;
    deleteSettlement.mutate(
      { settlementId: pendingDelete.id, groupId: pendingDelete.groupId },
      {
        onSuccess: () => {
          setPendingDelete(null);
          toast.success('Payment deleted — balances updated');
        },
      },
    );
  };

  return (
    <section aria-label="Payments">
      <h2 className="mb-3 text-[15px] font-semibold text-ink">Payments</h2>

      {settlements.isPending ? (
        <SkeletonList rows={2} />
      ) : settlements.isError ? (
        <Card className="flex flex-col items-center gap-2.5 p-6 text-center">
          <p className="max-w-sm text-sm text-ink-2">{errorMessage(settlements.error)}</p>
          <Button variant="outline" size="sm" onClick={() => void settlements.refetch()}>
            Try again
          </Button>
        </Card>
      ) : items.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-sm text-ink-3">
            No payments between you yet — settle up and they&rsquo;ll show here.
          </p>
        </Card>
      ) : (
        <Card className="divide-y divide-hairline p-0">
          {items.map((s) => (
            <SettlementRow
              key={s.id}
              settlement={s}
              meId={me?.id ?? null}
              onDelete={setPendingDelete}
            />
          ))}
          {settlements.hasNextPage && (
            <button
              type="button"
              onClick={() => void settlements.fetchNextPage()}
              disabled={settlements.isFetchingNextPage}
              className="flex w-full items-center justify-center gap-2 px-3 py-2.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-55"
            >
              {settlements.isFetchingNextPage && <Spinner size="sm" />}
              Show older payments
            </button>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteSettlement.isPending) setPendingDelete(null);
        }}
        title="Delete this payment?"
        description="The payment is removed from the ledger and balances between you go back up by this amount."
        confirmLabel="Delete payment"
        destructive
        loading={deleteSettlement.isPending}
        onConfirm={handleDelete}
      />
    </section>
  );
}
