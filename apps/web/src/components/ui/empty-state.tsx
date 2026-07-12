'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  /** Context emoji per STYLE.md: 🧾 expenses, 👥 friends, ✈️ groups ... */
  emoji: string;
  title: string;
  hint?: string;
  /** Primary action button. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ emoji, title, hint, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-xl2 border border-dashed border-hairline px-6 py-14 text-center',
        className,
      )}
    >
      <div className="text-4xl" aria-hidden="true">
        {emoji}
      </div>
      <h3 className="mt-2 text-[15px] font-semibold text-ink">{title}</h3>
      {hint && <p className="max-w-sm text-sm text-ink-3">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
