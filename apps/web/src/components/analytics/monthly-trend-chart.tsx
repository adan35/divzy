'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format } from 'date-fns';
import { formatMoney, toMajorUnits } from '@divzy/shared';
import { MoneyText } from '@/components/ui/money-text';
import { CHART_SERIES, useChartTheme } from './palette';

export interface MonthlyTrendChartProps {
  /** Calendar months covering the range (zero-filled), amounts in minor units. */
  data: Array<{ month: string; amount: number }>;
  currency: string;
}

/** "2026-03" (or any ISO-ish month string) → a Date at that month's start. */
function monthToDate(month: string): Date | null {
  const match = /^(\d{4})-(\d{2})/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return new Date(year, monthIndex, 1);
}

/** Compact axis money: "$1.2K" — falls back to full formatting. */
function compactMoney(minor: number, currency: string): string {
  const major = toMajorUnits(minor, currency);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(major);
  } catch {
    return formatMoney(minor, currency);
  }
}

interface TooltipPayloadEntry {
  value?: number | string;
}

/**
 * Exported (spec §8.2 tooltip chrome / AC-4a) so it can be rendered and
 * asserted directly — Recharts renders zero-size under jsdom, so this plain,
 * SVG-independent component is the only piece of the chart's chrome that is
 * unit-testable in this environment (see monthly-trend-chart.test.tsx).
 */
export function ChartTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string | number;
  currency: string;
}) {
  const value = payload?.[0]?.value;
  if (!active || typeof value !== 'number') return null;
  return (
    <div className="rounded-xl border border-hairline bg-elevated px-3 py-2 shadow-pop dark:shadow-top-edge">
      <p className="text-xs text-ink-3">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-ink">
        <MoneyText amount={value} currency={currency} />
      </p>
    </div>
  );
}

/**
 * Monthly spend trend per STYLE.md §Charts: single brand-colored bar series,
 * 4px rounded tops, maxBarSize 28, hairline horizontal grid only, muted 12px
 * axis text, money tooltips, no legend.
 */
export function MonthlyTrendChart({ data, currency }: MonthlyTrendChartProps) {
  const { grid } = useChartTheme();

  const chartData = useMemo(() => {
    const dates = data
      .map((d) => ({ ...d, date: monthToDate(d.month) }))
      .filter((d): d is { month: string; amount: number; date: Date } => d.date !== null);
    const years = new Set(dates.map((d) => d.date.getFullYear()));
    const pattern = years.size > 1 ? 'MMM yy' : 'MMM';
    return dates.map((d) => ({ label: format(d.date, pattern), amount: d.amount }));
  }, [data]);

  return (
    <div className="h-[260px] w-full" role="img" aria-label="Monthly spend bar chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap="24%">
          <CartesianGrid vertical={false} stroke={grid} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--ink-3)', fontSize: 12 }}
            dy={6}
            interval="preserveStartEnd"
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            tickCount={4}
            tick={{ fill: 'var(--ink-3)', fontSize: 12 }}
            tickFormatter={(v: number) => compactMoney(v, currency)}
          />
          <Tooltip
            cursor={{ fill: 'var(--surface-2)', opacity: 0.5 }}
            content={<ChartTooltip currency={currency} />}
          />
          <Bar dataKey="amount" fill={CHART_SERIES} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
