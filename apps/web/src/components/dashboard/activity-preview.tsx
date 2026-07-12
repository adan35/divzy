'use client';

import type { ActivityDto } from '@divzy/shared';
import { formatMoney } from '@divzy/shared';
import { useActivityInfinite } from '@/lib/hooks';
import { formatRelative } from '@/lib/format';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonList } from '@/components/ui/skeleton';
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
    case 'GROUP_UPDATED':
      return groupName ? `updated ${groupName}` : 'updated a group';
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

function ActivityRow({ activity }: { activity: ActivityDto }) {
  const showGroup = activity.group !== null && !GROUP_IN_SENTENCE.has(activity.type);
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Avatar user={activity.actor} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug text-ink-2">
          <span className="font-medium text-ink">{activity.actor.name}</span>{' '}
          {activitySentence(activity)}
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

/** "Recent activity" — the first few items of the user's activity feed. */
export function ActivityPreview() {
  const activity = useActivityInfinite(null);
  const items = (activity.data?.pages[0]?.items ?? []).slice(0, PREVIEW_COUNT);

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
            <ActivityRow key={a.id} activity={a} />
          ))}
        </Card>
      )}
    </section>
  );
}
