'use client';

import type { FriendDto } from '@divzy/shared';
import { useFriends } from '@/lib/hooks';
import { balanceSentence } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonList } from '@/components/ui/skeleton';
import { balanceMagnitude } from './balance-utils';
import { SectionError } from './section-error';
import { SectionHeader } from './section-header';

const PREVIEW_COUNT = 4;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function FriendRow({ friend }: { friend: FriendDto }) {
  const nonZero = friend.balances
    .filter((b) => b.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const visible = nonZero.slice(0, 2);
  const more = nonZero.length - visible.length;

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Avatar user={friend.user} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{friend.user.name}</p>
        {nonZero.length === 0 ? (
          <p className="text-[13px] text-ink-3">Settled up</p>
        ) : (
          <>
            {visible.map((b) => (
              <p
                key={b.currency}
                className={cn(
                  'truncate text-[13px] tabular-nums',
                  b.amount > 0 ? 'text-pos' : 'text-neg',
                )}
              >
                {balanceSentence(firstName(friend.user.name), b.amount, b.currency)}
              </p>
            ))}
            {more > 0 && (
              <p className="text-xs text-ink-3">
                +{more} more {more === 1 ? 'currency' : 'currencies'}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** "Friends" preview — top friends by |balance| with balance sentences. */
export function FriendsPreview() {
  const friends = useFriends();

  const top = [...(friends.data ?? [])]
    .sort(
      (a, b) =>
        balanceMagnitude(b.balances) - balanceMagnitude(a.balances) ||
        a.user.name.localeCompare(b.user.name),
    )
    .slice(0, PREVIEW_COUNT);

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
            <FriendRow key={f.user.id} friend={f} />
          ))}
        </Card>
      )}
    </section>
  );
}
