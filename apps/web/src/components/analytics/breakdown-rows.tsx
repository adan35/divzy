'use client';

import { MoneyText } from '@/components/ui/money-text';
import { CHART_OTHER_COLOR } from './palette';

export interface BreakdownRowDatum {
  key: string;
  label: string;
  emoji?: string;
  /** Minor units in the display currency. */
  amount: number;
}

/**
 * Fold everything past `max` ranked rows into a single "Other" bucket
 * (STYLE.md: >8 categories → fold smallest into Other). Input must already be
 * sorted descending by amount.
 */
export function foldRows(rows: BreakdownRowDatum[], max = 8): BreakdownRowDatum[] {
  if (rows.length <= max) return rows;
  const kept = rows.slice(0, max - 1);
  const rest = rows.slice(max - 1);
  const otherTotal = rest.reduce((acc, r) => acc + r.amount, 0);
  return [...kept, { key: '__other__', label: 'Other', amount: otherTotal }];
}

export interface BreakdownRowsProps {
  rows: BreakdownRowDatum[];
  currency: string;
  /** Fixed-order categorical palette; colors assigned by rank, never cycled. */
  palette: readonly string[];
}

/**
 * Horizontal bar rows per STYLE.md §Charts — label (+emoji) left, thin colored
 * bar sized by share of the largest row, value right in ink. NOT a pie.
 */
export function BreakdownRows({ rows, currency, palette }: BreakdownRowsProps) {
  const max = rows.reduce((acc, r) => Math.max(acc, r.amount), 0);
  if (rows.length === 0 || max <= 0) {
    return <p className="py-6 text-center text-sm text-ink-3">Nothing in this range.</p>;
  }

  return (
    <ul className="space-y-2.5">
      {rows.map((row, i) => {
        const color =
          row.key === '__other__' ? CHART_OTHER_COLOR : palette[i] ?? CHART_OTHER_COLOR;
        const widthPct = Math.max(1.5, (row.amount / max) * 100);
        return (
          <li key={row.key} className="flex items-center gap-3">
            <span className="flex w-32 shrink-0 items-center gap-1.5 text-sm text-ink sm:w-40">
              {row.emoji && (
                <span className="shrink-0" aria-hidden="true">
                  {row.emoji}
                </span>
              )}
              <span className="truncate">{row.label}</span>
            </span>
            <span className="min-w-0 flex-1" aria-hidden="true">
              <span
                className="block h-1.5 rounded-full transition-[width] duration-300"
                style={{ width: `${widthPct}%`, backgroundColor: color }}
              />
            </span>
            <MoneyText
              amount={row.amount}
              currency={currency}
              className="w-24 shrink-0 text-right text-sm text-ink"
            />
          </li>
        );
      })}
    </ul>
  );
}
