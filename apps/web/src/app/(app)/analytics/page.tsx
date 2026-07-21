'use client';

import { useMemo, useState } from 'react';
import { startOfMonth, subMonths } from 'date-fns';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { categoryInfo } from '@divzy/shared';
import { useAnalytics, useGroups, errorMessage } from '@/lib/hooks';
import { useAuth } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CurrencySelect } from '@/components/ui/currency-select';
import { EmptyState } from '@/components/ui/empty-state';
import { MoneyText } from '@/components/ui/money-text';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  BreakdownRows,
  foldRows,
  type BreakdownRowDatum,
} from '@/components/analytics/breakdown-rows';
import { MonthlyTrendChart } from '@/components/analytics/monthly-trend-chart';
import { SpendDelta, StatTile } from '@/components/analytics/stat-tiles';
import { useChartTheme } from '@/components/analytics/palette';

type RangePreset = '3m' | '6m' | '12m' | 'ytd';
type Series = 'you' | 'total';

const PRESET_OPTIONS: ReadonlyArray<{ value: RangePreset; label: string }> = [
  { value: '3m', label: '3m' },
  { value: '6m', label: '6m' },
  { value: '12m', label: '12m' },
  { value: 'ytd', label: 'YTD' },
];

const SERIES_OPTIONS: ReadonlyArray<{ value: Series; label: string }> = [
  { value: 'you', label: 'You' },
  { value: 'total', label: 'Total' },
];

function rangeFor(preset: RangePreset): { from: string; to: string } {
  const now = new Date();
  if (preset === 'ytd') {
    return { from: new Date(now.getFullYear(), 0, 1).toISOString(), to: now.toISOString() };
  }
  const months = preset === '3m' ? 3 : preset === '6m' ? 6 : 12;
  return {
    from: startOfMonth(subMonths(now, months - 1)).toISOString(),
    to: now.toISOString(),
  };
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-[320px]" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const { user: me } = useAuth();
  const groupsQuery = useGroups();
  const { palette } = useChartTheme();

  const [preset, setPreset] = useState<RangePreset>('6m');
  const [groupId, setGroupId] = useState('');
  const [currencyOverride, setCurrencyOverride] = useState<string | null>(null);
  // Independent of the query inputs above (not part of useAnalytics's key) —
  // a pure client-side render switch over already-fetched data.byMonth, so
  // toggling never triggers a refetch and never resets the other controls.
  const [series, setSeries] = useState<Series>('you');

  const range = useMemo(() => rangeFor(preset), [preset]);
  const currency = currencyOverride ?? me?.defaultCurrency ?? 'USD';

  const analytics = useAnalytics({
    from: range.from,
    to: range.to,
    groupId: groupId || undefined,
    currency,
  });

  const data = analytics.data;

  const categoryRows: BreakdownRowDatum[] = useMemo(() => {
    if (!data) return [];
    const rows = data.byCategory
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .map((c) => {
        const info = categoryInfo(c.category);
        return { key: c.category, label: info.label, emoji: info.emoji, amount: c.amount };
      });
    return foldRows(rows);
  }, [data]);

  const groupRows: BreakdownRowDatum[] = useMemo(() => {
    if (!data) return [];
    const rows = data.byGroup
      .filter((g) => g.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .map((g) => ({ key: g.groupId, label: g.name, emoji: g.emoji, amount: g.amount }));
    return foldRows(rows);
  }, [data]);

  const trendData = useMemo(() => {
    if (!data) return [];
    return data.byMonth.map((m) => ({
      month: m.month,
      amount: series === 'you' ? m.amount : m.totalActivity,
    }));
  }, [data, series]);

  const topCategory = categoryRows.find((r) => r.key !== '__other__') ?? null;
  const isEmpty = data !== undefined && data.yourSpend === 0 && data.totalActivity === 0;

  const groups = groupsQuery.data ?? [];

  return (
    <>
      <PageHeader title="Analytics" subtitle="Where your money actually goes." />

      {/* Controls: range presets, optional group filter, display currency. */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <SegmentedControl
          aria-label="Date range"
          options={PRESET_OPTIONS}
          value={preset}
          onChange={setPreset}
        />
        <Select
          aria-label="Filter by group"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="w-48"
        >
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.emoji} {g.name}
              {g.archivedAt ? ' (archived)' : ''}
            </option>
          ))}
        </Select>
        <CurrencySelect
          value={currency}
          onChange={setCurrencyOverride}
          className="w-36"
        />
      </div>

      {data?.usedFallbackRates && (
        <p className="mb-4 inline-flex items-center gap-1.5 rounded-lg bg-warn-soft px-2.5 py-1.5 text-[13px] text-warn">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Converted with offline rates
        </p>
      )}

      {analytics.isPending ? (
        <AnalyticsSkeleton />
      ) : analytics.isError ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="max-w-sm text-sm text-ink-2">{errorMessage(analytics.error)}</p>
          <Button variant="outline" size="sm" onClick={() => void analytics.refetch()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </Card>
      ) : isEmpty ? (
        <EmptyState
          emoji="📊"
          title="Nothing to chart yet"
          hint="Add a few expenses and your spending trends will show up here."
        />
      ) : data ? (
        <div className="space-y-6">
          {/* Hero tiles */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile
              label="Your spend"
              value={<MoneyText animate amount={data.yourSpend} currency={data.currency} />}
              sub={<SpendDelta current={data.yourSpend} previous={data.previousYourSpend} />}
            />
            <StatTile
              label="Total activity"
              value={<MoneyText animate amount={data.totalActivity} currency={data.currency} />}
              sub={<span className="text-ink-3">everything you were part of</span>}
            />
            <StatTile
              label="Most spent category"
              value={
                topCategory ? (
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true">{topCategory.emoji}</span>
                    <span className="truncate text-2xl">{topCategory.label}</span>
                  </span>
                ) : (
                  '—'
                )
              }
              sub={
                topCategory ? (
                  <span className="text-ink-3">
                    <MoneyText animate amount={topCategory.amount} currency={data.currency} />
                    {' in this range'}
                  </span>
                ) : (
                  <span className="text-ink-3">no categorized spend</span>
                )
              }
            />
          </div>

          {/* Monthly trend */}
          <Card>
            <CardHeader>
              <CardTitle>
                {series === 'you' ? 'Your spend by month' : 'Total activity by month'}
              </CardTitle>
              <SegmentedControl
                aria-label="Chart series"
                size="sm"
                options={SERIES_OPTIONS}
                value={series}
                onChange={setSeries}
              />
            </CardHeader>
            <CardContent>
              <MonthlyTrendChart data={trendData} currency={data.currency} />
            </CardContent>
          </Card>

          {/* Breakdowns */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>By category</CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownRows rows={categoryRows} currency={data.currency} palette={palette} />
              </CardContent>
            </Card>
            {!groupId && (
              <Card>
                <CardHeader>
                  <CardTitle>By group</CardTitle>
                </CardHeader>
                <CardContent>
                  {groupRows.length === 0 ? (
                    <p className="py-6 text-center text-sm text-ink-3">
                      No group spend in this range — everything was one-on-one.
                    </p>
                  ) : (
                    <BreakdownRows rows={groupRows} currency={data.currency} palette={palette} />
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
