'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronRight, RefreshCw, UserPlus } from 'lucide-react';
import type { FriendDto } from '@divzy/shared';
import { useFriends, errorMessage } from '@/lib/hooks';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonList } from '@/components/ui/skeleton';
import { AddFriendDialog } from '@/components/friends/add-friend-dialog';
import { BalanceSentence } from '@/components/friends/balance-sentence';

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function FriendRow({ friend }: { friend: FriendDto }) {
  const nonZero = friend.balances.filter((b) => b.amount !== 0);
  const visible = nonZero.slice(0, 2);
  const more = nonZero.length - visible.length;

  return (
    <Link
      href={`/friends/${friend.user.id}`}
      className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2"
    >
      <Avatar user={friend.user} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{friend.user.name}</p>
        {nonZero.length === 0 ? (
          <p className="text-[13px] text-ink-3">Settled up</p>
        ) : (
          <>
            {visible.map((b) => (
              <p key={b.currency} className="truncate text-[13px]">
                <BalanceSentence
                  name={firstName(friend.user.name)}
                  amount={b.amount}
                  currency={b.currency}
                />
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
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
    </Link>
  );
}

export default function FriendsPage() {
  const friends = useFriends();
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Friends"
        subtitle="Everyone you split with, and where you stand."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Add friend
          </Button>
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
        <Card className="divide-y divide-hairline p-0">
          {friends.data.map((f) => (
            <FriendRow key={f.user.id} friend={f} />
          ))}
        </Card>
      )}

      <AddFriendDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}
