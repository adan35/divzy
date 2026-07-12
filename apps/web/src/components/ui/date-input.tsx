'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export interface DateInputProps {
  /** ISO 8601 datetime (or yyyy-MM-dd) in. */
  value: string;
  /** Emits a full ISO 8601 datetime (local noon — immune to timezone day-shift). */
  onChange: (iso: string) => void;
  id?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}

function toDateValue(value: string): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Styled native date input. ISO strings in, ISO strings out. */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { value, onChange, id, min, max, disabled, invalid, className },
  ref,
) {
  return (
    <input
      ref={ref}
      id={id}
      type="date"
      value={toDateValue(value)}
      min={min ? toDateValue(min) : undefined}
      max={max ? toDateValue(max) : undefined}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      onChange={(e) => {
        const raw = e.target.value; // yyyy-MM-dd or ''
        if (!raw) return;
        // Anchor at local noon so the calendar day survives UTC conversion.
        const picked = new Date(`${raw}T12:00:00`);
        if (!Number.isNaN(picked.getTime())) onChange(picked.toISOString());
      }}
      className={cn(
        'h-10 w-full rounded-[10px] border border-hairline bg-surface px-3 text-sm text-ink',
        'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft',
        'disabled:cursor-not-allowed disabled:opacity-55',
        invalid && 'border-danger focus:border-danger focus:ring-neg-soft',
        className,
      )}
    />
  );
});
