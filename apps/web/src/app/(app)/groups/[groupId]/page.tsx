'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Archive, ArrowLeft, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  errorMessage,
  useArchiveGroup,
  useDeleteGroup,
  useGroup,
  useGroupBalances,
  useLeaveGroup,
  useUnarchiveGroup,
} from '@/lib/hooks';
import { useAuth } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BalancesView } from '@/components/groups/balances-view';
import { ConfirmDialog } from '@/components/groups/confirm-dialog';
import { GroupFormDialog } from '@/components/groups/group-form-dialog';
import { GroupHeader } from '@/components/groups/group-header';
import { GroupWhiteboard } from '@/components/groups/group-whiteboard';
import { InviteDialog } from '@/components/groups/invite-dialog';
import { TotalsView } from '@/components/groups/totals-view';
import { ExpenseEditorDialog } from '@/components/expenses/expense-editor';
import { ExpenseList } from '@/components/expenses/expense-list';
import { SettleUpDialog, type SettleUpPrefill } from '@/components/settle/settle-dialog';

/**
 * WI-070: header-only loading placeholder. `<Tabs>` and its content
 * (ExpenseList/BalancesView/TotalsView) mount off the route's groupId
 * regardless of `useGroup`'s state — each already has its own internal
 * loading treatment — so only this group-dependent chrome (name, emoji,
 * member avatars, actions) needs a stand-in while the group fetch is still
 * in flight.
 */
function GroupHeaderSkeleton() {
  return (
    <div className="mb-6 flex items-center gap-4">
      <Skeleton className="h-12 w-12 rounded-xl" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-6 w-52" />
        <Skeleton className="h-3.5 w-36" />
      </div>
      <Skeleton className="h-10 w-24 rounded-[10px]" />
    </div>
  );
}

type GroupTab = 'expenses' | 'balances' | 'totals' | 'whiteboard';

export default function GroupPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = typeof params.groupId === 'string' ? params.groupId : '';
  const router = useRouter();
  const { user: me } = useAuth();

  const groupQuery = useGroup(groupId);
  const balancesQuery = useGroupBalances(groupId);
  const archiveGroup = useArchiveGroup();
  const leaveGroup = useLeaveGroup();
  const unarchiveGroup = useUnarchiveGroup();
  const deleteGroup = useDeleteGroup();

  const [tab, setTab] = useState<GroupTab>('expenses');
  const [settleOpen, setSettleOpen] = useState(false);
  const [settlePrefill, setSettlePrefill] = useState<SettleUpPrefill | undefined>(undefined);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  // WI-070: the full-page error/not-found card is unchanged and still gates
  // every group-scoped child (a non-member 404 must never reach a point
  // where Tabs/ExpenseList/BalancesView/TotalsView or any dialog mounts).
  // Only the plain in-flight loading case (isLoading, no error yet) no
  // longer full-page-returns here — see the group !== undefined ? ... below,
  // which renders a header-only placeholder while still mounting <Tabs> off
  // the route's groupId in parallel with this query.
  if (groupQuery.isError || (!groupQuery.isLoading && !groupQuery.data)) {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="text-3xl" aria-hidden="true">
          😕
        </div>
        <h1 className="text-[15px] font-semibold text-ink">Couldn&rsquo;t load this group</h1>
        <p className="max-w-sm text-sm text-ink-2">
          {groupQuery.error ? errorMessage(groupQuery.error) : 'The group could not be found.'}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void groupQuery.refetch()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
          <Button variant="ghost" size="sm" onClick={() => router.push('/groups')}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to groups
          </Button>
        </div>
      </Card>
    );
  }

  // WI-070: group is possibly undefined here — only while groupQuery is
  // still loading (the isError/no-data terminal case already returned above).
  const group = groupQuery.data;
  const iOwe =
    me !== null &&
    (balancesQuery.data?.members
      .find((m) => m.user.id === me.id)
      ?.balances.some((b) => b.amount < 0) ??
      false);
  const isAdmin =
    group !== undefined &&
    me !== null &&
    group.members.some((m) => m.user.id === me.id && m.role === 'ADMIN');
  const archived = group !== undefined && group.archivedAt !== null;

  const handleArchive = () => {
    if (!group) return;
    archiveGroup.mutate(group.id, {
      onSuccess: () => {
        setArchiveOpen(false);
        toast.success(`${group.emoji} ${group.name} archived`);
        router.push('/groups');
      },
    });
  };

  const handleLeave = () => {
    if (!group) return;
    leaveGroup.mutate(group.id, {
      onSuccess: () => {
        setLeaveOpen(false);
        toast.success(`You left ${group.name}`);
        router.push('/groups');
      },
      // Errors (e.g. OUTSTANDING_BALANCE) surface via the hook's toast with the
      // API message verbatim; the dialog stays open so the user can cancel.
    });
  };

  const handleDelete = () => {
    if (!group) return;
    deleteGroup.mutate(group.id, {
      onSuccess: () => {
        setDeleteOpen(false);
        toast.success(`${group.emoji} ${group.name} deleted`);
        router.push('/groups');
      },
      // 403 FORBIDDEN / 409 OUTSTANDING_BALANCE / 404 all surface via the
      // hook's toast with the API message verbatim (same pattern as
      // handleArchive/handleLeave) — the dialog stays open so the admin can
      // settle up (or cancel) and retry.
    });
  };

  return (
    <>
      {group ? (
        <GroupHeader
          group={group}
          isAdmin={isAdmin}
          iOwe={iOwe}
          onSettleUp={() => setSettleOpen(true)}
          onInvite={() => setInviteOpen(true)}
          onEdit={() => setEditOpen(true)}
          onArchive={() => setArchiveOpen(true)}
          onLeave={() => setLeaveOpen(true)}
          onDelete={() => setDeleteOpen(true)}
        />
      ) : (
        <GroupHeaderSkeleton />
      )}

      {group && archived && (
        <div className="mb-6 flex flex-wrap items-center gap-2.5 rounded-xl bg-warn-soft px-4 py-3">
          <Archive className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          <p className="flex-1 text-sm text-warn">
            This group is archived — it&rsquo;s read-only for everyone.
          </p>
          {/* WI-027: ADMIN-gated in UI (server assertAdmin is authoritative). */}
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              loading={unarchiveGroup.isPending}
              onClick={() =>
                unarchiveGroup.mutate(group.id, {
                  onSuccess: () => toast.success(`${group.emoji} ${group.name} unarchived`),
                })
              }
            >
              Unarchive
            </Button>
          )}
        </div>
      )}

      {/* WI-070: Tabs + ExpenseList/BalancesView/TotalsView mount off the
          route's groupId directly, so their own queries fire in parallel
          with useGroup instead of waiting for it to resolve first. Each
          already has its own internal loading/error treatment. */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as GroupTab)}>
        <TabsList>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="balances">Balances</TabsTrigger>
          <TabsTrigger value="totals">Totals</TabsTrigger>
          <TabsTrigger value="whiteboard">Whiteboard</TabsTrigger>
        </TabsList>

        <TabsContent value="expenses">
          <div className="space-y-4">
            {group && !archived && (
              <div className="flex justify-end">
                <Button onClick={() => setEditorOpen(true)}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add expense
                </Button>
              </div>
            )}
            <ExpenseList
              groupId={groupId}
              emptyHint="Add the first expense to start splitting fairly."
            />
          </div>
        </TabsContent>

        <TabsContent value="balances">
          <BalancesView groupId={groupId} />
        </TabsContent>

        <TabsContent value="totals">
          <TotalsView groupId={groupId} />
        </TabsContent>

        <TabsContent value="whiteboard" forceMount>
          <GroupWhiteboard groupId={groupId} enabled={tab === 'whiteboard'} />
        </TabsContent>
      </Tabs>

      <ExpenseEditorDialog open={editorOpen} onOpenChange={setEditorOpen} groupId={groupId} />

      {group && (
        <>
          <SettleUpDialog
            open={settleOpen}
            onOpenChange={(open) => {
              setSettleOpen(open);
              if (!open) setSettlePrefill(undefined);
            }}
            groupId={group.id}
            prefill={settlePrefill}
            initialView="list"
          />
          <InviteDialog
            open={inviteOpen}
            onOpenChange={setInviteOpen}
            group={group}
            isAdmin={isAdmin}
          />
          <GroupFormDialog open={editOpen} onOpenChange={setEditOpen} group={group} />

          <ConfirmDialog
            open={archiveOpen}
            onOpenChange={(open) => {
              if (!archiveGroup.isPending) setArchiveOpen(open);
            }}
            title={`Archive ${group.name}?`}
            description="The group becomes read-only and moves to your archived list. Balances and history are kept."
            confirmLabel="Archive group"
            destructive
            loading={archiveGroup.isPending}
            onConfirm={handleArchive}
          />
          <ConfirmDialog
            open={leaveOpen}
            onOpenChange={(open) => {
              if (!leaveGroup.isPending) setLeaveOpen(open);
            }}
            title={`Leave ${group.name}?`}
            description="You lose access unless someone re-invites you. You can only leave once you're settled up in every currency."
            confirmLabel="Leave group"
            destructive
            loading={leaveGroup.isPending}
            onConfirm={handleLeave}
          />
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={(open) => {
              if (!deleteGroup.isPending) setDeleteOpen(open);
            }}
            title={`Delete ${group.name}?`}
            description="This permanently deletes the group for everyone. All expenses, balances, and history are kept for the record, but the group itself cannot be recovered. This cannot be undone from the app."
            confirmLabel="Delete group"
            destructive
            loading={deleteGroup.isPending}
            onConfirm={handleDelete}
          />
        </>
      )}
    </>
  );
}
