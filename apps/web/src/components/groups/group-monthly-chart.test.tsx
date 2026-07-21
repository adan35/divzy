// Build-stage TDD coverage for spec-WI-059 — group Totals tab monthly
// total-expenditure chart (web). Mocks useAnalytics per this domain's
// existing convention (see analytics/page.wi019-series-toggle.test.tsx) and
// mocks MonthlyTrendChart itself so this suite only asserts what data/
// currency the wrapper derives and passes down, not recharts internals.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { AnalyticsSummaryDto } from '@divzy/shared';
import { GroupMonthlyChart } from './group-monthly-chart';
import { useAnalytics } from '@/lib/hooks';

vi.mock('@/lib/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks')>();
  return { ...actual, useAnalytics: vi.fn() };
});
vi.mock('@/components/analytics/monthly-trend-chart', () => ({
  MonthlyTrendChart: vi.fn(
    ({ data, currency }: { data: Array<{ month: string; amount: number }>; currency: string }) => (
      <div
        data-testid="monthly-trend-chart"
        data-currency={currency}
        data-months={JSON.stringify(data.map((d) => d.month))}
        data-amounts={JSON.stringify(data.map((d) => d.amount))}
      />
    ),
  ),
}));

const mockedUseAnalytics = vi.mocked(useAnalytics);

function analyticsQuery(
  overrides: Partial<ReturnType<typeof useAnalytics>> = {},
): ReturnType<typeof useAnalytics> {
  return {
    isPending: false,
    isError: false,
    data: undefined,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useAnalytics>;
}

function fixtureSummary(overrides: Partial<AnalyticsSummaryDto> = {}): AnalyticsSummaryDto {
  return {
    currency: 'USD',
    from: '2026-02-01T00:00:00.000Z',
    to: '2026-07-01T00:00:00.000Z',
    yourSpend: 4000,
    totalActivity: 9000,
    previousYourSpend: 3000,
    byCategory: [],
    byMonth: [
      { month: '2026-02', amount: 1000, totalActivity: 2000 },
      { month: '2026-03', amount: 0, totalActivity: 0 },
      { month: '2026-04', amount: 3000, totalActivity: 7000 },
    ],
    byGroup: [],
    usedFallbackRates: false,
    ...overrides,
  };
}

describe('GroupMonthlyChart (WI-059)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('requests useAnalytics scoped to the group and its home currency', () => {
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ data: fixtureSummary() }));

    render(<GroupMonthlyChart groupId="g1" currency="PKR" />);

    expect(mockedUseAnalytics).toHaveBeenCalledWith({ groupId: 'g1', currency: 'PKR' });
  });

  it('plots totalActivity, not the viewer-share amount — the load-bearing field distinction', () => {
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ data: fixtureSummary() }));

    render(<GroupMonthlyChart groupId="g1" currency="USD" />);

    expect(screen.getByTestId('monthly-trend-chart')).toHaveAttribute(
      'data-amounts',
      JSON.stringify([2000, 0, 7000]),
    );
  });

  it('passes the group currency through to the chart, not any viewer-default currency baked into the fetched data', () => {
    mockedUseAnalytics.mockReturnValue(
      analyticsQuery({ data: fixtureSummary({ currency: 'EUR' }) }),
    );

    render(<GroupMonthlyChart groupId="g1" currency="PKR" />);

    expect(screen.getByTestId('monthly-trend-chart')).toHaveAttribute('data-currency', 'PKR');
  });

  it('zero-fills a month with no activity in chronological order, not skipped', () => {
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ data: fixtureSummary() }));

    render(<GroupMonthlyChart groupId="g1" currency="USD" />);

    expect(screen.getByTestId('monthly-trend-chart')).toHaveAttribute(
      'data-months',
      JSON.stringify(['2026-02', '2026-03', '2026-04']),
    );
  });

  it('loading state renders a placeholder, not the chart', () => {
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ isPending: true }));

    render(<GroupMonthlyChart groupId="g1" currency="USD" />);

    expect(screen.queryByTestId('monthly-trend-chart')).not.toBeInTheDocument();
  });

  it('error state renders a retry affordance, not the chart', () => {
    const refetch = vi.fn();
    mockedUseAnalytics.mockReturnValue(
      analyticsQuery({ isError: true, error: new Error('Could not load'), refetch }),
    );

    render(<GroupMonthlyChart groupId="g1" currency="USD" />);

    expect(screen.queryByTestId('monthly-trend-chart')).not.toBeInTheDocument();
    expect(screen.getByText(/Could not load/)).toBeInTheDocument();
  });

  it('all-zero months render nothing (no broken/empty chart) — the host tab already shows an empty state for a brand-new group', () => {
    mockedUseAnalytics.mockReturnValue(
      analyticsQuery({
        data: fixtureSummary({
          byMonth: [
            { month: '2026-02', amount: 0, totalActivity: 0 },
            { month: '2026-03', amount: 0, totalActivity: 0 },
          ],
        }),
      }),
    );

    const { container } = render(<GroupMonthlyChart groupId="g1" currency="USD" />);

    expect(screen.queryByTestId('monthly-trend-chart')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
