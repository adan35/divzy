// Regression coverage for story-WI-032 (reopened under analytics
// 2026-07-17: "category filter/breakdown still shows ALL categories, not
// just ones with expenses in view"). Design-stage investigation
// (.company/domains/analytics/specs/spec-WI-032.md) found the page's
// categoryRows useMemo (page.tsx lines ~95-105) already filters
// `data.byCategory` to `c.amount > 0` before rendering, as a client-side
// defense-in-depth on top of the server already dropping zero totals. This
// test locks that client-side filter in directly so a future edit to
// categoryRows can't silently regress it and reopen this complaint a third
// time. Harness follows page.wi019-series-toggle.test.tsx's established
// mocking convention.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
  MonthlyTrendChart: vi.fn(() => <div data-testid="monthly-trend-chart" />),
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
    yourSpend: 6000,
    totalActivity: 9000,
    previousYourSpend: 3000,
    byCategory: [
      { category: 'FOOD_DRINK', amount: 4000 },
      { category: 'TRANSPORT', amount: 2000 },
    ],
    byMonth: [{ month: '2026-06', amount: 6000, totalActivity: 9000 }],
    byGroup: [],
    usedFallbackRates: false,
    ...overrides,
  };
}

describe('AnalyticsPage — WI-032 category breakdown excludes zero-amount categories', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ user: user(), status: 'authed' });
    mockedUseGroups.mockReturnValue(groupsQuery());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders only nonzero-amount categories in the By category breakdown', () => {
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ data: fixtureSummary() }));

    render(<AnalyticsPage />);

    // "Food & drink" also appears in the "Most spent category" stat tile
    // (it's the top category), so at least one instance is the minimum bar.
    expect(screen.getAllByText('Food & drink').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Transport')).toBeInTheDocument();
  });

  it('excludes a zero-amount category from the rendered breakdown even if present in the fetched data (client-side defense-in-depth on top of the server filter)', () => {
    mockedUseAnalytics.mockReturnValue(
      analyticsQuery({
        data: fixtureSummary({
          byCategory: [
            { category: 'FOOD_DRINK', amount: 4000 },
            { category: 'TRANSPORT', amount: 2000 },
            // Zero net amount for the caller in this range (e.g. the caller
            // paid but has no split share) — must never render as a row.
            { category: 'HOME', amount: 0 },
          ],
        }),
      }),
    );

    render(<AnalyticsPage />);

    expect(screen.getAllByText('Food & drink').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Transport')).toBeInTheDocument();
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
  });

  it('"Most spent category" stat also ignores the zero-amount category', () => {
    mockedUseAnalytics.mockReturnValue(
      analyticsQuery({
        data: fixtureSummary({
          yourSpend: 4000,
          byCategory: [
            // HOME would rank first if amount comparisons ever ran before
            // filtering, but it is zero and must be excluded before ranking.
            { category: 'HOME', amount: 0 },
            { category: 'FOOD_DRINK', amount: 4000 },
          ],
        }),
      }),
    );

    render(<AnalyticsPage />);

    expect(screen.getByText('Most spent category')).toBeInTheDocument();
    // FOOD_DRINK is now the only (and therefore top) category — it must be
    // the one rendered as "Most spent category", not HOME.
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
    expect(screen.getAllByText('Food & drink').length).toBeGreaterThanOrEqual(1);
  });
});
