'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { ChevronRight, Plus, RefreshCw, Users } from 'lucide-react';
import {
  GROUP_TYPES,
  matchesBalanceFilter,
  type BalanceFilter,
  type GroupSummaryDto,
  type GroupType,
} from '@divzy/shared';
import { errorMessage, useGroups, useUnarchiveGroup } from '@/lib/hooks';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Toggle } from '@/components/ui/toggle';
import { BalanceSentences } from '@/components/groups/balance-sentences';
import { GroupFormDialog } from '@/components/groups/group-form-dialog';
import { GroupSpendChart } from '@/components/groups/group-spend-chart';

// WI-028: per-device toggle persistence (localStorage) — no server state, no
// auth-owned User field. Default off — nothing hides settled groups without
// explicit user action.
const UNSETTLED_ONLY_KEY = 'divzy.groups.unsettledOnly';

function readUnsettledOnly(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(UNSETTLED_ONLY_KEY) === '1';
  } catch {
    return false;
  }
}

function writeUnsettledOnly(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(UNSETTLED_ONLY_KEY, value ? '1' : '0');
  } catch {
    // Storage unavailable (private mode etc.) — the toggle still works for
    // the current session via React state, it just won't persist.
  }
}

const GROUP_FILTER_LABELS: Record<BalanceFilter, string> = {
  none: 'All groups',
  outstanding: 'Any outstanding balance',
  youOwe: 'You owe',
  owedYou: 'You are owed',
};

function typeLabel(type: GroupType): string {
  return GROUP_TYPES.find((t) => t.key === type)?.label ?? 'Other';
}

function GroupCard({ group }: { group: GroupSummaryDto }) {
  const archived = group.archivedAt !== null;
  const unarchiveGroup = useUnarchiveGroup();

  const handleUnarchive = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    unarchiveGroup.mutate(group.id);
  };

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
            {/* WI-028: group-wide settled categorization — independent of archived. */}
            {group.settled && <Badge variant="pos">Settled</Badge>}
            {archived && <Badge className="text-ink-3">Archived</Badge>}
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
          <BalanceSentences
            yourBalanceConverted={group.yourBalanceConverted}
            yourBalances={group.yourBalances}
            usedFallbackRates={group.usedFallbackRates}
          />
          <p className="text-xs text-ink-3">
            {group.lastActivityAt
              ? `Active ${formatRelative(group.lastActivityAt)}`
              : 'No activity yet'}
          </p>
          {/*
            WI-027: any active member may attempt unarchive here — the server
            (assertAdmin) is the authoritative gate. GroupSummaryDto carries no
            viewer-role field to hide this client-side for non-admins on the
            list view (unlike the group detail page, which has full GroupDto
            members to compute isAdmin) — see build note.
          */}
          {archived && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              loading={unarchiveGroup.isPending}
              onClick={handleUnarchive}
            >
              Unarchive
            </Button>
          )}
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
  // WI-028: default off (localStorage-persisted). Lazy initializer reads once
  // on mount — SSR-safe (readUnsettledOnly() returns false server-side).
  const [unsettledOnly, setUnsettledOnly] = useState(readUnsettledOnly);
  // WI-038: viewer-net balance filter — independent axis from both the
  // archived split and the WI-028 settled toggle above.
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>('none');
  const autoOpened = useRef(false);

  // ?new=1 auto-opens the create dialog once, then cleans the URL.
  useEffect(() => {
    if (!autoOpened.current && searchParams.get('new') === '1') {
      autoOpened.current = true;
      setFormOpen(true);
      router.replace('/groups', { scroll: false });
    }
  }, [searchParams, router]);

  const handleUnsettledOnlyChange = (checked: boolean) => {
    setUnsettledOnly(checked);
    writeUnsettledOnly(checked);
  };

  const { active, archived } = useMemo(() => {
    const all = groups.data ?? [];
    const byBalanceFilter = (g: GroupSummaryDto) =>
      matchesBalanceFilter(g.yourBalancesNative ?? [], balanceFilter);
    return {
      // WI-028: unsettled-only hides settled groups from the active section
      // only — the archived section keeps its existing (unfiltered-by-settled)
      // rules per spec-WI-028's "independent states" AC.
      active: all
        .filter((g) => g.archivedAt === null)
        .filter((g) => !unsettledOnly || !g.settled)
        .filter(byBalanceFilter)
        .sort(byActivity),
      archived: all.filter((g) => g.archivedAt !== null).filter(byBalanceFilter).sort(byActivity),
    };
  }, [groups.data, unsettledOnly, balanceFilter]);

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

      {groups.data && groups.data.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
            <Toggle
              checked={unsettledOnly}
              onChange={handleUnsettledOnlyChange}
              aria-label="Unsettled only"
            />
            Unsettled only
          </label>
          <Select
            aria-label="Filter groups"
            value={balanceFilter}
            onChange={(e) => setBalanceFilter(e.target.value as BalanceFilter)}
            className="w-56"
          >
            {(Object.keys(GROUP_FILTER_LABELS) as BalanceFilter[]).map((f) => (
              <option key={f} value={f}>
                {GROUP_FILTER_LABELS[f]}
              </option>
            ))}
          </Select>
        </div>
      )}

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
      ) : (groups.data?.length ?? 0) === 0 ? (
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
      ) : active.length === 0 && archived.length === 0 ? (
        <EmptyState
          emoji="🔍"
          title="No groups match your filters"
          hint="Try a different balance filter, or turn off “Unsettled only.”"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                handleUnsettledOnlyChange(false);
                setBalanceFilter('none');
              }}
            >
              Clear filters
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

      <GroupSpendChart className="mt-8" />

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
