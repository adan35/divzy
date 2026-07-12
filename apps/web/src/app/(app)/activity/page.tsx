'use client';

import Link from 'next/link';
import { useEffect, useRef, type ReactNode } from 'react';
import { isThisYear, isToday, isYesterday, format, parseISO } from 'date-fns';
import { RefreshCw } from 'lucide-react';
import { formatMoney, type ActivityDto } from '@divzy/shared';
import { useActivityInfinite, errorMessage } from '@/lib/hooks';
import { formatRelative } from '@/lib/format';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonList } from '@/components/ui/skeleton';

// ---------------------------------------------------------------------------
// Payload readers — activity `data` is a loose bag; read it defensively.
// ---------------------------------------------------------------------------

function dataStr(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function dataMoney(data: Record<string, unknown>): string | null {
  const amount = data['amount'];
  const currency = data['currency'];
  if (
    typeof amount === 'number' &&
    Number.isInteger(amount) &&
    typeof currency === 'string' &&
    currency.length === 3
  ) {
    return formatMoney(amount, currency);
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

function Money({ text }: { text: string }) {
  return <span className="font-medium tabular-nums text-ink">{text}</span>;
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
              · <Money text={money} />
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
              <Money text={money} />
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
              of <Money text={money} />
            </>
          )}
          {inGroup}
        </>
      );
    case 'GROUP_CREATED':
      return <>created {group ? <GroupChip group={group} /> : 'a group'}</>;
    case 'GROUP_UPDATED':
      return <>updated {group ? <GroupChip group={group} /> : 'a group'}</>;
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
              · <Money text={money} />
            </>
          )}
        </>
      );
    default:
      return <>made a change{inGroup}</>;
  }
}

function ActivityRow({ activity }: { activity: ActivityDto }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <Avatar user={activity.actor} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-relaxed text-ink-2">
          <span className="font-medium text-ink">{activity.actor.name}</span>{' '}
          {activitySentence(activity)}
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
  const activity = useActivityInfinite(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const items = activity.data?.pages.flatMap((p) => p.items) ?? [];
  const groups = groupByDay(items);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = activity;

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
              <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-ink-3">
                {group.label}
              </h2>
              <Card className="divide-y divide-hairline p-0">
                {group.items.map((a) => (
                  <ActivityRow key={a.id} activity={a} />
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
    </>
  );
}
