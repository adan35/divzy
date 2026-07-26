'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronRight, Minus, Plus, QrCode, RefreshCw, UserPlus } from 'lucide-react';
import { matchesBalanceFilter, type BalanceFilter, type FriendDto, type CurrencyAmount } from '@divzy/shared';
import { useFriends, errorMessage } from '@/lib/hooks';
import { collapsedBalanceEntries } from '@/lib/balance-display';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-store';
import { bucketSettleIntent } from '@/lib/settle-prefill';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { MoneyText } from '@/components/ui/money-text';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { SkeletonList } from '@/components/ui/skeleton';
import { AddFriendDialog } from '@/components/friends/add-friend-dialog';
import { BalanceSentence } from '@/components/friends/balance-sentence';
import { FriendBalanceBreakdown } from '@/components/friends/friend-balance-breakdown';
import { FriendCodeDialog } from '@/components/friends/friend-code-dialog';
import { FriendsBalanceSummary } from '@/components/friends/friends-balance-summary';
import { SettleUpDialog } from '@/components/settle/settle-dialog';

const FRIEND_FILTER_LABELS: Record<BalanceFilter, string> = {
  none: 'All friends',
  outstanding: 'Any outstanding balance',
  youOwe: 'Friends you owe',
  owedYou: 'Friends who owe you',
};

const FRIEND_FILTER_EMPTY_HINT: Record<Exclude<BalanceFilter, 'none'>, string> = {
  outstanding: 'No friends with an outstanding balance.',
  youOwe: 'No friends you owe right now.',
  owedYou: 'No friends who owe you right now.',
};

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function FriendRow({
  friend,
  onSettleUp,
}: {
  friend: FriendDto;
  onSettleUp?: (payload: {
    friend: FriendDto;
    bucket: FriendDto['balancesByGroup'][number];
    line: CurrencyAmount;
    groupId?: string;
  }) => void;
}) {
  // WI-049 defect fix: previously read only `friend.balances` (post-WI-001
  // this holds ONLY the unconvertible subset), so a fully-converted balance
  // wrongly rendered "Settled up". `collapsedBalanceEntries` folds the
  // converted figure back in first, then any unconvertible leftovers —
  // mirrors mobile's `collapsedBalanceEntries` usage in FriendRow.
  const entries = collapsedBalanceEntries(friend.balancesConverted, friend.balances);
  const primary = entries[0];
  const amountEntries = entries.slice(0, 2);
  const moreAmounts = entries.length - amountEntries.length;

  // WI-079 D6/D11: collapsed by default; the expand affordance is a dedicated
  // chevron toggle (never an overloaded row tap — the Link keeps its
  // navigation), governed purely by bucket count. A friend whose collapsed
  // net is ZERO can still carry ≥2 nonzero buckets (cross-bucket cancel) and
  // keeps the affordance; ≤1 bucket suppresses it (it would duplicate the row).
  const [expanded, setExpanded] = useState(false);
  const canExpand = friend.balancesByGroup.length > 1;
  // WI-083: the decorative ChevronRight is suppressed for fully-settled rows;
  // canExpand still gates the plus/minus toggle so cross-bucket-cancel rows
  // (net zero with ≥2 buckets) keep their expand affordance.
  const isSettled = !primary;

  return (
    <div>
      <div className="flex items-center pr-4">
        <Link
          href={`/friends/${friend.user.id}`}
          className="flex min-w-0 flex-1 items-center gap-3 py-3.5 pl-4 pr-2 transition-colors hover:bg-surface-2"
        >
          <Avatar user={friend.user} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{friend.user.name}</p>
            {!primary ? (
              <p className="text-[13px] text-ink-3">Settled up</p>
            ) : (
              <p className="truncate text-[13px]">
                <BalanceSentence
                  name={firstName(friend.user.name)}
                  amount={primary.amount}
                  currency={primary.currency}
                />
                {entries.length > 1 && (
                  <span className="text-ink-3"> · +{entries.length - 1} more</span>
                )}
              </p>
            )}
          </div>
          {amountEntries.length > 0 && (
            <div className="flex shrink-0 flex-col items-end gap-0.5">
              {amountEntries.map((b) => (
                <MoneyText
                  key={b.currency}
                  amount={b.amount}
                  currency={b.currency}
                  mode="signed-color"
                  className="text-[13px]"
                />
              ))}
              {moreAmounts > 0 && <p className="text-xs text-ink-3">+{moreAmounts} more</p>}
              {friend.usedFallbackRates && <p className="text-[11px] text-warn">est. rate</p>}
            </div>
          )}
        </Link>
        {canExpand ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide per-group breakdown' : 'Show per-group breakdown'}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="shrink-0 rounded-md p-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            {expanded ? (
              <Minus className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Plus className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        ) : !isSettled ? (
          <ChevronRight className="mx-2 h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
        ) : (
          <span aria-hidden="true" className="mx-2 h-4 w-4 shrink-0" />
        )}
      </div>
      {canExpand && expanded && (
        <FriendBalanceBreakdown
          friend={friend}
          onSettleUp={onSettleUp}
          showDirectBucketLink={false}
        />
      )}
    </div>
  );
}

export default function FriendsPage() {
  const friends = useFriends();
  const { user: me } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [filter, setFilter] = useState<BalanceFilter>('none');
  const [settleOpen, setSettleOpen] = useState(false);
  const [settle, setSettle] = useState<
    | {
        friend: FriendDto;
        bucket: FriendDto['balancesByGroup'][number];
        line: CurrencyAmount;
        groupId?: string;
      }
    | undefined
  >();

  const handleSettleUp = (
    payload: {
      friend: FriendDto;
      bucket: FriendDto['balancesByGroup'][number];
      line: CurrencyAmount;
      groupId?: string;
    },
  ) => {
    setSettle(payload);
    setSettleOpen(true);
  };

  const settlePrefill =
    settle && me ? bucketSettleIntent(settle.bucket, settle.line, settle.friend, me).prefill : undefined;
  const settleGroupId = settle?.groupId;

  // WI-037: a pure derived view over the live useFriends() cache — re-runs on
  // every fresh fetch/invalidation, never a frozen snapshot. Evaluated over
  // each friend's full native per-currency net (balancesNative), never the
  // converted figure, so a mixed-currency friend correctly matches both
  // direction filters.
  const filtered = useMemo(
    () => (friends.data ?? []).filter((f) => matchesBalanceFilter(f.balancesNative ?? [], filter)),
    [friends.data, filter],
  );

  return (
    <>
      <PageHeader
        title="Friends"
        subtitle="Everyone you split with, and where you stand."
        actions={
          <>
            <Button variant="outline" onClick={() => setCodeOpen(true)}>
              <QrCode className="h-4 w-4" aria-hidden="true" />
              My code
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Add friend
            </Button>
          </>
        }
      />

      {friends.isPending ? (
        <SkeletonList rows={5} />
      ) : friends.isError ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="max-w-sm text-sm text-ink-2">{errorMessage(friends.error)}</p>
          <Button variant="outline" size="sm" onClick={() => void friends.refetch()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </Card>
      ) : friends.data.length === 0 ? (
        <EmptyState
          emoji="👥"
          title="No friends yet"
          hint="Add someone by email, or share an expense — friendships happen automatically."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Add friend
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          <FriendsBalanceSummary friends={friends.data} />

          <div className="flex justify-end">
            <Select
              aria-label="Filter friends"
              value={filter}
              onChange={(e) => setFilter(e.target.value as BalanceFilter)}
              className="w-56"
            >
              {(Object.keys(FRIEND_FILTER_LABELS) as BalanceFilter[]).map((f) => (
                <option key={f} value={f}>
                  {FRIEND_FILTER_LABELS[f]}
                </option>
              ))}
            </Select>
          </div>

          {filtered.length === 0 ? (
            <Card className="p-8 text-center text-sm text-ink-2">
              {filter === 'none' ? 'No friends yet.' : FRIEND_FILTER_EMPTY_HINT[filter]}
            </Card>
          ) : (
            <Card className="divide-y divide-hairline p-0">
              {filtered.map((f) => (
                <FriendRow key={f.user.id} friend={f} onSettleUp={handleSettleUp} />
              ))}
            </Card>
          )}
        </div>
      )}

      <AddFriendDialog open={addOpen} onOpenChange={setAddOpen} />
      <FriendCodeDialog open={codeOpen} onOpenChange={setCodeOpen} />
      <SettleUpDialog
        open={settleOpen}
        onOpenChange={(open) => {
          setSettleOpen(open);
          if (!open) setSettle(undefined);
        }}
        groupId={settleGroupId}
        prefill={settlePrefill}
      />
    </>
  );
}
