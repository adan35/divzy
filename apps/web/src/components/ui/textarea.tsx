'use client';

import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, rows = 3, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full resize-y rounded-[10px] border border-hairline bg-surface px-3 py-2 text-sm text-ink',
        'placeholder:text-ink-3',
        'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft',
        'disabled:cursor-not-allowed disabled:opacity-55',
        invalid && 'border-danger focus:border-danger focus:ring-neg-soft',
        className,
      )}
      {...props}
    />
  );
});
