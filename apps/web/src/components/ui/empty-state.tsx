'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  /**
   * Preferred glyph (WI-068): a lucide icon node, rendered in a brand-soft
   * circle. Takes precedence over `emoji` when both are given.
   */
  icon?: ReactNode;
  /**
   * Back-compat context emoji per STYLE.md: 🧾 expenses, 👥 friends,
   * ✈️ groups... Kept for existing call sites; screen slices migrate to
   * `icon` opportunistically.
   */
  emoji?: string;
  title: string;
  hint?: string;
  /** Primary action button. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, emoji, title, hint, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-xl2 border border-dashed border-hairline px-6 py-14 text-center',
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-brand [&>svg]:h-6 [&>svg]:w-6"
        >
          {icon}
        </div>
      ) : emoji ? (
        <div
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-3xl"
        >
          {emoji}
        </div>
      ) : null}
      <h3 className="mt-2 text-[15px] font-semibold text-ink">{title}</h3>
      {hint && <p className="max-w-sm text-sm text-ink-3">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
