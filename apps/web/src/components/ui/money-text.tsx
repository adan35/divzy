'use client';

import { formatMoney } from '@divzy/shared';
import { cn } from '@/lib/utils';

export interface MoneyTextProps {
  /** Integer minor units. */
  amount: number;
  currency: string;
  /**
   * 'plain'        — ink-colored, formatted amount as-is.
   * 'signed-color' — positive → green with leading "+", negative → red with
   *                  "-", zero → muted. Color is always paired with an
   *                  explicit sign per STYLE.md.
   */
  mode?: 'plain' | 'signed-color';
  className?: string;
}

export function MoneyText({ amount, currency, mode = 'plain', className }: MoneyTextProps) {
  if (mode === 'plain') {
    return (
      <span className={cn('tabular-nums', className)}>
        {formatMoney(amount, currency)}
      </span>
    );
  }

  const color = amount > 0 ? 'text-pos' : amount < 0 ? 'text-neg' : 'text-ink-3';
  const text =
    amount > 0
      ? `+${formatMoney(amount, currency)}`
      : formatMoney(amount, currency); // negative keeps its minus; zero is plain

  return <span className={cn('tabular-nums font-medium', color, className)}>{text}</span>;
}
