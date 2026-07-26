'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Archive,
  ArrowLeft,
  Download,
  FileSpreadsheet,
  FileText,
  HandCoins,
  LogOut,
  MoreVertical,
  Pencil,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { GROUP_TYPES, type GroupDto, type GroupType } from '@divzy/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/hooks';
import { AvatarStack } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dropdown, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown';

function typeLabel(type: GroupType): string {
  return GROUP_TYPES.find((t) => t.key === type)?.label ?? 'Other';
}

function groupSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'group';
}

function csvFilename(name: string): string {
  return `${groupSlug(name)}-expenses.csv`;
}

function pdfFilename(name: string): string {
  return `${groupSlug(name)}-expenses.pdf`;
}

function xlsxFilename(name: string): string {
  return `${groupSlug(name)}-expenses.xlsx`;
}

export interface GroupHeaderProps {
  group: GroupDto;
  isAdmin: boolean;
  /**
   * WI-086: true when the caller has an outstanding payable position in this
   * group (any negative per-currency net). The Settle Up button gets an amber
   * attention treatment; false/absent keeps the neutral outline styling.
   */
  iOwe?: boolean;
  /**
   * Opens the existing, unmodified SettleUpDialog scoped to this group, no
   * prefill (story-WI-003). Rendered unconditionally — visible and enabled
   * regardless of the active tab or archived state, same as "Invite" today.
   */
  onSettleUp: () => void;
  onInvite: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onLeave: () => void;
  /** WI-046: admin-only, group-wide-settled permanent (soft) delete. */
  onDelete: () => void;
}

export function GroupHeader({
  group,
  isAdmin,
  iOwe,
  onSettleUp,
  onInvite,
  onEdit,
  onArchive,
  onLeave,
  onDelete,
}: GroupHeaderProps) {
  const router = useRouter();
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);

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

  const handleExportPdf = async () => {
    if (exportingPdf) return;
    setExportingPdf(true);
    try {
      // exportPdf returns a Blob (binary), not a string — wrapping a decoded
      // string here previously corrupted the PDF's bytes (defect-WI-018).
      const blob = await api.groups.exportPdf(group.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = pdfFilename(group.name);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success('PDF downloaded');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExportXlsx = async () => {
    if (exportingXlsx) return;
    setExportingXlsx(true);
    try {
      // exportXlsx returns a Blob (binary), like exportPdf — wrapping a
      // decoded string here would corrupt the workbook (defect-WI-018).
      const blob = await api.groups.exportXlsx(group.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = xlsxFilename(group.name);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success('Excel downloaded');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExportingXlsx(false);
    }
  };

  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3.5">
        <button
          type="button"
          aria-label="Back to groups"
          onClick={() => router.push('/groups')}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
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
        <Button
          variant="outline"
          data-owe={iOwe ? 'true' : undefined}
          className={
            iOwe
              ? 'border-warn bg-warn-soft text-warn hover:bg-warn-soft/80'
              : undefined
          }
          onClick={onSettleUp}
        >
          <HandCoins className="h-4 w-4" aria-hidden="true" />
          Settle Up
        </Button>
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
          <DropdownItem
            icon={<FileText />}
            onSelect={() => void handleExportPdf()}
            disabled={exportingPdf}
          >
            {exportingPdf ? 'Exporting…' : 'Export PDF'}
          </DropdownItem>
          <DropdownItem
            icon={<FileSpreadsheet />}
            onSelect={() => void handleExportXlsx()}
            disabled={exportingXlsx}
          >
            {exportingXlsx ? 'Exporting…' : 'Export Excel'}
          </DropdownItem>
          <DropdownSeparator />
          {isAdmin && group.archivedAt === null && (
            <DropdownItem icon={<Archive />} onSelect={onArchive}>
              Archive group
            </DropdownItem>
          )}
          {isAdmin && (
            <DropdownItem icon={<Trash2 />} danger onSelect={onDelete}>
              Delete group
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
