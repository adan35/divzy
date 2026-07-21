'use client';

import { cn } from '@/lib/utils';

export interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-lg bg-surface-2', className)}
    />
  );
}

export interface SkeletonListProps {
  /** Number of placeholder rows. */
  rows?: number;
  /** Show a leading avatar circle per row. */
  avatar?: boolean;
  className?: string;
}

/** First-load placeholder for list screens (STYLE.md: skeletons, not spinners). */
export function SkeletonList({ rows = 4, avatar = true, className }: SkeletonListProps) {
  return (
    <div className={cn('space-y-3', className)} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-xl2 border border-hairline bg-surface p-4 shadow-card dark:shadow-top-edge"
        >
          {avatar && <Skeleton className="h-9 w-9 shrink-0 rounded-full" />}
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
