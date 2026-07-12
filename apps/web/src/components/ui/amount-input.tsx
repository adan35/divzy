'use client';

import { useEffect, useRef, useState } from 'react';
import { getCurrency, toMinorUnits } from '@divzy/shared';
import { cn } from '@/lib/utils';

export interface AmountInputProps {
  /** Amount in integer minor units, or null when empty/invalid. */
  value: number | null;
  onChange: (value: number | null) => void;
  currency: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  className?: string;
  'aria-label'?: string;
}

/** Render minor units as a plain editable decimal string (no grouping). */
function minorToText(minor: number | null, currency: string): string {
  if (minor === null) return '';
  const { decimals } = getCurrency(currency);
  const abs = Math.abs(minor);
  const base = 10 ** decimals;
  const intPart = Math.floor(abs / base);
  const frac = String(abs % base).padStart(decimals, '0');
  const sign = minor < 0 ? '-' : '';
  return decimals > 0 ? `${sign}${intPart}.${frac}` : `${sign}${intPart}`;
}

function parseText(text: string, currency: string): number | null {
  const trimmed = text.replace(/,/g, '.').replace(/\.$/, '');
  if (trimmed === '') return null;
  try {
    return toMinorUnits(trimmed, currency);
  } catch {
    return null;
  }
}

/**
 * Money entry field: currency-symbol prefix, decimal text in, integer minor
 * units out (via shared `toMinorUnits` — never floats). Invalid keystrokes
 * are blocked; partial input ("12.") emits the best current parse.
 */
export function AmountInput({
  value,
  onChange,
  currency,
  id,
  placeholder = '0.00',
  disabled,
  invalid,
  autoFocus,
  className,
  'aria-label': ariaLabel,
}: AmountInputProps) {
  const info = getCurrency(currency);
  const [text, setText] = useState(() => minorToText(value, currency));
  const lastEmitted = useRef<number | null>(value);
  const lastCurrency = useRef(currency);

  // Adopt external value changes (form reset, prefill) and currency switches
  // without clobbering in-progress typing that parses to the same amount.
  useEffect(() => {
    const currencyChanged = lastCurrency.current !== currency;
    if (currencyChanged || value !== lastEmitted.current) {
      lastCurrency.current = currency;
      lastEmitted.current = value;
      setText(minorToText(value, currency));
    }
  }, [value, currency]);

  const handleChange = (raw: string) => {
    const normalized = raw.replace(/,/g, '.');
    // Digits with at most one decimal point, capped at the currency's precision.
    const pattern =
      info.decimals > 0
        ? new RegExp(`^\\d*(?:\\.\\d{0,${info.decimals}})?$`)
        : /^\d*$/;
    if (!pattern.test(normalized)) return; // block invalid keystrokes
    setText(normalized);
    const parsed = parseText(normalized, currency);
    lastEmitted.current = parsed;
    onChange(parsed);
  };

  return (
    <div
      className={cn(
        'flex h-10 items-center overflow-hidden rounded-[10px] border border-hairline bg-surface',
        'transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-soft',
        invalid && 'border-danger focus-within:border-danger focus-within:ring-neg-soft',
        disabled && 'cursor-not-allowed opacity-55',
        className,
      )}
    >
      <span className="select-none whitespace-nowrap pl-3 pr-1.5 text-sm text-ink-3" aria-hidden="true">
        {info.symbol}
      </span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={ariaLabel ?? 'Amount'}
        aria-invalid={invalid || undefined}
        value={text}
        placeholder={info.decimals > 0 ? placeholder : '0'}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => {
          // Tidy partial input on blur: "12." -> "12", "" stays empty.
          const parsed = parseText(text, currency);
          setText(minorToText(parsed, currency));
        }}
        className="h-full w-full bg-transparent pr-3 text-sm tabular-nums text-ink placeholder:text-ink-3 focus:outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}
