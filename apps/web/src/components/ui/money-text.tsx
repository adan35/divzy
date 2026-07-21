'use client';

import { formatMoney } from '@divzy/shared';
import { useCountUp } from '@/lib/motion';
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
  /**
   * WI-068 (spec §3, opt-in): count up to the new value over ~600ms on value
   * change. Semantic color always comes from the FINAL value; the span
   * carries an aria-label with the final formatted value; snaps instantly
   * under prefers-reduced-motion. Default false — existing call sites render
   * exactly as before.
   */
  animate?: boolean;
  /** Also count up from zero on first mount (the Pulse hero passes true). */
  animateOnMount?: boolean;
  className?: string;
}

export function MoneyText({
  amount,
  currency,
  mode = 'plain',
  animate = false,
  animateOnMount = false,
  className,
}: MoneyTextProps) {
  // Hook always runs (rules of hooks); with animate=false it schedules no
  // frames and returns `amount` directly.
  const displayed = useCountUp(amount, { enabled: animate, animateOnMount });

  // Sign/color semantics come from the FINAL amount (WI-055 / AC-4c: a figure
  // never sweeps through green<->red mid-animation).
  const format = (minor: number) =>
    mode === 'signed-color' && amount > 0
      ? `+${formatMoney(minor, currency)}`
      : formatMoney(minor, currency); // negative keeps its minus; zero is plain

  const colorClass =
    mode === 'signed-color'
      ? amount > 0
        ? 'text-pos'
        : amount < 0
          ? 'text-neg'
          : 'text-ink-3'
      : null;

  return (
    <span
      aria-label={animate ? format(amount) : undefined}
      className={cn(
        'tabular-nums',
        mode === 'signed-color' && 'font-medium',
        colorClass,
        className,
      )}
    >
      {format(animate ? displayed : amount)}
    </span>
  );
}
