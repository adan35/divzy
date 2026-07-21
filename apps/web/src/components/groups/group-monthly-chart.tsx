'use client';

import { RefreshCw } from 'lucide-react';
import { errorMessage, useAnalytics } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MonthlyTrendChart } from '@/components/analytics/monthly-trend-chart';

export interface GroupMonthlyChartProps {
  groupId: string;
  /** The group's home `Group.currency` — deliberately NOT the viewer's
   * `defaultCurrency`, so every member sees the same shared group figure
   * (spec-WI-059 D3). */
  currency: string;
}

/**
 * WI-059: group Totals tab monthly total-expenditure chart. A thin wrapper
 * over the analytics-owned `MonthlyTrendChart`, fed by the existing
 * `useAnalytics({ groupId, currency })` hook — no new query, endpoint, or
 * schema. Plots `byMonth[].totalActivity` (the full per-month expense
 * amount), never `byMonth[].amount` (the viewer's own converted share) —
 * the load-bearing field distinction the spec calls out (D1). Handles
 * loading/error/empty states locally so the host Totals tab stays simple;
 * renders nothing when every month in range is zero so a brand-new group
 * never shows a broken/empty chart (D6) — the host tab's own empty state
 * (no expenses at all) is expected to have already short-circuited before
 * this component ever mounts.
 */
export function GroupMonthlyChart({ groupId, currency }: GroupMonthlyChartProps) {
  const analytics = useAnalytics({ groupId, currency });

  if (analytics.isPending) {
    return <Skeleton className="h-[260px] w-full" />;
  }

  if (analytics.isError) {
    return (
      <Card className="flex flex-col items-center gap-3 p-6 text-center">
        <p className="text-sm text-ink-2">{errorMessage(analytics.error)}</p>
        <Button variant="secondary" size="sm" onClick={() => void analytics.refetch()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
      </Card>
    );
  }

  const chartData = (analytics.data?.byMonth ?? []).map((m) => ({
    month: m.month,
    amount: m.totalActivity,
  }));
  const hasNonZeroMonth = chartData.some((m) => m.amount > 0);

  if (!hasNonZeroMonth) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Total spend by month</CardTitle>
      </CardHeader>
      <CardContent>
        <MonthlyTrendChart data={chartData} currency={currency} />
      </CardContent>
    </Card>
  );
}
