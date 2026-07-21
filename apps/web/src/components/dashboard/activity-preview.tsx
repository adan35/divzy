'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ActivityDto } from '@divzy/shared';
import { formatMoney } from '@divzy/shared';
import { useAuth } from '@/lib/auth-store';
import { resolveActivityDestination } from '@/lib/activity-nav';
import { useActivityInfinite } from '@/lib/hooks';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonList } from '@/components/ui/skeleton';
import { ExpenseDetailDialog } from '@/components/expenses/expense-detail';
import { SettlementDetailDialog } from '@/components/settle/settlement-detail';
import { SectionError } from './section-error';
import { SectionHeader } from './section-header';

const PREVIEW_COUNT = 8;

function dataStr(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** "$12.50" when the payload carries a valid amount + currency, else null. */
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

/** Human sentence for an activity row; the actor's name is rendered separately. */
function activitySentence(activity: ActivityDto): string {
  const data = activity.data ?? {};
  const desc = dataStr(data, 'description');
  const money = dataMoney(data);
  const groupName = activity.group?.name ?? null;

  switch (activity.type) {
    case 'EXPENSE_ADDED':
      return desc
        ? `added “${desc}”${money ? ` · ${money}` : ''}`
        : 'added an expense';
    case 'EXPENSE_UPDATED':
      return desc ? `updated “${desc}”` : 'updated an expense';
    case 'EXPENSE_DELETED':
      return desc ? `deleted “${desc}”` : 'deleted an expense';
    case 'SETTLEMENT_ADDED': {
      const from = dataStr(data, 'fromName');
      const to = dataStr(data, 'toName');
      if (from && to) {
        return `recorded a payment — ${from} paid ${to}${money ? ` ${money}` : ''}`;
      }
      return money ? `recorded a payment of ${money}` : 'recorded a payment';
    }
    case 'SETTLEMENT_DELETED':
      return 'deleted a payment';
    case 'GROUP_CREATED':
      return groupName ? `created ${groupName}` : 'created a group';
    case 'GROUP_UPDATED': {
      const verb = data?.['deleted'] === true ? 'deleted'
                 : data?.['archived'] === true ? 'archived' : 'updated';
      return groupName ? `${verb} ${groupName}` : `${verb} a group`;
    }
    case 'MEMBER_JOINED':
      return groupName ? `joined ${groupName}` : 'joined a group';
    case 'MEMBER_LEFT':
      return groupName ? `left ${groupName}` : 'left a group';
    case 'MEMBER_REMOVED': {
      const member = dataStr(data, 'memberName') ?? dataStr(data, 'name');
      return `removed ${member ?? 'a member'}${groupName ? ` from ${groupName}` : ''}`;
    }
    case 'COMMENT_ADDED':
      return desc ? `commented on “${desc}”` : 'added a comment';
    case 'FRIEND_ADDED': {
      const friend = dataStr(data, 'friendName') ?? dataStr(data, 'name');
      return friend ? `added ${friend} as a friend` : 'added a friend';
    }
    case 'RECURRING_POSTED':
      return desc
        ? `posted the recurring expense “${desc}”${money ? ` · ${money}` : ''}`
        : 'posted a recurring expense';
    default:
      return 'made a change';
  }
}

/** Types whose sentence already names the group — skip the group chip line. */
const GROUP_IN_SENTENCE: ReadonlySet<ActivityDto['type']> = new Set([
  'GROUP_CREATED',
  'GROUP_UPDATED',
  'MEMBER_JOINED',
  'MEMBER_LEFT',
  'MEMBER_REMOVED',
]);

function ActivityRow({ activity, onOpen }: { activity: ActivityDto; onOpen: () => void }) {
  const showGroup = activity.group !== null && !GROUP_IN_SENTENCE.has(activity.type);
  // WI-054: forked copy of the same strikethrough treatment as
  // app/(app)/activity/page.tsx's ActivityRow — kept independent per spec.
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
        'flex cursor-pointer items-start gap-3 border-l-2 border-transparent px-4 py-3 transition-colors hover:bg-surface-2',
        // WI-055: same actor-relative accent as the full activity page.
        activity.colorHint === 'green' && 'border-pos',
        activity.colorHint === 'red' && 'border-neg',
        deleted && 'opacity-60',
      )}
    >
      <Avatar user={activity.actor} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug text-ink-2">
          <span className="font-medium text-ink">{activity.actor.name}</span>{' '}
          <span className={cn(deleted && 'line-through')}>{activitySentence(activity)}</span>
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-3">
          {showGroup && activity.group
            ? `${activity.group.emoji} ${activity.group.name} · `
            : ''}
          {formatRelative(activity.createdAt)}
        </p>
      </div>
    </div>
  );
}

/**
 * "Recent activity" — the first few items of the user's activity feed.
 * Rows are clickable (WI-039 / ADR-022 §3): expense-backed items open the
 * existing expense detail dialog in place; everything else routes to its
 * existing surface (group, friend, or the friends list as a safe fallback).
 */
export function ActivityPreview() {
  const router = useRouter();
  const { user: me } = useAuth();
  const activity = useActivityInfinite(null);
  const [detailExpenseId, setDetailExpenseId] = useState<string | null>(null);
  const [detailSettlementId, setDetailSettlementId] = useState<string | null>(null);
  const items = (activity.data?.pages[0]?.items ?? []).slice(0, PREVIEW_COUNT);

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

  return (
    <section aria-label="Recent activity">
      <SectionHeader title="Recent activity" href="/activity" />
      {activity.isPending ? (
        <SkeletonList rows={4} />
      ) : activity.isError ? (
        <SectionError error={activity.error} onRetry={() => void activity.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          emoji="🧾"
          title="No activity yet"
          hint="Expenses, payments and group changes will show up here."
          className="py-10"
        />
      ) : (
        <Card className="divide-y divide-hairline p-0">
          {items.map((a) => (
            <ActivityRow key={a.id} activity={a} onOpen={() => openActivity(a)} />
          ))}
        </Card>
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
    </section>
  );
}
