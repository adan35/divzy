'use client';

import type { ReactNode } from 'react';
import { ArrowDown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Small line under the value (delta, context). */
  sub?: ReactNode;
  className?: string;
}

/** Hero stat tile per STYLE.md: 13px secondary label over a 28px semibold value. */
export function StatTile({ label, value, sub, className }: StatTileProps) {
  return (
    <Card className={cn('p-5', className)}>
      <p className="text-[13px] text-ink-2">{label}</p>
      <p className="mt-1 truncate text-[28px] font-semibold leading-tight tracking-tight text-ink tabular-nums">
        {value}
      </p>
      {sub && <p className="mt-1.5 text-[13px]">{sub}</p>}
    </Card>
  );
}

export interface SpendDeltaProps {
  current: number;
  previous: number;
}

/**
 * Delta vs the previous period per STYLE.md: spending LESS is green with a
 * down arrow; spending more is neutral secondary ink ("+x% vs last period") —
 * never red, spending more isn't an error.
 */
export function SpendDelta({ current, previous }: SpendDeltaProps) {
  if (previous <= 0) {
    return current > 0 ? (
      <span className="text-ink-3">no spend in the previous period</span>
    ) : (
      <span className="text-ink-3">nothing in either period</span>
    );
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) {
    return <span className="text-ink-3">same as last period</span>;
  }
  if (pct < 0) {
    return (
      <span className="inline-flex items-center gap-0.5 font-medium text-pos">
        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
        {Math.abs(pct)}% vs last period
      </span>
    );
  }
  return <span className="text-ink-2">+{pct}% vs last period</span>;
}
