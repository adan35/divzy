// Test-stage coverage for WI-060 — `GroupSpendChart` (web, Groups list
// page). Mocks `useAnalytics` per this domain's established convention (see
// spend-snapshot-chart.wi036-snapshot.test.tsx, group-monthly-chart.test.tsx).
// Does NOT mock recharts: `ResponsiveContainer` renders zero-size under jsdom
// (no real layout), so no bar/`<Cell>` DOM ever appears here regardless of
// data — confirmed empirically. This suite therefore covers everything that
// *is* observable at the render level (fetch contract, loading/error/empty
// states, fallback-rates notice, no client-side currency conversion). The
// highlight/fold/empty *decision logic* itself is covered directly against
// the extracted pure module in group-spend-chart-data.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnalyticsSummaryDto } from '@divzy/shared';
import { GroupSpendChart } from './group-spend-chart';
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
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-07-01T00:00:00.000Z',
    yourSpend: 8000,
    totalActivity: 15000,
    previousYourSpend: 5000,
    byCategory: [],
    byMonth: [],
    byGroup: [
      { groupId: 'g1', name: 'Ski trip', emoji: '🎿', amount: 5000 },
      { groupId: 'g2', name: 'Roomies', emoji: '🏠', amount: 3000 },
    ],
    usedFallbackRates: false,
    ...overrides,
  };
}

describe('GroupSpendChart', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('calls useAnalytics with no range/groupId/currency override — inherits the server 6-month default', () => {
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ data: fixtureSummary() }));

    render(<GroupSpendChart />);

    expect(mockedUseAnalytics).toHaveBeenCalledWith();
  });

  it('loading: renders its own skeleton, no chart/error/empty content', () => {
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ isPending: true }));

    render(<GroupSpendChart />);

    expect(screen.queryByRole('img', { name: 'Spend by group' })).not.toBeInTheDocument();
    expect(screen.queryByText(/try again/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no group spend yet/i)).not.toBeInTheDocument();
  });

  it('error: shows an inline message and a retry button that re-invokes the query — a chart-local failure, not a page-level one', async () => {
    const refetch = vi.fn();
    mockedUseAnalytics.mockReturnValue(
      analyticsQuery({ isError: true, error: new Error('Network blip'), refetch }),
    );

    render(<GroupSpendChart />);

    expect(screen.getByText('Network blip')).toBeInTheDocument();
    const testUser = userEvent.setup();
    await testUser.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('empty byGroup: shows the "No group spend yet" inline message, never a blank chart or error', () => {
    mockedUseAnalytics.mockReturnValue(
      analyticsQuery({ data: fixtureSummary({ byGroup: [] }) }),
    );

    render(<GroupSpendChart />);

    expect(screen.getByText('No group spend yet')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Spend by group' })).not.toBeInTheDocument();
  });

  it('non-empty byGroup renders the chart area (not the empty state), scoped by the "Spend by group" label', () => {
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ data: fixtureSummary() }));

    render(<GroupSpendChart />);

    expect(screen.getByRole('img', { name: 'Spend by group' })).toBeInTheDocument();
    expect(screen.queryByText('No group spend yet')).not.toBeInTheDocument();
  });

  it('shows the fallback-rates notice only when usedFallbackRates is true', () => {
    mockedUseAnalytics.mockReturnValue(
      analyticsQuery({ data: fixtureSummary({ usedFallbackRates: true }) }),
    );
    render(<GroupSpendChart />);
    expect(screen.getByText('Converted with offline rates')).toBeInTheDocument();
  });

  it('omits the fallback-rates notice when usedFallbackRates is false', () => {
    mockedUseAnalytics.mockReturnValue(
      analyticsQuery({ data: fixtureSummary({ usedFallbackRates: false }) }),
    );
    render(<GroupSpendChart />);
    expect(screen.queryByText('Converted with offline rates')).not.toBeInTheDocument();
  });

  it('renders cleanly for a zero-decimal currency (JPY) and a large amount without crashing or falling into the empty/error branch', () => {
    // jsdom's zero-size ResponsiveContainer means recharts never mounts an
    // actual `<svg>`/bar/tooltip here (confirmed empirically — see the
    // module doc-comment on group-spend-chart-data.ts), so this suite
    // cannot assert the rendered tooltip/tick text directly. The "amounts
    // pass through verbatim, no client-side conversion" claim is instead
    // authoritatively covered at the data layer in
    // group-spend-chart-data.test.ts ("preserving amount... verbatim").
    // This test only guards that a real DTO shape (0-decimal currency,
    // 6-digit amount) still renders the chart area, not an error/empty state.
    mockedUseAnalytics.mockReturnValue(
      analyticsQuery({
        data: fixtureSummary({
          currency: 'JPY',
          byGroup: [{ groupId: 'g1', name: 'Tokyo trip', emoji: '🗼', amount: 123456 }],
        }),
      }),
    );

    render(<GroupSpendChart />);

    expect(screen.getByRole('img', { name: 'Spend by group' })).toBeInTheDocument();
    expect(screen.queryByText('No group spend yet')).not.toBeInTheDocument();
    expect(screen.queryByText(/try again/i)).not.toBeInTheDocument();
  });
});
