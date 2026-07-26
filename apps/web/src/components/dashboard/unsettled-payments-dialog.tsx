'use client';

import { useMemo, useState } from 'react';
import type { GroupBalancesDto, GroupSummaryDto, PublicUserDto, UserDto } from '@divzy/shared';
import { matchesBalanceFilter } from '@divzy/shared';
import { useAuth } from '@/lib/auth-store';
import { useGroupBalancesMany, useGroups } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { Dialog, DialogBody, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FallbackRatesNotice } from '@/components/ui/fallback-rates-notice';
import { SkeletonList } from '@/components/ui/skeleton';
import { Toggle } from '@/components/ui/toggle';
import { BalanceSentence } from '@/components/friends/balance-sentence';
import type { SettleUpPrefill } from '@/components/settle/settle-dialog';
import { SectionError } from './section-error';

export interface UnsettledPaymentLine {
  groupId: string;
  groupName: string;
  groupEmoji: string;
  counterparty: PublicUserDto;
  amount: number; // absolute, in minor units
  currency: string;
  prefill: SettleUpPrefill;
}

export interface UnsettledPaymentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettleUp: (payload: { groupId: string; prefill: SettleUpPrefill }) => void;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * Pure builder for the unsettled-payments list.
 *
 * - When simplify is ON, rows come from `GroupBalancesDto.suggestions`.
 * - When simplify is OFF, rows come from `GroupBalancesDto.pairwise`.
 * - Only rows where the caller is the payer (`fromUserId === me.id`) are included,
 *   because this view is "who to pay", not "who owes me".
 * - Results are sorted by the caller's default currency first, then by |amount| desc.
 */
export function buildUnsettledLines(
  groups: GroupSummaryDto[],
  balances: Array<GroupBalancesDto | undefined>,
  me: UserDto,
  simplify: boolean,
): UnsettledPaymentLine[] {
  const lines: UnsettledPaymentLine[] = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const data = balances[i];
    if (!group || !data) continue;
    const source = simplify ? data.suggestions : data.pairwise;
    for (const row of source) {
      if (row.fromUserId !== me.id) continue;
      lines.push({
        groupId: group.id,
        groupName: group.name,
        groupEmoji: group.emoji,
        counterparty: row.to,
        amount: row.amount,
        currency: row.currency,
        prefill: {
          fromUserId: me.id,
          toUserId: row.toUserId,
          amount: row.amount,
          currency: row.currency,
        },
      });
    }
  }

  const primary = me.defaultCurrency;
  return lines
    .filter((l) => l.amount > 0)
    .sort((a, b) => {
      if (a.currency !== b.currency) {
        if (a.currency === primary) return -1;
        if (b.currency === primary) return 1;
      }
      return (
        Math.abs(b.amount) - Math.abs(a.amount) ||
        a.currency.localeCompare(b.currency) ||
        a.counterparty.name.localeCompare(b.counterparty.name)
      );
    });
}

export function UnsettledPaymentsDialog({
  open,
  onOpenChange,
  onSettleUp,
}: UnsettledPaymentsDialogProps) {
  const { user: me } = useAuth();
  const groups = useGroups();
  const [simplify, setSimplify] = useState(true);

  const activeYouOweGroups = useMemo(() => {
    if (!groups.data) return [];
    return groups.data.filter(
      (g) => g.archivedAt === null && matchesBalanceFilter(g.yourBalancesNative, 'youOwe'),
    );
  }, [groups.data]);

  const groupIds = useMemo(
    () => activeYouOweGroups.map((g) => g.id),
    [activeYouOweGroups],
  );

  const balances = useGroupBalancesMany(groupIds);

  const lines = useMemo(() => {
    if (!me) return [];
    return buildUnsettledLines(
      activeYouOweGroups,
      balances.map((b) => b?.data),
      me,
      simplify,
    );
  }, [activeYouOweGroups, balances, me, simplify]);

  const isPending = groups.isPending || balances.some((b) => b?.isPending);
  const firstError = groups.error ?? balances.find((b) => b?.isError)?.error;
  const isError = Boolean(firstError);

  const handleRetry = () => {
    void groups.refetch();
    balances.forEach((b) => {
      if (b?.refetch) void b.refetch();
    });
  };

  const anyFallbackRates = balances.some((b) => b?.data?.usedFallbackRates);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" ariaLabel="Unsettled payments">
      <DialogHeader>
        <DialogTitle>Unsettled payments</DialogTitle>
        <DialogDescription>Every group debt you still need to pay.</DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-ink-2">Simplify debts</span>
          <Toggle
            aria-label="Simplify debts"
            checked={simplify}
            onChange={setSimplify}
          />
        </div>

        {isPending ? (
          <SkeletonList rows={4} />
        ) : isError ? (
          <SectionError error={firstError} onRetry={handleRetry} />
        ) : lines.length === 0 ? (
          <EmptyState
            emoji="✅"
            title="All caught up"
            hint="You don't owe anything in any group right now."
            className="py-10"
          />
        ) : (
          <Card className="divide-y divide-hairline overflow-hidden">
            {lines.map((line, index) => (
              <button
                key={`${line.groupId}-${line.counterparty.id}-${line.currency}-${index}`}
                type="button"
                onClick={() => onSettleUp({ groupId: line.groupId, prefill: line.prefill })}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-3 text-left',
                  'transition-colors hover:bg-surface-2 active:scale-[0.995]',
                )}
                aria-label={`Record payment to ${line.counterparty.name} for ${line.groupName}`}
              >
                <Avatar user={line.counterparty} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">
                    {line.counterparty.name}
                  </span>
                  <span className="block truncate text-[13px] text-ink-3">
                    {line.groupEmoji} {line.groupName} · {line.currency}
                  </span>
                </span>
                <span className="shrink-0 text-[13px]">
                  <BalanceSentence
                    name={firstName(line.counterparty.name)}
                    amount={-line.amount}
                    currency={line.currency}
                  />
                </span>
              </button>
            ))}
          </Card>
        )}

        {anyFallbackRates && (
          <FallbackRatesNotice className="text-[12px]" />
        )}
      </DialogBody>
    </Dialog>
  );
}
