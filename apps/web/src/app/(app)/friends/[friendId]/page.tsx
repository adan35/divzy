'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, HandCoins, Plus, RefreshCw } from 'lucide-react';
import { useFriends, errorMessage } from '@/lib/hooks';
import { useAuth } from '@/lib/auth-store';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton, SkeletonList } from '@/components/ui/skeleton';
import { BalanceSentence } from '@/components/friends/balance-sentence';
import { SettlementsSection } from '@/components/friends/settlements-section';
import { ExpenseEditorDialog } from '@/components/expenses/expense-editor';
import { ExpenseList } from '@/components/expenses/expense-list';
import { SettleUpDialog, type SettleUpPrefill } from '@/components/settle/settle-dialog';

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function FriendPageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-28" />
      <div className="flex items-center gap-4 rounded-xl2 border border-hairline bg-surface p-5">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-3.5 w-56" />
        </div>
        <Skeleton className="h-10 w-28 rounded-[10px]" />
      </div>
      <SkeletonList rows={4} />
    </div>
  );
}

export default function FriendDetailPage() {
  const params = useParams<{ friendId: string }>();
  const friendId = typeof params.friendId === 'string' ? params.friendId : '';
  const router = useRouter();
  const { user: me } = useAuth();

  const friends = useFriends();
  const [settleOpen, setSettleOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  if (friends.isPending) {
    return <FriendPageSkeleton />;
  }

  if (friends.isError) {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="text-3xl" aria-hidden="true">
          😕
        </div>
        <h1 className="text-[15px] font-semibold text-ink">Couldn&rsquo;t load this friend</h1>
        <p className="max-w-sm text-sm text-ink-2">{errorMessage(friends.error)}</p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void friends.refetch()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
          <Button variant="ghost" size="sm" onClick={() => router.push('/friends')}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to friends
          </Button>
        </div>
      </Card>
    );
  }

  const friend = friends.data.find((f) => f.user.id === friendId);

  if (!friend) {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="text-3xl" aria-hidden="true">
          👀
        </div>
        <h1 className="text-[15px] font-semibold text-ink">Not in your friends yet</h1>
        <p className="max-w-sm text-sm text-ink-2">
          This person isn&rsquo;t in your friends list. Add them by email or share an expense
          with them first.
        </p>
        <Button variant="ghost" size="sm" onClick={() => router.push('/friends')}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to friends
        </Button>
      </Card>
    );
  }

  const nonZero = friend.balances.filter((b) => b.amount !== 0);
  const short = firstName(friend.user.name);

  // Prefill the settle dialog: exact direction + amount when there's a single
  // outstanding currency; otherwise just preselect the two of you.
  let prefill: SettleUpPrefill | undefined;
  if (me) {
    const only = nonZero.length === 1 ? nonZero[0] : undefined;
    if (only && only.amount > 0) {
      prefill = {
        fromUserId: friend.user.id,
        toUserId: me.id,
        amount: only.amount,
        currency: only.currency,
      };
    } else if (only && only.amount < 0) {
      prefill = {
        fromUserId: me.id,
        toUserId: friend.user.id,
        amount: -only.amount,
        currency: only.currency,
      };
    } else {
      prefill = {
        fromUserId: me.id,
        toUserId: friend.user.id,
        amount: 0,
        currency: me.defaultCurrency,
      };
    }
  }

  return (
    <>
      <Link
        href="/friends"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Friends
      </Link>

      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <Avatar user={friend.user} size="lg" />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight text-ink">
                {friend.user.name}
              </h1>
              <div className="mt-1 space-y-0.5">
                {nonZero.length === 0 ? (
                  <p className="text-sm text-ink-3">You and {short} are all settled up ✨</p>
                ) : (
                  nonZero.map((b) => (
                    <p key={b.currency} className="text-sm">
                      <BalanceSentence name={short} amount={b.amount} currency={b.currency} />
                    </p>
                  ))
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" onClick={() => setSettleOpen(true)}>
              <HandCoins className="h-4 w-4" aria-hidden="true" />
              Settle up
            </Button>
            <Button onClick={() => setEditorOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add expense
            </Button>
          </div>
        </div>
      </Card>

      <div className="space-y-8">
        <section aria-label="Shared expenses">
          <h2 className="mb-3 text-[15px] font-semibold text-ink">Shared expenses</h2>
          <ExpenseList
            friendId={friend.user.id}
            emptyHint={`Expenses you share with ${short} — in any group or just the two of you — appear here.`}
          />
        </section>

        <SettlementsSection friendId={friend.user.id} />
      </div>

      <SettleUpDialog open={settleOpen} onOpenChange={setSettleOpen} prefill={prefill} />
      <ExpenseEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        friendUserId={friend.user.id}
      />
    </>
  );
}
