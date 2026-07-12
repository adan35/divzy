'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES: Record<NonNullable<SpinnerProps['size']>, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-8 w-8',
};

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <Loader2
      aria-label="Loading"
      role="status"
      className={cn('animate-spin text-ink-3', SIZES[size], className)}
    />
  );
}

/** Full-page centered brand spinner (auth boot, route guards). */
export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-page">
      <span className="text-2xl font-bold lowercase tracking-tight text-brand">divzy</span>
      <Spinner size="lg" className="text-brand" />
    </div>
  );
}
