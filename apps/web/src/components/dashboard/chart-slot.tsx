'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface DashboardChartSlotProps {
  /** Analytics' self-contained compact spend-chart component (not built here). */
  children?: ReactNode;
  className?: string;
}

/**
 * Layout slot for analytics' compact spend-chart component (spec-WI-036 §2-3).
 *
 * This component owns ONLY placement:
 * - A fixed `max-height` so the chart can never push Recent Activity below
 *   the fold or reflow the feed on data arrival — the bound does not depend
 *   on feed content.
 * - No props threaded from the activity preview, no shared query key/hook
 *   with `useActivityInfinite`. It never reads the feed's state and the feed
 *   never reads its.
 * - No wrapping/restyling of whatever analytics renders as `children` beyond
 *   this bounded container — analytics owns its own loading/error/empty
 *   states and failure isolation internally.
 *
 * Renders a lightweight placeholder when no chart has been wired in yet, so
 * the reserved layout slot is visible during Build even before analytics'
 * component lands.
 */
export function DashboardChartSlot({ children, className }: DashboardChartSlotProps) {
  return (
    <section
      aria-label="Spend chart"
      className={cn('max-h-80 overflow-hidden rounded-xl2', className)}
    >
      {children ?? (
        <div className="flex h-40 items-center justify-center rounded-xl2 border border-dashed border-hairline text-sm text-ink-3">
          Spend chart coming soon
        </div>
      )}
    </section>
  );
}
