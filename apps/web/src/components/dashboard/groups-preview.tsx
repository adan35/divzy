'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { HandCoins, Plus } from 'lucide-react';
import type { CurrencyAmount, GroupSummaryDto } from '@divzy/shared';
import { matchesBalanceFilter } from '@divzy/shared';
import { useGroups } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { collapsedBalanceEntries } from '@/lib/balance-display';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dropdown, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown';
import { EmptyState } from '@/components/ui/empty-state';
import { MoneyText } from '@/components/ui/money-text';
import { SkeletonList } from '@/components/ui/skeleton';
import { SettleUpDialog, type SettleUpPrefill } from '@/components/settle/settle-dialog';
import { UnsettledPaymentsDialog } from './unsettled-payments-dialog';
import { balanceMagnitude } from './balance-utils';
import { SectionError } from './section-error';
import { SectionHeader } from './section-header';

const PREVIEW_COUNT = 4;

/** The user's net position in a group, phrased as sentences per currency. */
function GroupNet({ balances }: { balances: CurrencyAmount[] }) {
  const nonZero = balances
    .filter((b) => b.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  if (nonZero.length === 0) {
    return <span className="shrink-0 text-[13px] text-ink-3">Settled up</span>;
  }

  const visible = nonZero.slice(0, 2);
  const more = nonZero.length - visible.length;

  return (
    <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
      {visible.map((b, i) => (
        <span
          key={`${b.currency}-${i}`}
          className={cn('text-[13px] font-medium', b.amount > 0 ? 'text-pos' : 'text-neg')}
        >
          {b.amount > 0 ? 'You are owed ' : 'You owe '}
          <MoneyText amount={Math.abs(b.amount)} currency={b.currency} />
        </span>
      ))}
      {more > 0 && (
        <span className="text-xs text-ink-3">
          +{more} more {more === 1 ? 'currency' : 'currencies'}
        </span>
      )}
    </span>
  );
}

function GroupRow({ group }: { group: GroupSummaryDto }) {
  return (
    <Link href={`/groups/${group.id}`} className="block">
      <Card className="flex items-center gap-3 p-4 transition-colors hover:bg-surface-2">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-xl"
          aria-hidden="true"
        >
          {group.emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{group.name}</span>
          <span className="block text-[13px] text-ink-3">
            {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
          </span>
        </span>
        <GroupNet balances={collapsedBalanceEntries(group.yourBalanceConverted, group.yourBalances)} />
      </Card>
    </Link>
  );
}

/**
 * "Your groups" — top groups by |balance| with the user's net per group.
 *
 * spec-WI-057: only groups where the viewer has a real outstanding balance
 * appear — filtered via `matchesBalanceFilter(yourBalancesNative, 'outstanding')`,
 * never the group-wide `settled` flag (WI-028), which is not viewer-specific.
 *
 * spec-WI-088: the section header hosts a "+" dropdown with "Create group" and
 * "Unsettled payments" options. The existing preview list remains unchanged.
 */
export function GroupsPreview() {
  const groups = useGroups();
  const router = useRouter();

  const [unsettledOpen, setUnsettledOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [settlePrefill, setSettlePrefill] = useState<SettleUpPrefill | undefined>(undefined);
  const [settleGroupId, setSettleGroupId] = useState<string | undefined>(undefined);

  const active = (groups.data ?? []).filter((g) => g.archivedAt === null);
  const outstanding = active.filter((g) =>
    matchesBalanceFilter(g.yourBalancesNative ?? [], 'outstanding'),
  );
  const top = [...outstanding]
    .sort(
      (a, b) =>
        balanceMagnitude(b.yourBalances, b.yourBalanceConverted) -
          balanceMagnitude(a.yourBalances, a.yourBalanceConverted) ||
        (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '') ||
        a.name.localeCompare(b.name),
    )
    .slice(0, PREVIEW_COUNT);

  const headerAction = (
    <Dropdown
      align="end"
      trigger={
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink">
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Group actions</span>
        </span>
      }
    >
      <DropdownItem onSelect={() => router.push('/groups?new=1')} icon={<Plus className="h-4 w-4" />}>
        Create group
      </DropdownItem>
      <DropdownSeparator />
      <DropdownItem
        onSelect={() => setUnsettledOpen(true)}
        icon={<HandCoins className="h-4 w-4" />}
      >
        Unsettled payments
      </DropdownItem>
    </Dropdown>
  );

  function handleSettleUp(payload: { groupId: string; prefill: SettleUpPrefill }) {
    setUnsettledOpen(false);
    setSettleGroupId(payload.groupId);
    setSettlePrefill(payload.prefill);
    setSettleOpen(true);
  }

  return (
    <section aria-label="Your groups">
      <SectionHeader title="Your groups" href="/groups" action={headerAction} />
      {groups.isPending ? (
        <SkeletonList rows={3} />
      ) : groups.isError ? (
        <SectionError error={groups.error} onRetry={() => void groups.refetch()} />
      ) : active.length === 0 ? (
        <EmptyState
          emoji="✈️"
          title="No groups yet"
          hint="Groups keep trips, homes and projects organized."
          action={
            <Button size="sm" onClick={() => router.push('/groups?new=1')}>
              New group
            </Button>
          }
          className="py-10"
        />
      ) : top.length === 0 ? (
        <EmptyState
          emoji="✅"
          title="All settled up"
          hint="No groups need settling right now."
          className="py-10"
        />
      ) : (
        <div className="space-y-2.5">
          {top.map((g) => (
            <GroupRow key={g.id} group={g} />
          ))}
        </div>
      )}

      <UnsettledPaymentsDialog
        open={unsettledOpen}
        onOpenChange={setUnsettledOpen}
        onSettleUp={handleSettleUp}
      />

      <SettleUpDialog
        open={settleOpen}
        onOpenChange={(open) => {
          setSettleOpen(open);
          if (!open) {
            setSettlePrefill(undefined);
            setSettleGroupId(undefined);
          }
        }}
        groupId={settleGroupId}
        prefill={settlePrefill}
      />
    </section>
  );
}
