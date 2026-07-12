'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Plus, RefreshCw, Users } from 'lucide-react';
import {
  GROUP_TYPES,
  formatMoney,
  type CurrencyAmount,
  type GroupSummaryDto,
  type GroupType,
} from '@divzy/shared';
import { errorMessage, useGroups } from '@/lib/hooks';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { GroupFormDialog } from '@/components/groups/group-form-dialog';

function typeLabel(type: GroupType): string {
  return GROUP_TYPES.find((t) => t.key === type)?.label ?? 'Other';
}

/** Your net position, phrased per STYLE.md — color always paired with wording. */
function BalanceSentences({ balances }: { balances: CurrencyAmount[] }) {
  if (balances.length === 0) {
    return <p className="text-sm text-ink-3">You&rsquo;re all settled up</p>;
  }
  return (
    <div className="space-y-0.5">
      {balances.map((b) => (
        <p
          key={b.currency}
          className={cn(
            'text-sm font-medium tabular-nums',
            b.amount > 0 ? 'text-pos' : 'text-neg',
          )}
        >
          {b.amount > 0
            ? `You are owed ${formatMoney(b.amount, b.currency)}`
            : `You owe ${formatMoney(-b.amount, b.currency)}`}
        </p>
      ))}
    </div>
  );
}

function GroupCard({ group }: { group: GroupSummaryDto }) {
  const archived = group.archivedAt !== null;
  return (
    <Link
      href={`/groups/${group.id}`}
      className="block h-full focus-visible:outline-none"
      aria-label={`Open group ${group.name}`}
    >
      <Card
        className={cn(
          'flex h-full flex-col gap-3 p-5 transition-colors hover:bg-surface-2',
          archived && 'opacity-70',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <span
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-2xl"
            aria-hidden="true"
          >
            {group.emoji}
          </span>
          <span className="flex items-center gap-1.5">
            {archived && <Badge variant="warn">Archived</Badge>}
            <Badge variant="outline">{typeLabel(group.type)}</Badge>
          </span>
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-ink">{group.name}</h3>
          <p className="mt-0.5 flex items-center gap-1 text-[13px] text-ink-3">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="mt-auto space-y-1.5 border-t border-hairline pt-3">
          <BalanceSentences balances={group.yourBalances} />
          <p className="text-xs text-ink-3">
            {group.lastActivityAt
              ? `Active ${formatRelative(group.lastActivityAt)}`
              : 'No activity yet'}
          </p>
        </div>
      </Card>
    </Link>
  );
}

function GroupsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <Card key={i} className="space-y-4 p-5">
          <div className="flex items-start justify-between">
            <Skeleton className="h-11 w-11 rounded-xl" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
          <Skeleton className="h-3.5 w-1/2" />
        </Card>
      ))}
    </div>
  );
}

/** Most-recently-active first; groups without activity go last, by name. */
function byActivity(a: GroupSummaryDto, b: GroupSummaryDto): number {
  if (a.lastActivityAt && b.lastActivityAt) {
    return b.lastActivityAt.localeCompare(a.lastActivityAt);
  }
  if (a.lastActivityAt) return -1;
  if (b.lastActivityAt) return 1;
  return a.name.localeCompare(b.name);
}

function GroupsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const groups = useGroups();

  const [formOpen, setFormOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const autoOpened = useRef(false);

  // ?new=1 auto-opens the create dialog once, then cleans the URL.
  useEffect(() => {
    if (!autoOpened.current && searchParams.get('new') === '1') {
      autoOpened.current = true;
      setFormOpen(true);
      router.replace('/groups', { scroll: false });
    }
  }, [searchParams, router]);

  const { active, archived } = useMemo(() => {
    const all = groups.data ?? [];
    return {
      active: all.filter((g) => g.archivedAt === null).sort(byActivity),
      archived: all.filter((g) => g.archivedAt !== null).sort(byActivity),
    };
  }, [groups.data]);

  return (
    <>
      <PageHeader
        title="Groups"
        subtitle={
          groups.data
            ? `${active.length} active group${active.length === 1 ? '' : 's'}`
            : undefined
        }
        actions={
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New group
          </Button>
        }
      />

      {groups.isLoading ? (
        <GroupsSkeleton />
      ) : groups.isError ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm text-ink-2">{errorMessage(groups.error)}</p>
          <Button variant="secondary" size="sm" onClick={() => void groups.refetch()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </Card>
      ) : active.length === 0 && archived.length === 0 ? (
        <EmptyState
          emoji="✈️"
          title="No groups yet"
          hint="Create a group for your next trip, your home, or your crew — and split every bill fairly."
          action={
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New group
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          {active.length === 0 ? (
            <EmptyState
              emoji="✈️"
              title="No active groups"
              hint="All your groups are archived. Start a new one below."
              action={
                <Button onClick={() => setFormOpen(true)}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New group
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {active.map((g) => (
                <GroupCard key={g.id} group={g} />
              ))}
            </div>
          )}

          {archived.length > 0 && (
            <div className="space-y-3">
              <button
                type="button"
                aria-expanded={showArchived}
                onClick={() => setShowArchived((v) => !v)}
                className="flex items-center gap-1 text-[13px] font-medium text-ink-3 transition-colors hover:text-ink"
              >
                <ChevronRight
                  className={cn('h-4 w-4 transition-transform', showArchived && 'rotate-90')}
                  aria-hidden="true"
                />
                Archived ({archived.length})
              </button>
              {showArchived && (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {archived.map((g) => (
                    <GroupCard key={g.id} group={g} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <GroupFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </>
  );
}

export default function GroupsPage() {
  // useSearchParams requires a Suspense boundary during prerender.
  return (
    <Suspense fallback={<GroupsSkeleton />}>
      <GroupsPageInner />
    </Suspense>
  );
}
