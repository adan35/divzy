// Build-stage TDD coverage for spec-WI-036 — the dashboard compact
// spend-snapshot chart (analytics' slice). Self-fetching component: mocks
// useAnalytics per this domain's page-test convention (see
// page.wi019-series-toggle.test.tsx, stat-cards.test.tsx). Does NOT mock
// recharts — like MonthlyTrendChart, actual bar rendering isn't unit-tested
// here (jsdom's ResponsiveContainer has no real layout); this suite instead
// covers the component's own business logic: fetch contract (fixed 3-month
// range, no groupId/currency), loading/error/empty states, the headline
// figure, and the fallback-rates disclosure.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { startOfMonth, subMonths } from 'date-fns';
import type { AnalyticsSummaryDto } from '@divzy/shared';
import { formatMoney } from '@divzy/shared';
import { SpendSnapshotChart } from './spend-snapshot-chart';
import { useAnalytics } from '@/lib/hooks';

vi.mock('@/lib/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks')>();
  return { ...actual, useAnalytics: vi.fn() };
});

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
    from: '2026-05-01T00:00:00.000Z',
    to: '2026-07-16T12:00:00.000Z',
    yourSpend: 9000,
    totalActivity: 15000,
    previousYourSpend: 5000,
    byCategory: [],
    byMonth: [
      { month: '2026-05', amount: 2000, totalActivity: 4000 },
      { month: '2026-06', amount: 3000, totalActivity: 6000 },
      { month: '2026-07', amount: 4000, totalActivity: 5000 },
    ],
    byGroup: [],
    usedFallbackRates: false,
    ...overrides,
  };
}

describe('SpendSnapshotChart', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('fetches via useAnalytics with a fixed 3-month range and no groupId/currency override', () => {
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ data: fixtureSummary() }));

    render(<SpendSnapshotChart />);

    const now = new Date('2026-07-16T12:00:00.000Z');
    const expectedFrom = startOfMonth(subMonths(now, 2)).toISOString();
    expect(mockedUseAnalytics).toHaveBeenCalledWith({ from: expectedFrom, to: now.toISOString() });
  });

  it('loading: renders its own skeleton, no headline/error/empty content', () => {
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ isPending: true }));

    render(<SpendSnapshotChart />);

    expect(screen.queryByText('This month')).not.toBeInTheDocument();
    expect(screen.queryByText(/try again/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no spend yet/i)).not.toBeInTheDocument();
  });

  it('error: shows an inline message and a retry button that re-invokes the query', async () => {
    const refetch = vi.fn();
    mockedUseAnalytics.mockReturnValue(
      analyticsQuery({ isError: true, error: new Error('Network blip'), refetch }),
    );

    render(<SpendSnapshotChart />);

    expect(screen.getByText('Network blip')).toBeInTheDocument();
    const testUser = userEvent.setup();
    await testUser.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('zero-spend: shows a friendly empty state, never a blank area or error', () => {
    mockedUseAnalytics.mockReturnValue(
      analyticsQuery({
        data: fixtureSummary({
          yourSpend: 0,
          byMonth: [
            { month: '2026-05', amount: 0, totalActivity: 0 },
            { month: '2026-06', amount: 0, totalActivity: 0 },
            { month: '2026-07', amount: 0, totalActivity: 0 },
          ],
        }),
      }),
    );

    render(<SpendSnapshotChart />);

    expect(screen.getByText(/no spend yet/i)).toBeInTheDocument();
    expect(screen.queryByText('This month')).not.toBeInTheDocument();
  });

  it('loaded: headline reads the current (last) month\'s amount directly off the DTO, not yourSpend', () => {
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ data: fixtureSummary() }));

    render(<SpendSnapshotChart />);

    expect(screen.getByText('This month')).toBeInTheDocument();
    // Last byMonth entry's amount (4000), not yourSpend (9000).
    expect(screen.getByText(formatMoney(4000, 'USD'))).toBeInTheDocument();
    expect(screen.queryByText(formatMoney(9000, 'USD'))).not.toBeInTheDocument();
  });

  it('shows the fallback-rates notice only when usedFallbackRates is true', () => {
    mockedUseAnalytics.mockReturnValue(
      analyticsQuery({ data: fixtureSummary({ usedFallbackRates: true }) }),
    );
    render(<SpendSnapshotChart />);
    expect(screen.getByText('Converted with offline rates')).toBeInTheDocument();
  });

  it('omits the fallback-rates notice when usedFallbackRates is false', () => {
    mockedUseAnalytics.mockReturnValue(
      analyticsQuery({ data: fixtureSummary({ usedFallbackRates: false }) }),
    );
    render(<SpendSnapshotChart />);
    expect(screen.queryByText('Converted with offline rates')).not.toBeInTheDocument();
  });

  it('formats the headline in whatever currency the response echoes (server-resolved default currency)', () => {
    mockedUseAnalytics.mockReturnValue(
      analyticsQuery({
        data: fixtureSummary({
          currency: 'EUR',
          byMonth: [
            { month: '2026-05', amount: 100, totalActivity: 100 },
            { month: '2026-06', amount: 200, totalActivity: 200 },
            { month: '2026-07', amount: 300, totalActivity: 300 },
          ],
        }),
      }),
    );
    render(<SpendSnapshotChart />);
    expect(screen.getByText(formatMoney(300, 'EUR'))).toBeInTheDocument();
  });
});
