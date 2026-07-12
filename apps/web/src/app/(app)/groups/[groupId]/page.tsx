'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Archive,
  ArrowLeft,
  Download,
  LogOut,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { GROUP_TYPES, type GroupDto, type GroupType } from '@divzy/shared';
import { api } from '@/lib/api';
import {
  errorMessage,
  useArchiveGroup,
  useGroup,
  useLeaveGroup,
} from '@/lib/hooks';
import { useAuth } from '@/lib/auth-store';
import { AvatarStack } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dropdown,
  DropdownItem,
  DropdownSeparator,
} from '@/components/ui/dropdown';
import { Skeleton, SkeletonList } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BalancesView } from '@/components/groups/balances-view';
import { ConfirmDialog } from '@/components/groups/confirm-dialog';
import { GroupFormDialog } from '@/components/groups/group-form-dialog';
import { InviteDialog } from '@/components/groups/invite-dialog';
import { TotalsView } from '@/components/groups/totals-view';
import { ExpenseEditorDialog } from '@/components/expenses/expense-editor';
import { ExpenseList } from '@/components/expenses/expense-list';

function typeLabel(type: GroupType): string {
  return GROUP_TYPES.find((t) => t.key === type)?.label ?? 'Other';
}

function csvFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'group'}-expenses.csv`;
}

function GroupPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-12 w-12 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-52" />
          <Skeleton className="h-3.5 w-36" />
        </div>
        <Skeleton className="h-10 w-24 rounded-[10px]" />
      </div>
      <Skeleton className="h-9 w-64" />
      <SkeletonList rows={4} />
    </div>
  );
}

type GroupTab = 'expenses' | 'balances' | 'totals';

function GroupHeader({
  group,
  isAdmin,
  onInvite,
  onEdit,
  onArchive,
  onLeave,
}: {
  group: GroupDto;
  isAdmin: boolean;
  onInvite: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onLeave: () => void;
}) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const csv = await api.groups.exportCsv(group.id);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = csvFilename(group.name);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success('CSV downloaded');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3.5">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-[26px]"
          aria-hidden="true"
        >
          {group.emoji}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-ink lg:text-2xl">
            {group.name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
            <span>
              {typeLabel(group.type)} · {group.members.length} member
              {group.members.length === 1 ? '' : 's'}
            </span>
            <AvatarStack users={group.members.map((m) => m.user)} size="xs" max={6} />
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="outline" onClick={onInvite}>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Invite
        </Button>
        <Dropdown
          align="end"
          trigger={
            <span
              aria-label="Group settings"
              className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <MoreVertical className="h-5 w-5" aria-hidden="true" />
            </span>
          }
        >
          <DropdownItem icon={<Pencil />} onSelect={onEdit}>
            Edit group
          </DropdownItem>
          <DropdownItem
            icon={<Download />}
            onSelect={() => void handleExport()}
            disabled={exporting}
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </DropdownItem>
          <DropdownSeparator />
          {isAdmin && group.archivedAt === null && (
            <DropdownItem icon={<Archive />} onSelect={onArchive}>
              Archive group
            </DropdownItem>
          )}
          <DropdownItem icon={<LogOut />} danger onSelect={onLeave}>
            Leave group
          </DropdownItem>
        </Dropdown>
      </div>
    </div>
  );
}

export default function GroupPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = typeof params.groupId === 'string' ? params.groupId : '';
  const router = useRouter();
  const { user: me } = useAuth();

  const groupQuery = useGroup(groupId);
  const archiveGroup = useArchiveGroup();
  const leaveGroup = useLeaveGroup();

  const [tab, setTab] = useState<GroupTab>('expenses');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  if (groupQuery.isLoading) {
    return <GroupPageSkeleton />;
  }

  if (groupQuery.isError || !groupQuery.data) {
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

  const group = groupQuery.data;
  const isAdmin =
    me !== null && group.members.some((m) => m.user.id === me.id && m.role === 'ADMIN');
  const archived = group.archivedAt !== null;

  const handleArchive = () => {
    archiveGroup.mutate(group.id, {
      onSuccess: () => {
        setArchiveOpen(false);
        toast.success(`${group.emoji} ${group.name} archived`);
        router.push('/groups');
      },
    });
  };

  const handleLeave = () => {
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

  return (
    <>
      <GroupHeader
        group={group}
        isAdmin={isAdmin}
        onInvite={() => setInviteOpen(true)}
        onEdit={() => setEditOpen(true)}
        onArchive={() => setArchiveOpen(true)}
        onLeave={() => setLeaveOpen(true)}
      />

      {archived && (
        <div className="mb-6 flex items-center gap-2.5 rounded-xl bg-warn-soft px-4 py-3">
          <Archive className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          <p className="text-sm text-warn">
            This group is archived — it&rsquo;s read-only for everyone.
          </p>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as GroupTab)}>
        <TabsList>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="balances">Balances</TabsTrigger>
          <TabsTrigger value="totals">Totals</TabsTrigger>
        </TabsList>

        <TabsContent value="expenses">
          <div className="space-y-4">
            {!archived && (
              <div className="flex justify-end">
                <Button onClick={() => setEditorOpen(true)}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add expense
                </Button>
              </div>
            )}
            <ExpenseList
              groupId={group.id}
              emptyHint="Add the first expense to start splitting fairly."
            />
          </div>
        </TabsContent>

        <TabsContent value="balances">
          <BalancesView groupId={group.id} />
        </TabsContent>

        <TabsContent value="totals">
          <TotalsView groupId={group.id} />
        </TabsContent>
      </Tabs>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        group={group}
        isAdmin={isAdmin}
      />
      <GroupFormDialog open={editOpen} onOpenChange={setEditOpen} group={group} />
      <ExpenseEditorDialog open={editorOpen} onOpenChange={setEditorOpen} groupId={group.id} />

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
    </>
  );
}
