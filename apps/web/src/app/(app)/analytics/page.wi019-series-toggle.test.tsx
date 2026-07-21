// Build-stage TDD coverage for spec-WI-019 — "You vs total" toggle on the
// analytics monthly-trend chart (web). Mocks useAnalytics/useGroups per this
// domain's existing page-test convention (see stat-cards.test.tsx,
// balances-view.wi013-toggle.test.tsx) and mocks MonthlyTrendChart itself so
// this suite only asserts what data/title the page derives and passes down,
// not recharts/SVG rendering internals.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnalyticsSummaryDto, GroupDto, UserDto } from '@divzy/shared';
import AnalyticsPage from './page';
import { useAuth } from '@/lib/auth-store';
import { useAnalytics, useGroups } from '@/lib/hooks';

vi.mock('@/lib/auth-store', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks')>();
  return { ...actual, useAnalytics: vi.fn(), useGroups: vi.fn() };
});
vi.mock('@/components/analytics/monthly-trend-chart', () => ({
  MonthlyTrendChart: vi.fn(
    ({ data, currency }: { data: Array<{ month: string; amount: number }>; currency: string }) => (
      <div
        data-testid="monthly-trend-chart"
        data-currency={currency}
        data-amounts={JSON.stringify(data.map((d) => d.amount))}
      />
    ),
  ),
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseAnalytics = vi.mocked(useAnalytics);
const mockedUseGroups = vi.mocked(useGroups);

function user(overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: 'u1',
    name: 'Me',
    avatarColor: '#000',
    email: 'me@example.com',
    defaultCurrency: 'USD',
    emailNotifications: true,
    staleBalanceRemindersEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function groupsQuery(data: GroupDto[] = []) {
  return { data, isLoading: false, isError: false, error: null } as unknown as ReturnType<
    typeof useGroups
  >;
}

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
    byCategory: [{ category: 'FOOD_DRINK', amount: 4000 }],
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

describe('AnalyticsPage — WI-019 you/total series toggle', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ user: user(), status: 'authed' });
    mockedUseGroups.mockReturnValue(groupsQuery());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('defaults to "You": title reads "Your spend by month" and the chart renders the amount series', () => {
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ data: fixtureSummary() }));

    render(<AnalyticsPage />);

    expect(screen.getByText('Your spend by month')).toBeInTheDocument();
    expect(screen.queryByText('Total activity by month')).not.toBeInTheDocument();
    expect(screen.getByTestId('monthly-trend-chart')).toHaveAttribute(
      'data-amounts',
      JSON.stringify([1000, 0, 3000]),
    );
    expect(screen.getByRole('radio', { name: 'You' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Total' })).toHaveAttribute('aria-checked', 'false');
  });

  it('toggling to "Total" switches the title and the chart\'s series without a new fetch', async () => {
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ data: fixtureSummary() }));

    render(<AnalyticsPage />);
    const callsBefore = mockedUseAnalytics.mock.calls.length;
    const paramsBefore = mockedUseAnalytics.mock.calls.at(-1)?.[0];

    const testUser = userEvent.setup();
    await testUser.click(screen.getByRole('radio', { name: 'Total' }));

    expect(screen.getByText('Total activity by month')).toBeInTheDocument();
    expect(screen.queryByText('Your spend by month')).not.toBeInTheDocument();
    expect(screen.getByTestId('monthly-trend-chart')).toHaveAttribute(
      'data-amounts',
      JSON.stringify([2000, 0, 7000]),
    );
    expect(screen.getByRole('radio', { name: 'Total' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'You' })).toHaveAttribute('aria-checked', 'false');

    // useAnalytics is a React Query hook re-invoked on every render regardless
    // of whether a network request fires; what must NOT change is the query
    // input object it was called with (from/to/groupId/currency) — `series`
    // is not one of its inputs, so toggling must never alter those params.
    const paramsAfter = mockedUseAnalytics.mock.calls.at(-1)?.[0];
    expect(paramsAfter).toEqual(paramsBefore);
    expect(mockedUseAnalytics.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('toggle is absent during the loading state', () => {
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ isPending: true }));

    render(<AnalyticsPage />);

    expect(screen.queryByRole('radio', { name: 'You' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Total' })).not.toBeInTheDocument();
  });

  it('toggle is absent during the error state', () => {
    mockedUseAnalytics.mockReturnValue(
      analyticsQuery({ isError: true, error: new Error('boom') }),
    );

    render(<AnalyticsPage />);

    expect(screen.queryByRole('radio', { name: 'You' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Total' })).not.toBeInTheDocument();
  });

  it('toggle is absent during the empty state (no expenses in range)', () => {
    mockedUseAnalytics.mockReturnValue(
      analyticsQuery({
        data: fixtureSummary({
          yourSpend: 0,
          totalActivity: 0,
          byMonth: [{ month: '2026-02', amount: 0, totalActivity: 0 }],
        }),
      }),
    );

    render(<AnalyticsPage />);

    expect(screen.getByText('Nothing to chart yet')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'You' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Total' })).not.toBeInTheDocument();
  });

  it('toggle and date-range preset are independent: switching preset preserves the "Total" selection', async () => {
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ data: fixtureSummary() }));

    render(<AnalyticsPage />);
    const testUser = userEvent.setup();

    await testUser.click(screen.getByRole('radio', { name: 'Total' }));
    expect(screen.getByText('Total activity by month')).toBeInTheDocument();

    // Changing the date-range preset must not reset the series toggle.
    await testUser.click(screen.getByRole('radio', { name: '3m' }));
    expect(screen.getByText('Total activity by month')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Total' })).toHaveAttribute('aria-checked', 'true');

    // And switching back to "You" must not disturb the preset selection.
    await testUser.click(screen.getByRole('radio', { name: 'You' }));
    expect(screen.getByRole('radio', { name: '3m' })).toHaveAttribute('aria-checked', 'true');
  });
});
