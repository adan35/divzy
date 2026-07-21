'use client';

import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { format, startOfMonth, subMonths } from 'date-fns';
import { RefreshCw } from 'lucide-react';
import { errorMessage, useAnalytics } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { FallbackRatesNotice } from '@/components/ui/fallback-rates-notice';
import { MoneyText } from '@/components/ui/money-text';
import { Skeleton } from '@/components/ui/skeleton';

export interface SpendSnapshotChartProps {
  className?: string;
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

interface TooltipPayloadEntry {
  value?: number | string;
}

function SnapshotTooltip({
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
  // WI-068 spec §8.2 tooltip chrome, mirroring the house pattern in
  // analytics' `monthly-trend-chart.tsx` `ChartTooltip`: elevated surface,
  // pop shadow (dark: top-edge highlight), 12px ink-3 label, ink value
  // through `<MoneyText>` (AC-4a — never bare `formatMoney()` + span).
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
 * Self-contained, own-fetch compact spend snapshot for the dashboard chart
 * slot (spec-WI-036): 3-month "your spend" bar chart (current month +
 * prior 2, current month highlighted) plus a "this month" headline, read
 * verbatim off the existing `GET /analytics/summary` DTO — no new endpoint,
 * no client-side aggregation or conversion. Owns its own loading/error/empty
 * states independently of the rest of the dashboard (no shared query key
 * with Recent Activity or any other section).
 *
 * WI-068 (defect-WI-068-1 cycle-1 fix): restyled to the design-language
 * chart chrome — `--chart-1` marks with active-month emphasis (AC-9b),
 * §8.2 tooltip/grid chrome (AC-9c), headline + tooltip money through
 * `<MoneyText>` (AC-4a).
 */
export function SpendSnapshotChart({ className }: SpendSnapshotChartProps) {
  const range = useMemo(() => {
    const now = new Date();
    return { from: startOfMonth(subMonths(now, 2)).toISOString(), to: now.toISOString() };
  }, []);

  const analytics = useAnalytics({ from: range.from, to: range.to });
  const data = analytics.data;

  const chartData = useMemo(() => {
    if (!data) return [];
    const dates = data.byMonth
      .map((m) => ({ ...m, date: monthToDate(m.month) }))
      .filter(
        (m): m is { month: string; amount: number; totalActivity: number; date: Date } =>
          m.date !== null,
      );
    return dates.map((m, i) => ({
      label: format(m.date, 'MMM'),
      amount: m.amount,
      isCurrent: i === dates.length - 1,
    }));
  }, [data]);

  const currentMonth = data ? data.byMonth[data.byMonth.length - 1] : undefined;
  const isEmpty =
    data !== undefined && data.yourSpend === 0 && data.byMonth.every((m) => m.amount === 0);

  return (
    <div className={cn('flex h-full flex-col gap-3 p-4', className)}>
      {analytics.isPending ? (
        <div className="flex h-full flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-7 w-28" />
          <Skeleton className="mt-auto h-[100px] w-full" />
        </div>
      ) : analytics.isError ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-ink-2">{errorMessage(analytics.error)}</p>
          <Button variant="outline" size="sm" onClick={() => void analytics.refetch()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Try again
          </Button>
        </div>
      ) : !data ? null : isEmpty ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
          <p className="text-sm font-medium text-ink">No spend yet</p>
          <p className="text-xs text-ink-3">Add an expense to see your monthly snapshot.</p>
        </div>
      ) : (
        <>
          <div>
            <p className="text-xs text-ink-3">This month</p>
            <p className="text-xl font-semibold text-ink">
              <MoneyText amount={currentMonth?.amount ?? 0} currency={data.currency} />
            </p>
          </div>
          {data.usedFallbackRates && <FallbackRatesNotice className="text-[11px]" />}
          <div className="h-[100px] w-full" role="img" aria-label="Spend by month, last 3 months">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
                barCategoryGap="30%"
              >
                {/* WI-068 spec §8.2: horizontal hairlines only, token-driven. */}
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'var(--ink-3)', fontSize: 12 }}
                  dy={4}
                />
                <Tooltip
                  cursor={{ fill: 'var(--surface-2)', opacity: 0.5 }}
                  content={<SnapshotTooltip currency={data.currency} />}
                />
                <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={28}>
                  {/* WI-068 AC-9b: single-series marks consume the validated
                      series token — never `--brand`. Active-month emphasis
                      mirrors mobile S7's SpendSnapshotChart: current month at
                      full strength, prior months at 50% (spec §9.1). */}
                  {chartData.map((entry, i) => (
                    <Cell
                      key={`bar-${i}`}
                      fill="var(--chart-1)"
                      fillOpacity={entry.isCurrent ? 1 : 0.5}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
