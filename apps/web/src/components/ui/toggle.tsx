'use client';

import { cn } from '@/lib/utils';

export interface ToggleProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

/** Small pill switch — shared by group-form-dialog and the Groups page filters. */
export function Toggle({ id, checked, onChange, disabled, ...rest }: ToggleProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={rest['aria-label']}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-10 shrink-0 rounded-full transition-colors',
        // WI-068: checked track uses the fill token (white knob on dark-mode
        // `--brand` link-blue would be low contrast; `--brand-fill` is not).
        checked ? 'bg-brand-fill' : 'bg-surface-2 ring-1 ring-inset ring-hairline-strong',
        disabled && 'cursor-not-allowed opacity-55',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-on-brand shadow-card transition-transform',
          checked && 'translate-x-4',
        )}
      />
    </button>
  );
}
