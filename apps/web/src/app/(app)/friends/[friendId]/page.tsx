'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  HandCoins,
  MoreVertical,
  Plus,
  RefreshCw,
  UserMinus,
} from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@divzy/api-client';
import { useFriend, useRemoveFriend, errorMessage } from '@/lib/hooks';
import { useAuth } from '@/lib/auth-store';
import { collapsedBalanceEntries } from '@/lib/balance-display';
import { friendSettleIntent } from '@/lib/settle-prefill';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { FallbackRatesNotice } from '@/components/ui/fallback-rates-notice';
import { MoneyText } from '@/components/ui/money-text';
import { Skeleton } from '@/components/ui/skeleton';
import { BalanceSentence } from '@/components/friends/balance-sentence';
import { SettlementsSection } from '@/components/friends/settlements-section';
import { ConfirmDialog } from '@/components/groups/confirm-dialog';
import { ExpenseEditorDialog } from '@/components/expenses/expense-editor';
import { ExpenseList } from '@/components/expenses/expense-list';
import { SettleUpDialog } from '@/components/settle/settle-dialog';

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * WI-070: header-only loading placeholder. `ExpenseList`/`SettlementsSection`
 * below mount off the route's `friendId` regardless of `useFriend`'s state
 * (each has its own internal loading/error treatment already), so only this
 * friend-dependent chrome (name, avatar, balance, actions) needs a stand-in
 * while the single-friend read is still in flight.
 */
function FriendHeaderSkeleton() {
  return (
    <div className="mb-6 flex items-center gap-4 rounded-xl2 border border-hairline bg-surface p-5">
      <Skeleton className="h-12 w-12 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-3.5 w-56" />
      </div>
      <Skeleton className="h-10 w-28 rounded-[10px]" />
    </div>
  );
}

export default function FriendDetailPage() {
  const params = useParams<{ friendId: string }>();
  const friendId = typeof params.friendId === 'string' ? params.friendId : '';
  const router = useRouter();
  const { user: me } = useAuth();

  const friendQuery = useFriend(friendId);
  const removeFriend = useRemoveFriend();
  const [settleOpen, setSettleOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  // WI-070: the new single-friend read's 404 FRIENDSHIP_NOT_FOUND is the same
  // "not in your friends yet" case the old `friends.data.find()` returning
  // undefined used to produce — keep the same distinct empty state, not the
  // generic "couldn't load" error card.
  const notAFriend =
    friendQuery.isError &&
    friendQuery.error instanceof ApiError &&
    friendQuery.error.code === 'FRIENDSHIP_NOT_FOUND';

  if (notAFriend) {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="text-3xl" aria-hidden="true">
          👀
        </div>
        <h1 className="text-[15px] font-semibold text-ink">Not in your friends yet</h1>
        <p className="max-w-sm text-sm text-ink-2">
          This person isn&rsquo;t in your friends list. Add them by email or share an expense with
          them first.
        </p>
        <Button variant="ghost" size="sm" onClick={() => router.push('/friends')}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to friends
        </Button>
      </Card>
    );
  }

  if (friendQuery.isError) {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="text-3xl" aria-hidden="true">
          😕
        </div>
        <h1 className="text-[15px] font-semibold text-ink">Couldn&rsquo;t load this friend</h1>
        <p className="max-w-sm text-sm text-ink-2">{errorMessage(friendQuery.error)}</p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void friendQuery.refetch()}>
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

  const friend = friendQuery.data;

  // Display: the one converted figure (if any) plus any currencies that had
  // no resolvable rate — spec-WI-001's rendering contract, identical to the
  // Groups list / Friends preview.
  const displayEntries = friend
    ? collapsedBalanceEntries(friend.balancesConverted, friend.balances)
    : [];
  const short = friend ? firstName(friend.user.name) : '';

  // WI-050: prefill/gate logic extracted to a shared, pure, unit-tested
  // helper (lib/settle-prefill.ts) so the dashboard Friends-row opener
  // (friends-preview.tsx) can reuse it verbatim instead of duplicating it.
  // See settle-prefill.ts for the WI-012/WI-001 provenance of this logic.
  const { disabled: nothingOutstanding, prefill } = friend
    ? friendSettleIntent(friend, me)
    : { disabled: true, prefill: undefined };

  // WI-066: a single onError handler at the call site (not the hook — see
  // useRemoveFriend's doc comment for why) so a 404 FRIENDSHIP_NOT_FOUND can
  // be special-cased as "already removed" without double-toasting.
  const handleRemove = () => {
    if (!friend) return;
    removeFriend.mutate(friend.user.id, {
      onSuccess: () => {
        setRemoveOpen(false);
        toast.success(`Removed ${friend.user.name} from your friends`);
        router.push('/friends');
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'FRIENDSHIP_NOT_FOUND') {
          setRemoveOpen(false);
          toast.info("You're no longer friends");
          router.push('/friends');
          return;
        }
        // 409 OUTSTANDING_BALANCE and anything else: verbatim server message,
        // stay on the page with the dialog open so the user can cancel or
        // retry after settling up.
        toast.error(errorMessage(error));
      },
    });
  };

  return (
    <>
      <Link
        href="/friends"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Friends
      </Link>

      {friend ? (
        <Card className="mb-6 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3.5">
              <Avatar user={friend.user} size="lg" />
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold tracking-tight text-ink">
                  {friend.user.name}
                </h1>
                <div className="mt-1.5 space-y-1.5">
                  {displayEntries.length === 0 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-pos-soft px-2.5 py-1 text-[13px] font-medium text-pos">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      You and {short} are all settled up
                    </span>
                  ) : (
                    <>
                      {/* WI-068 §3: chip-style balance header — the primary
                          (first) entry counts up on change, mirroring the
                          Pulse hero's figure treatment at friend-detail scale. */}
                      <MoneyText
                        amount={displayEntries[0]!.amount}
                        currency={displayEntries[0]!.currency}
                        mode="signed-color"
                        animate
                        className="block text-2xl font-semibold"
                      />
                      <div className="space-y-0.5">
                        {displayEntries.map((b) => (
                          <p key={b.currency} className="text-sm">
                            <BalanceSentence name={short} amount={b.amount} currency={b.currency} />
                          </p>
                        ))}
                        {friend.usedFallbackRates && <FallbackRatesNotice className="text-[11px]" />}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* WI-068: prominence follows outstanding-ness — a filled primary
                  button when there's something to settle, outline once
                  disabled/settled. The WI-012 gate (disabled={nothingOutstanding})
                  itself is untouched. */}
              <Button
                variant={nothingOutstanding ? 'outline' : 'primary'}
                disabled={nothingOutstanding}
                onClick={() => setSettleOpen(true)}
              >
                <HandCoins className="h-4 w-4" aria-hidden="true" />
                Settle up
              </Button>
              <Button onClick={() => setEditorOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add expense
              </Button>
              <Dropdown
                align="end"
                trigger={
                  <span
                    aria-label="Friend menu"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    <MoreVertical className="h-5 w-5" aria-hidden="true" />
                  </span>
                }
              >
                <DropdownItem icon={<UserMinus />} danger onSelect={() => setRemoveOpen(true)}>
                  Remove friend
                </DropdownItem>
              </Dropdown>
            </div>
          </div>
        </Card>
      ) : (
        <FriendHeaderSkeleton />
      )}

      <div className="space-y-8">
        <section aria-label="Shared expenses">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">
            Shared expenses
          </h2>
          {/* WI-070: mounts off the route's friendId directly (not
              friend.user.id) so it starts fetching in parallel with
              useFriend, instead of waiting for it to resolve first. */}
          <ExpenseList
            friendId={friendId}
            emptyHint={
              short
                ? `Expenses you share with ${short} — in any group or just the two of you — appear here.`
                : 'Expenses you share — in any group or just the two of you — appear here.'
            }
          />
        </section>

        {/* WI-070: same parallel-mount fix as ExpenseList above. */}
        <SettlementsSection friendId={friendId} />
      </div>

      {friend && (
        <>
          <SettleUpDialog open={settleOpen} onOpenChange={setSettleOpen} prefill={prefill} />
          <ExpenseEditorDialog
            open={editorOpen}
            onOpenChange={setEditorOpen}
            friendUserId={friend.user.id}
          />

          <ConfirmDialog
            open={removeOpen}
            onOpenChange={(open) => {
              if (!removeFriend.isPending) setRemoveOpen(open);
            }}
            title={`Remove ${short}?`}
            description="They'll be removed from your friends list. Your shared expense and settlement history stays intact, and you can add them back anytime. You can only remove a friend once you're settled up with them in every currency."
            confirmLabel="Remove friend"
            destructive
            loading={removeFriend.isPending}
            onConfirm={handleRemove}
          />
        </>
      )}
    </>
  );
}
