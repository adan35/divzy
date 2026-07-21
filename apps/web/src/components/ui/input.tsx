'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-10 w-full rounded-[10px] border border-hairline-strong bg-surface px-3 text-sm text-ink',
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

export interface FieldProps {
  label: string;
  /** Ties the label to the control; auto-generated when omitted. */
  htmlFor?: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode | ((id: string) => ReactNode);
}

/** Label + control + inline error/hint wrapper (labels above inputs per STYLE). */
export function Field({ label, htmlFor, error, hint, required, className, children }: FieldProps) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[13px] font-medium text-ink-2">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {typeof children === 'function' ? children(id) : children}
      {error ? (
        <p className="text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[13px] text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}
