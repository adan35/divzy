'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isThisYear, isToday, isYesterday, format, parseISO } from 'date-fns';
import { RefreshCw } from 'lucide-react';
import type { ActivityDto } from '@divzy/shared';
import { useAuth } from '@/lib/auth-store';
import { resolveActivityDestination } from '@/lib/activity-nav';
import { useActivityInfinite, errorMessage } from '@/lib/hooks';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { MoneyText } from '@/components/ui/money-text';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonList } from '@/components/ui/skeleton';
import { ExpenseDetailDialog } from '@/components/expenses/expense-detail';
import { SettlementDetailDialog } from '@/components/settle/settlement-detail';

// ---------------------------------------------------------------------------
// Payload readers — activity `data` is a loose bag; read it defensively.
// ---------------------------------------------------------------------------

function dataStr(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

interface MoneyPayload {
  amount: number;
  currency: string;
}

function dataMoney(data: Record<string, unknown>): MoneyPayload | null {
  const amount = data['amount'];
  const currency = data['currency'];
  if (
    typeof amount === 'number' &&
    Number.isInteger(amount) &&
    typeof currency === 'string' &&
    currency.length === 3
  ) {
    return { amount, currency };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sentence rendering — every ActivityType maps to a natural sentence. The
// group name renders as a chip that links to the group.
// ---------------------------------------------------------------------------

function GroupChip({ group }: { group: NonNullable<ActivityDto['group']> }) {
  return (
    <Link
      href={`/groups/${group.id}`}
      // The chip sits inside a row that is itself clickable (WI-039) — stop
      // the click from also bubbling up to the row's own open-detail handler
      // so a chip click does exactly one thing: go to the group.
      onClick={(e) => e.stopPropagation()}
      className="inline-flex max-w-[16rem] items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 align-middle text-xs font-medium text-ink-2 transition-colors hover:bg-brand-soft hover:text-brand"
    >
      <span aria-hidden="true">{group.emoji}</span>
      <span className="truncate">{group.name}</span>
    </Link>
  );
}

function Desc({ text }: { text: string }) {
  return <span className="font-medium text-ink">&lsquo;{text}&rsquo;</span>;
}

/** AC-4a: every rendered money figure goes through the shared MoneyText. */
function Money({ money }: { money: MoneyPayload }) {
  return <MoneyText amount={money.amount} currency={money.currency} className="font-medium text-ink" />;
}

/** The sentence after the actor's name, e.g. «added 'Groceries' in ✈️ Lisbon · $42.10». */
function activitySentence(activity: ActivityDto): ReactNode {
  const data = activity.data ?? {};
  const desc = dataStr(data, 'description');
  const money = dataMoney(data);
  const group = activity.group;
  const inGroup = group ? (
    <>
      {' '}
      in <GroupChip group={group} />
    </>
  ) : null;

  switch (activity.type) {
    case 'EXPENSE_ADDED':
      return (
        <>
          added {desc ? <Desc text={desc} /> : 'an expense'}
          {inGroup}
          {money && (
            <>
              {' '}
              · <Money money={money} />
            </>
          )}
        </>
      );
    case 'EXPENSE_UPDATED':
      return (
        <>
          updated {desc ? <Desc text={desc} /> : 'an expense'}
          {inGroup}
        </>
      );
    case 'EXPENSE_DELETED':
      return (
        <>
          deleted {desc ? <Desc text={desc} /> : 'an expense'}
          {group && (
            <>
              {' '}
              from <GroupChip group={group} />
            </>
          )}
        </>
      );
    case 'SETTLEMENT_ADDED': {
      const from = dataStr(data, 'fromName');
      const to = dataStr(data, 'toName');
      return (
        <>
          recorded a payment
          {from && to && (
            <>
              {' '}
              — {from} paid {to}
            </>
          )}
          {money && (
            <>
              {' '}
              <Money money={money} />
            </>
          )}
          {inGroup}
        </>
      );
    }
    case 'SETTLEMENT_DELETED':
      return (
        <>
          deleted a payment
          {money && (
            <>
              {' '}
              of <Money money={money} />
            </>
          )}
          {inGroup}
        </>
      );
    case 'GROUP_CREATED':
      return <>created {group ? <GroupChip group={group} /> : 'a group'}</>;
    case 'GROUP_UPDATED': {
      const verb = data?.['deleted'] === true ? 'deleted'
                 : data?.['archived'] === true ? 'archived' : 'updated';
      return <>{verb} {group ? <GroupChip group={group} /> : 'a group'}</>;
    }
    case 'MEMBER_JOINED':
      return <>joined {group ? <GroupChip group={group} /> : 'a group'}</>;
    case 'MEMBER_LEFT':
      return <>left {group ? <GroupChip group={group} /> : 'a group'}</>;
    case 'MEMBER_REMOVED': {
      const member = dataStr(data, 'memberName') ?? dataStr(data, 'name');
      return (
        <>
          removed {member ?? 'a member'}
          {group && (
            <>
              {' '}
              from <GroupChip group={group} />
            </>
          )}
        </>
      );
    }
    case 'COMMENT_ADDED':
      return (
        <>
          commented on {desc ? <Desc text={desc} /> : 'an expense'}
          {inGroup}
        </>
      );
    case 'FRIEND_ADDED': {
      const friend = dataStr(data, 'friendName') ?? dataStr(data, 'name');
      return <>{friend ? `added ${friend} as a friend` : 'added a friend'}</>;
    }
    case 'RECURRING_POSTED':
      return (
        <>
          posted the recurring expense {desc ? <Desc text={desc} /> : ''}
          {inGroup}
          {money && (
            <>
              {' '}
              · <Money money={money} />
            </>
          )}
        </>
      );
    default:
      return <>made a change{inGroup}</>;
  }
}

function ActivityRow({ activity, onOpen }: { activity: ActivityDto; onOpen: () => void }) {
  // WI-054: a struck-through row's original sentence stays (interim
  // click-through to the existing dialog), just visually crossed out — the
  // actor name is left untouched so "who did it" stays legible.
  const deleted = activity.deletedAt !== null;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'flex cursor-pointer items-start gap-3 border-l-2 border-transparent px-4 py-3.5 transition-colors hover:bg-surface-2',
        // WI-055: actor-relative color accent. `deletedAt` forces colorHint
        // null server-side, so this and the strikethrough above are already
        // mutually exclusive — no extra guard needed here.
        activity.colorHint === 'green' && 'border-pos',
        activity.colorHint === 'red' && 'border-neg',
        deleted && 'opacity-60',
      )}
    >
      <Avatar user={activity.actor} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-relaxed text-ink-2">
          <span className="font-medium text-ink">{activity.actor.name}</span>{' '}
          <span className={cn(deleted && 'line-through')}>{activitySentence(activity)}</span>
        </p>
        <p className="mt-0.5 text-xs text-ink-3">{formatRelative(activity.createdAt)}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Day grouping — Today / Yesterday / date dividers.
// ---------------------------------------------------------------------------

interface DayGroup {
  key: string;
  label: string;
  items: ActivityDto[];
}

function dayLabel(date: Date): string {
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return isThisYear(date) ? format(date, 'EEEE, MMM d') : format(date, 'MMM d, yyyy');
}

function groupByDay(items: ActivityDto[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of items) {
    const date = parseISO(item.createdAt);
    const key = format(date, 'yyyy-MM-dd');
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
    } else {
      groups.push({ key, label: dayLabel(date), items: [item] });
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ActivityPage() {
  const router = useRouter();
  const { user: me } = useAuth();
  const activity = useActivityInfinite(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [detailExpenseId, setDetailExpenseId] = useState<string | null>(null);
  const [detailSettlementId, setDetailSettlementId] = useState<string | null>(null);

  const items = activity.data?.pages.flatMap((p) => p.items) ?? [];
  const groups = groupByDay(items);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = activity;

  function openActivity(a: ActivityDto): void {
    const destination = resolveActivityDestination(a, me?.id);
    switch (destination.kind) {
      case 'expense':
        setDetailExpenseId(destination.expenseId);
        break;
      case 'settlement':
        setDetailSettlementId(destination.settlementId);
        break;
      case 'group':
        router.push(`/groups/${destination.groupId}`);
        break;
      case 'friend':
        router.push(`/friends/${destination.friendId}`);
        break;
      case 'friends':
        router.push('/friends');
        break;
    }
  }

  // Auto-load the next page as the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: '320px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length]);

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="Everything that happened across your groups and friends."
      />

      {activity.isPending ? (
        <SkeletonList rows={6} />
      ) : activity.isError ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="max-w-sm text-sm text-ink-2">{errorMessage(activity.error)}</p>
          <Button variant="outline" size="sm" onClick={() => void activity.refetch()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          emoji="🧾"
          title="No activity yet"
          hint="Add an expense or record a payment — every change shows up here, for everyone involved."
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key} aria-label={group.label}>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.06em] text-ink-3">
                {group.label}
              </h2>
              <Card className="divide-y divide-hairline p-0">
                {group.items.map((a) => (
                  <ActivityRow key={a.id} activity={a} onOpen={() => openActivity(a)} />
                ))}
              </Card>
            </section>
          ))}

          <div ref={sentinelRef} aria-hidden="true" />

          {hasNextPage ? (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                loading={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              >
                Show older activity
              </Button>
            </div>
          ) : (
            <p className="pb-2 text-center text-[13px] text-ink-3">
              That&rsquo;s everything — you&rsquo;re fully caught up 🎉
            </p>
          )}
        </div>
      )}

      <ExpenseDetailDialog
        expenseId={detailExpenseId ?? ''}
        open={detailExpenseId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailExpenseId(null);
        }}
      />

      <SettlementDetailDialog
        settlementId={detailSettlementId ?? ''}
        open={detailSettlementId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailSettlementId(null);
        }}
      />
    </>
  );
}
