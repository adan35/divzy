'use client';

import { useState } from 'react';
import { ChevronRight, HandCoins, MoveRight, RefreshCw } from 'lucide-react';
import { formatMoney, type PublicUserDto } from '@divzy/shared';
import { errorMessage, useGroupBalances } from '@/lib/hooks';
import { useAuth } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MoneyText } from '@/components/ui/money-text';
import { SkeletonList } from '@/components/ui/skeleton';
import { SettleUpDialog, type SettleUpPrefill } from '@/components/settle/settle-dialog';

export interface BalancesViewProps {
  groupId: string;
}

/** "gets back $12.50" / "owes $3.00" — always wording + color, never a bare sign. */
function netPhrase(amount: number, currency: string, isMe: boolean): string {
  const money = formatMoney(Math.abs(amount), currency);
  if (amount > 0) return isMe ? `you get back ${money}` : `gets back ${money}`;
  return isMe ? `you owe ${money}` : `owes ${money}`;
}

/**
 * Group balances tab: per-member nets, suggested settlements with one-tap
 * "Record payment", and an expandable exact (pairwise) debt list.
 */
export function BalancesView({ groupId }: BalancesViewProps) {
  const { user: me } = useAuth();
  const balances = useGroupBalances(groupId);
  const [showExact, setShowExact] = useState(false);
  const [settle, setSettle] = useState<{ prefill?: SettleUpPrefill } | null>(null);

  if (balances.isLoading) {
    return <SkeletonList rows={4} />;
  }

  if (balances.isError) {
    return (
      <Card className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-ink-2">{errorMessage(balances.error)}</p>
        <Button variant="secondary" size="sm" onClick={() => void balances.refetch()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
      </Card>
    );
  }

  const data = balances.data;
  if (!data) return null;

  // Show the requesting user first; everyone else in API order.
  const members = [...data.members].sort((a, b) => {
    if (me) {
      if (a.user.id === me.id) return -1;
      if (b.user.id === me.id) return 1;
    }
    return 0;
  });

  const displayName = (user: PublicUserDto): string =>
    me && user.id === me.id ? 'You' : user.name;

  return (
    <div className="space-y-6">
      {/* Per-member nets */}
      <Card className="divide-y divide-hairline">
        {members.map(({ user, balances: nets }) => {
          const isMe = me?.id === user.id;
          const settled = nets.length === 0;
          return (
            <div key={user.id} className="flex items-center gap-3 px-4 py-3.5">
              <Avatar user={user} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                  {user.name}
                  {isMe && <span className="ml-1 text-ink-3">(you)</span>}
                </p>
                <p className="truncate text-[13px] text-ink-3">
                  {settled
                    ? 'settled up'
                    : nets.map((n) => netPhrase(n.amount, n.currency, isMe)).join(' · ')}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                {settled ? (
                  <span className="text-sm text-ink-3">—</span>
                ) : (
                  nets.map((n) => (
                    <MoneyText
                      key={n.currency}
                      amount={n.amount}
                      currency={n.currency}
                      mode="signed-color"
                      className="text-sm"
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </Card>

      {/* Suggested settlements */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">Suggested settlements</h3>
          <Button variant="ghost" size="sm" onClick={() => setSettle({})}>
            <HandCoins className="h-4 w-4" aria-hidden="true" />
            Record a payment
          </Button>
        </div>

        {data.suggestions.length === 0 ? (
          <Card className="p-6 text-center">
            <div className="text-2xl" aria-hidden="true">
              ✅
            </div>
            <p className="mt-1.5 text-sm font-medium text-ink">All settled up</p>
            <p className="text-[13px] text-ink-3">No one needs to pay anyone in this group.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {data.suggestions.map((s) => (
              <Card
                key={`${s.currency}-${s.fromUserId}-${s.toUserId}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar user={s.from} size="sm" />
                  <span className="truncate text-sm font-medium text-ink">
                    {displayName(s.from)}
                  </span>
                </span>
                <MoveRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar user={s.to} size="sm" />
                  <span className="truncate text-sm font-medium text-ink">
                    {displayName(s.to)}
                  </span>
                </span>
                <span className="ml-auto flex items-center gap-3">
                  <MoneyText
                    amount={s.amount}
                    currency={s.currency}
                    className="text-sm font-semibold"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setSettle({
                        prefill: {
                          fromUserId: s.fromUserId,
                          toUserId: s.toUserId,
                          amount: s.amount,
                          currency: s.currency,
                        },
                      })
                    }
                  >
                    Record payment
                  </Button>
                </span>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Exact (pairwise) debts */}
      {data.pairwise.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            aria-expanded={showExact}
            onClick={() => setShowExact((v) => !v)}
            className="flex items-center gap-1 text-[13px] font-medium text-ink-3 transition-colors hover:text-ink"
          >
            <ChevronRight
              className={cn('h-4 w-4 transition-transform', showExact && 'rotate-90')}
              aria-hidden="true"
            />
            Exact debts as incurred ({data.pairwise.length})
          </button>
          {showExact && (
            <Card className="divide-y divide-hairline">
              {data.pairwise.map((d) => (
                <div
                  key={`${d.currency}-${d.fromUserId}-${d.toUserId}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <p className="min-w-0 truncate text-[13px] text-ink-2">
                    <span className="font-medium text-ink">{displayName(d.from)}</span>
                    {' owes '}
                    <span className="font-medium text-ink">{displayName(d.to)}</span>
                  </p>
                  <MoneyText
                    amount={d.amount}
                    currency={d.currency}
                    className="shrink-0 text-[13px] text-ink-2"
                  />
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {settle !== null && (
        <SettleUpDialog
          open
          onOpenChange={(open) => {
            if (!open) setSettle(null);
          }}
          groupId={groupId}
          prefill={settle.prefill}
        />
      )}
    </div>
  );
}
