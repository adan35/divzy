'use client';

import { X } from 'lucide-react';
import type { NotificationDto } from '@divzy/shared';
import { useClearNotification, useMarkNotificationRead } from '@/lib/hooks';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * A single row in the notifications dropdown (`(app)/layout.tsx`'s
 * `NotificationsMenu`). Pulled into its own file (rather than exported
 * directly from `layout.tsx`) because `layout.tsx` is a Next.js app-router
 * special file — its generated route type only allows a fixed set of named
 * exports (`default`, `metadata`, ...), so any other export there fails
 * `tsc` against `.next/types/app/(app)/layout.ts`.
 */
export function NotificationRow({ notification }: { notification: NotificationDto }) {
  const markRead = useMarkNotificationRead();
  const clearNotification = useClearNotification();
  const unread = notification.readAt === null;

  const openRow = () => {
    if (unread && !markRead.isPending) markRead.mutate(notification.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openRow}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openRow();
        }
      }}
      className={cn(
        'group flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2',
        !unread && 'opacity-75',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
          unread ? 'bg-brand' : 'bg-transparent',
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{notification.title}</span>
        {notification.body && (
          <span className="mt-0.5 block text-[13px] leading-snug text-ink-2 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
            {notification.body}
          </span>
        )}
        <span className="mt-0.5 block text-xs text-ink-3">
          {formatRelative(notification.createdAt)}
        </span>
      </span>
      <button
        type="button"
        aria-label="Clear notification"
        // WI-056: independent of the row's own click-to-mark-read handler —
        // stopPropagation so clearing never also marks read.
        onClick={(e) => {
          e.stopPropagation();
          if (!clearNotification.isPending) clearNotification.mutate(notification.id);
        }}
        disabled={clearNotification.isPending}
        // WI-068 AC-10b (defect-WI-068-1): 44x44 hit area (spec §12). The
        // glyph stays 14px; negative margins bleed the hit area into the
        // row's own padding so the layout doesn't inflate (web analogue of
        // the mobile hitSlop pattern).
        className="-my-1.5 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-3 opacity-0 transition-opacity hover:bg-surface hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-55"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
