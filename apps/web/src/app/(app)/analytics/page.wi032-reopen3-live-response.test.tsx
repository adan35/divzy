// Regression coverage for story-WI-032-reopen3 (analytics category
// breakdown, reopened a 3rd time). Closes a rigor gap flagged by
// test-analytics against `qa-WI-032-reopen3.md`: that artifact's web
// evidence was a `Read`/`grep` structural inference over `page.tsx`, not an
// actual rendered-DOM test, even though this repo has a working
// `@testing-library/react` harness (see
// `page.wi032-category-zero-exclusion.test.tsx`, the second closure's own
// render test, whose mocking convention this file follows verbatim).
//
// The fixture below is NOT hand-authored. It is the exact, unmodified JSON
// body returned by a live `GET /api/v1/analytics/summary?groupId=<id>&
// currency=EUR` call against a freshly booted real API process + real
// Postgres rows seeded through real `POST /auth/register` /
// `POST /groups` / `POST /expenses` calls — the same live round-trip
// documented in `.company/domains/analytics/reviews/qa-WI-032-reopen3.md`,
// re-run this session via the same script
// (`/tmp/.../scratchpad/wi032-reopen3-live-verify.mjs`, captured as
// `wi032-live-response-full.json`) to obtain the full DTO (the original run
// only logged the `byCategory` slice). Only the network layer is mocked
// (`useAnalytics`); everything downstream — `categoryRows` filtering,
// `categoryInfo` label lookup, and `BreakdownRows` rendering — is real,
// unmocked component code exercised end-to-end.
//
// Live response captured 2026-07-18, group-scoped request, caller seeded
// with: (a) FOOD_DRINK, EQUAL split incl. caller (nonzero share) — MUST
// render; (b) ENTERTAINMENT, caller paid in full but zero split share — the
// discriminating case both prior closures hinged on — MUST NOT render;
// (c) TRAVEL never seeded in this group — MUST NOT render.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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
    defaultCurrency: 'EUR',
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

// Verbatim `GET /api/v1/analytics/summary?groupId=<id>&currency=EUR` response
// body from a live, freshly booted API process against real Postgres rows —
// captured this session, group id/name redacted-nothing (kept as returned).
// Do not hand-edit; if this ever needs to change, re-run the live script and
// re-paste the full captured body.
const LIVE_RESPONSE: AnalyticsSummaryDto = {
  currency: 'EUR',
  from: '2026-02-01T00:00:00.000Z',
  to: '2026-07-18T13:06:50.654Z',
  yourSpend: 5000,
  totalActivity: 18000,
  previousYourSpend: 0,
  byCategory: [{ category: 'FOOD_DRINK', amount: 5000 }],
  byMonth: [
    { month: '2026-02', amount: 0, totalActivity: 0 },
    { month: '2026-03', amount: 0, totalActivity: 0 },
    { month: '2026-04', amount: 0, totalActivity: 0 },
    { month: '2026-05', amount: 0, totalActivity: 0 },
    { month: '2026-06', amount: 0, totalActivity: 0 },
    { month: '2026-07', amount: 5000, totalActivity: 18000 },
  ],
  byGroup: [
    { groupId: 'cmrqdsbna00c5mv1bzw40tg13', name: 'WI032 mrqdsafw', emoji: '🧾', amount: 5000 },
  ],
  usedFallbackRates: false,
};

describe('AnalyticsPage — WI-032-reopen3 real render fed by a live-captured API response', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ user: user(), status: 'authed' });
    mockedUseGroups.mockReturnValue(groupsQuery());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders only FOOD_DRINK in the By category breakdown; ENTERTAINMENT and TRAVEL never render anywhere on the page', () => {
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ data: LIVE_RESPONSE }));

    render(<AnalyticsPage />);

    // Scope to the "By category" card specifically — that's the section this
    // gap is about — not just the whole-page absence check below.
    const categoryHeading = screen.getByText('By category');
    const categoryCard = categoryHeading.closest('div')?.parentElement;
    expect(categoryCard).not.toBeNull();
    const categorySection = within(categoryCard as HTMLElement);

    expect(categorySection.getByText('Food & drink')).toBeInTheDocument();
    expect(categorySection.queryByText('Entertainment')).not.toBeInTheDocument();
    expect(categorySection.queryByText('Travel')).not.toBeInTheDocument();

    // Whole-page belt-and-suspenders: the live response's byCategory has a
    // single row, so nothing on the page should render the other two labels
    // at all (not even in "Most spent category", which also derives from
    // categoryRows).
    expect(screen.queryByText('Entertainment')).not.toBeInTheDocument();
    expect(screen.queryByText('Travel')).not.toBeInTheDocument();
    expect(screen.getAllByText('Food & drink').length).toBeGreaterThanOrEqual(1);
  });
});
