'use client';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * WI-072 §3 (analytics perf batch): loading placeholder for next/dynamic's
 * `loading` option in (app)/dashboard/page.tsx, mirroring SpendSnapshotChart's
 * own `analytics.isPending` skeleton verbatim (same wrapper + classes) so the
 * chunk-loading and chunk-loaded-but-data-pending states are visually
 * identical — zero layout jump.
 *
 * Deliberately kept in its own file, importing nothing from
 * spend-snapshot-chart.tsx (which pulls in `recharts`): dashboard/page.tsx
 * needs a STATIC import of this fallback (next/dynamic's `loading` option
 * must be available synchronously), and if it statically imported anything
 * from the same module SpendSnapshotChart is dynamically imported from,
 * webpack folds that whole module — including recharts — back into the
 * page's eager bundle, defeating the entire point of this fix. Verified via
 * `pnpm --filter @divzy/web build` + `.next/` chunk inspection.
 */
export function SpendSnapshotChartFallback() {
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex h-full flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-7 w-28" />
        <Skeleton className="mt-auto h-[100px] w-full" />
      </div>
    </div>
  );
}
