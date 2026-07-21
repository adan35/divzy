// Build-stage TDD coverage for spec-WI-068 §9.1 / story AC-4c as applied to
// the Analytics page's hero stat tiles: "Your spend", "Total activity" and
// the "Most spent category" amount must render through an ANIMATED MoneyText
// (`animate` prop), not a bare `formatMoney()` string. Since these values are
// set on mount here (not `animateOnMount`), no rAF is scheduled and the
// figure is simply the final value on first render — but MoneyText always
// carries an `aria-label` with the final value whenever `animate` is true,
// which a bare formatMoney() string never would. That aria-label — present
// only on the real, wired-up component — is what distinguishes the two
// implementations without needing to stub requestAnimationFrame (already
// exhaustively covered at the unit level by money-text.test.tsx).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { formatMoney } from '@divzy/shared';
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
    yourSpend: 4000,
    totalActivity: 9000,
    previousYourSpend: 3000,
    byCategory: [{ category: 'FOOD_DRINK', amount: 2550 }],
    byMonth: [{ month: '2026-06', amount: 4000, totalActivity: 9000 }],
    byGroup: [],
    usedFallbackRates: false,
    ...overrides,
  };
}

describe('AnalyticsPage — WI-068 stat tile values render through animated MoneyText', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ user: user(), status: 'authed' });
    mockedUseGroups.mockReturnValue(groupsQuery());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('"Your spend" carries an aria-label with the final formatted value (proof `animate` is wired)', () => {
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ data: fixtureSummary() }));
    render(<AnalyticsPage />);

    const el = screen.getByText(formatMoney(4000, 'USD'));
    expect(el).toHaveAttribute('aria-label', formatMoney(4000, 'USD'));
    expect(el.className).toContain('tabular-nums');
  });

  it('"Total activity" carries an aria-label with the final formatted value', () => {
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ data: fixtureSummary() }));
    render(<AnalyticsPage />);

    const el = screen.getByText(formatMoney(9000, 'USD'));
    expect(el).toHaveAttribute('aria-label', formatMoney(9000, 'USD'));
  });

  it('the "Most spent category" amount also carries an aria-label with the final formatted value', () => {
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ data: fixtureSummary() }));
    render(<AnalyticsPage />);

    // The same amount also appears in the "By category" breakdown row (not
    // itself carrying an aria-label — breakdown rows never animate) — scope
    // to the one instance that does.
    const matches = screen.getAllByText(formatMoney(2550, 'USD'));
    const animated = matches.find((el) => el.hasAttribute('aria-label'));
    expect(animated).toHaveAttribute('aria-label', formatMoney(2550, 'USD'));
  });
});
