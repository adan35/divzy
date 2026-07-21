'use client';

import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { RefreshCw } from 'lucide-react';
import { errorMessage, useAnalytics } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FallbackRatesNotice } from '@/components/ui/fallback-rates-notice';
import { MoneyText } from '@/components/ui/money-text';
import { Skeleton } from '@/components/ui/skeleton';
import { useChartTheme } from '@/components/analytics/palette';
import { buildGroupSpendChartRows, groupSpendBarFill, isGroupSpendEmpty } from './group-spend-chart-data';

export interface GroupSpendChartProps {
  className?: string;
}

interface TooltipPayloadEntry {
  value?: number | string;
}

/**
 * WI-068 §8.2 tooltip chrome — `bg-elevated`/`shadow-pop`/`rounded-xl` (+ the
 * dark machined top-edge), matching the shared foundation tooltip pattern;
 * exported for direct rendering in tests since Recharts' `ResponsiveContainer`
 * never mounts its children under jsdom (see the module doc-comment above).
 */
export function GroupSpendTooltip({
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
      <MoneyText amount={value} currency={currency} className="mt-0.5 block text-sm font-medium text-ink" />
    </div>
  );
}

/**
 * Self-contained, own-fetch comparative "spend by group" chart for the
 * Groups list page (spec-WI-060): a vertical bar per group read verbatim off
 * `AnalyticsSummaryDto.byGroup` (already converted, zero-filtered, and
 * amount-desc sorted — no re-aggregation or client-side currency conversion,
 * charter invariant 5). It owns its own `useAnalytics()` query — a distinct
 * query key from `useGroups()` — so the group-cards grid renders as soon as
 * groups resolve regardless of this chart's speed or failure, and owns its
 * own loading/error/empty states as a chart-local failure domain.
 *
 * Deliberately visually distinct from the analytics page's "By group"
 * `BreakdownRows` (horizontal share bars, 8-color categorical palette): this
 * is a vertical Recharts `BarChart` with only two fills — `var(--chart-1)`
 * (WI-068 §8.2: single-series marks use chart-1, never `--brand`) for the
 * single highest-spend group (index 0 of the already-sorted `byGroup`, i.e.
 * the fold-preserved top entry) and a muted `var(--surface-2)` for every
 * other bar — per the client's explicit "could look different than the
 * analytics page" ask (`groupSpendBarFill` in group-spend-chart-data.ts).
 * `useChartTheme()` is used only for the hairline grid stroke, never its
 * categorical palette.
 */
export function GroupSpendChart({ className }: GroupSpendChartProps) {
  const { grid } = useChartTheme();
  const analytics = useAnalytics();
  const data = analytics.data;

  const rows = useMemo(() => (data ? buildGroupSpendChartRows(data.byGroup) : []), [data]);

  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        key: r.key,
        label: r.emoji ? `${r.emoji} ${r.label}` : r.label,
        amount: r.amount,
        isHighlight: r.isHighlight,
      })),
    [rows],
  );

  const isEmpty = isGroupSpendEmpty(data?.byGroup);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Spend by group</CardTitle>
      </CardHeader>
      <CardContent>
        {analytics.isPending ? (
          <div className="flex flex-col gap-3" aria-hidden="true">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-[200px] w-full" />
          </div>
        ) : analytics.isError ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <p className="text-sm text-ink-2">{errorMessage(analytics.error)}</p>
            <Button variant="outline" size="sm" onClick={() => void analytics.refetch()}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Try again
            </Button>
          </div>
        ) : !data ? null : isEmpty ? (
          <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
            <p className="text-sm font-medium text-ink">No group spend yet</p>
            <p className="text-xs text-ink-3">
              Add an expense in a group to see it compared here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {data.usedFallbackRates && <FallbackRatesNotice className="text-[11px]" />}
            <div className="h-[220px] w-full" role="img" aria-label="Spend by group">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 8, right: 4, bottom: 0, left: 4 }}
                  barCategoryGap="24%"
                >
                  <CartesianGrid vertical={false} stroke={grid} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'var(--ink-3)', fontSize: 12 }}
                    dy={6}
                    interval="preserveStartEnd"
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--surface-2)', opacity: 0.5 }}
                    content={<GroupSpendTooltip currency={data.currency} />}
                  />
                  <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={28}>
                    {chartData.map((entry) => (
                      <Cell key={entry.key} fill={groupSpendBarFill(entry.isHighlight)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
