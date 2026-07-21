'use client';

import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

/** Styled native select — reliable keyboard/mobile behavior for free. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, children, ...props },
  ref,
) {
  return (
    <div className={cn('relative', className)}>
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-10 w-full cursor-pointer appearance-none rounded-[10px] border border-hairline-strong bg-surface pl-3 pr-9 text-sm text-ink',
          'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft',
          'disabled:cursor-not-allowed disabled:opacity-55',
          invalid && 'border-danger focus:border-danger focus:ring-neg-soft',
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
        aria-hidden="true"
      />
    </div>
  );
});
