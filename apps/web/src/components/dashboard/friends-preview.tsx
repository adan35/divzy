'use client';

import { useState } from 'react';
import type { FriendDto } from '@divzy/shared';
import { useFriends } from '@/lib/hooks';
import { useAuth } from '@/lib/auth-store';
import { collapsedBalanceEntries } from '@/lib/balance-display';
import { friendSettleIntent } from '@/lib/settle-prefill';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FallbackRatesNotice } from '@/components/ui/fallback-rates-notice';
import { MoneyText } from '@/components/ui/money-text';
import { SkeletonList } from '@/components/ui/skeleton';
import { SettleUpDialog } from '@/components/settle/settle-dialog';
import { balanceMagnitude } from './balance-utils';
import { SectionError } from './section-error';
import { SectionHeader } from './section-header';

const PREVIEW_COUNT = 4;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * Per spec-WI-001 (addendum, 2026-07-14): `balancesConverted` (if any) renders
 * as the one converted line, then any `balances` leftovers (currencies with
 * no resolvable rate) render as additional native lines, same as before.
 */
export function FriendRow({ friend, onClick }: { friend: FriendDto; onClick?: () => void }) {
  const entries = collapsedBalanceEntries(friend.balancesConverted, friend.balances).sort(
    (a, b) => Math.abs(b.amount) - Math.abs(a.amount),
  );
  const visible = entries.slice(0, 2);
  const more = entries.length - visible.length;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
    >
      <Avatar user={friend.user} size="md" />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{friend.user.name}</span>
        {entries.length === 0 ? (
          <span className="block text-[13px] text-ink-3">Settled up</span>
        ) : (
          <>
            {visible.map((b) => (
              <span
                key={b.currency}
                className={cn(
                  'block truncate text-[13px]',
                  b.amount > 0 ? 'text-pos' : b.amount < 0 ? 'text-neg' : 'text-ink-3',
                )}
              >
                {b.amount === 0 ? (
                  `You and ${firstName(friend.user.name)} are settled up`
                ) : b.amount > 0 ? (
                  <>
                    {firstName(friend.user.name)} owes you{' '}
                    <MoneyText amount={b.amount} currency={b.currency} />
                  </>
                ) : (
                  <>
                    You owe {firstName(friend.user.name)}{' '}
                    <MoneyText amount={-b.amount} currency={b.currency} />
                  </>
                )}
              </span>
            ))}
            {more > 0 && (
              <span className="block text-xs text-ink-3">
                +{more} more {more === 1 ? 'currency' : 'currencies'}
              </span>
            )}
            {friend.usedFallbackRates && <FallbackRatesNotice className="text-[11px]" />}
          </>
        )}
      </div>
    </button>
  );
}

/**
 * "Friends" preview — top friends by |balance| with balance sentences.
 *
 * WI-050: clicking a row opens the same `SettleUpDialog`, pre-filled/gated
 * by the shared `friendSettleIntent` helper — identical logic to the
 * friend-detail page's own "Settle up" button. One dialog is rendered for
 * the whole list (not one per row); `selected` drives its `prefill` on each
 * render rather than being stashed in its own state, per the persistent
 * controlled-component mount model (see settle-prefill.ts / spec-WI-050 §3).
 */
export function FriendsPreview() {
  const friends = useFriends();
  const { user: me } = useAuth();
  const [settleOpen, setSettleOpen] = useState(false);
  const [selected, setSelected] = useState<FriendDto | null>(null);

  const top = [...(friends.data ?? [])]
    .sort(
      (a, b) =>
        balanceMagnitude(b.balances, b.balancesConverted) -
          balanceMagnitude(a.balances, a.balancesConverted) ||
        a.user.name.localeCompare(b.user.name),
    )
    .slice(0, PREVIEW_COUNT);

  function handleRowClick(friend: FriendDto) {
    const intent = friendSettleIntent(friend, me);
    if (intent.disabled) return;
    setSelected(friend);
    setSettleOpen(true);
  }

  return (
    <section aria-label="Friends">
      <SectionHeader title="Friends" href="/friends" />
      {friends.isPending ? (
        <SkeletonList rows={3} />
      ) : friends.isError ? (
        <SectionError error={friends.error} onRetry={() => void friends.refetch()} />
      ) : top.length === 0 ? (
        <EmptyState
          emoji="👥"
          title="No friends yet"
          hint="Share an expense with someone and they'll show up here."
          className="py-10"
        />
      ) : (
        <Card className="divide-y divide-hairline p-0">
          {top.map((f) => (
            <FriendRow key={f.user.id} friend={f} onClick={() => handleRowClick(f)} />
          ))}
        </Card>
      )}
      <SettleUpDialog
        open={settleOpen}
        onOpenChange={setSettleOpen}
        prefill={selected ? friendSettleIntent(selected, me).prefill : undefined}
      />
    </section>
  );
}
