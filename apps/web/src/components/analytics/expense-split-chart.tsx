'use client';

import type { ExpenseSplitDto } from '@divzy/shared';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { MoneyText } from '@/components/ui/money-text';
import { useChartTheme } from './palette';

export interface ExpenseSplitChartProps {
  /** expense.currency — NEVER expense.convertedCurrency. */
  currency: string;
  /** expense.splits verbatim, one entry per participant. */
  splits: ExpenseSplitDto[];
  /**
   * expense.amount — pinned by the prop contract (spec-WI-039) but
   * deliberately NOT used to compute percent labels; per spec §Percent-of-
   * total computation, `S` is always re-derived as `Σ split.amount` so the
   * bar's segments/labels stay self-consistent with what is actually
   * rendered even on a legacy row where `Σ split.amount` and `totalAmount`
   * happen to drift apart. The AC guarantees they match in the normal case.
   */
  totalAmount: number;
  /** Compared to split.user.id to label "You"; omit → plain names. */
  viewerUserId?: string;
  className?: string;
}

/**
 * Largest-remainder (Hamilton) percent-of-total labels so integer percents
 * sum to exactly 100, per spec-WI-039 §Percent-of-total computation. Purely
 * a display derivation — never feeds back into any rendered money value.
 * Returns null when there's nothing to divide (defensive; the AC-guaranteed
 * case has `S === totalAmount > 0`).
 */
export function largestRemainderPercents(amounts: number[]): number[] | null {
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (amounts.length === 0 || total <= 0) return null;

  const raw = amounts.map((amount) => (amount * 100) / total);
  const base = raw.map((r) => Math.floor(r));
  const leftover = 100 - base.reduce((sum, b) => sum + b, 0);

  // Largest remainder first; ties broken by larger split.amount, then by
  // original array order (Array#sort is stable, so a 0-comparator leaves
  // ties in their original relative order for free).
  const order = amounts
    .map((amount, index) => ({ index, amount, remainder: raw[index] - base[index] }))
    .sort((a, b) => b.remainder - a.remainder || b.amount - a.amount);

  const result = [...base];
  for (let k = 0; k < leftover; k++) {
    const entry = order[k];
    if (entry) result[entry.index] += 1;
  }
  return result;
}

/**
 * Pure presentational expense split breakdown (spec-WI-039): a horizontal
 * 100%-segmented bar + per-participant amount row, built with plain layout
 * primitives (no charting dependency). Host-gated — no fetch, no loading or
 * error state of its own; every amount renders through the shared
 * `MoneyText` component (AC-4a) as `split.amount`/`currency` directly, never
 * `convertedAmount`/`convertedCurrency`.
 *
 * Edge cases handled per spec: a viewer who is a payer but not a split
 * participant gets no "You" highlight and no fabricated zero-amount row
 * (only real `splits` entries ever render); a single-participant expense
 * renders one 100% segment; a deleted expense's splits render the same as
 * any other — this component has no `deletedAt` awareness.
 */
export function ExpenseSplitChart({
  currency,
  splits,
  viewerUserId,
  className,
}: ExpenseSplitChartProps) {
  const { palette } = useChartTheme();

  if (splits.length === 0) return null;

  const percents = largestRemainderPercents(splits.map((s) => s.amount));

  return (
    <div className={cn('space-y-2.5', className)}>
      {percents && (
        <div
          className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-surface-2"
          role="img"
          aria-label="Expense split breakdown"
        >
          {splits.map((split, i) => (
            <span
              key={split.user.id}
              className="h-full"
              style={{ width: `${percents[i]}%`, backgroundColor: palette[i % palette.length] }}
            />
          ))}
        </div>
      )}
      <ul className="space-y-1.5">
        {splits.map((split, i) => (
          <li key={split.user.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                aria-hidden="true"
                style={{ backgroundColor: palette[i % palette.length] }}
              />
              <Avatar user={split.user} size="sm" />
              <span className="truncate text-ink">
                {viewerUserId && split.user.id === viewerUserId ? 'You' : split.user.name}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {percents && <span className="text-xs text-ink-3">{percents[i]}%</span>}
              <MoneyText amount={split.amount} currency={currency} className="font-medium text-ink" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
