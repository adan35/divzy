'use client';

import { TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FallbackRatesNoticeProps {
  className?: string;
}

/**
 * Warning pill shown when a converted figure used analytics' bundled
 * fallback exchange-rate table rather than a live/cached rate. Mirrors the
 * existing inline disclaimer on the analytics summary page
 * (`usedFallbackRates`), extracted here so settlements' balance surfaces
 * (dashboard, group Balances tab) can reuse the same convention.
 */
export function FallbackRatesNotice({ className }: FallbackRatesNoticeProps) {
  return (
    <p
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg bg-warn-soft px-2.5 py-1.5 text-[13px] text-warn',
        className,
      )}
    >
      <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      Converted with offline rates
    </p>
  );
}
