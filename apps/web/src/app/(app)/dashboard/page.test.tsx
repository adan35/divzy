import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ActivityDto, AnalyticsSummaryDto, UserDto } from '@divzy/shared';
import { formatMoney } from '@divzy/shared';
import { useAuth } from '@/lib/auth-store';
import { useActivityInfinite, useAnalytics, useFriends, useGroups } from '@/lib/hooks';
import DashboardPage from './page';

// spec-WI-036 (notifications-activity slice): the chart slot is a new SIBLING
// section, never a child of the Recent Activity preview, and must not
// regress the existing preview (Story 2 — this file is the Build/QA
// regression gate named in §4 of the spec).
//
// The real SpendSnapshotChart (analytics-owned) is rendered inside the slot
// (not a placeholder), so useAnalytics is mocked here — same convention as
// spend-snapshot-chart.wi036-snapshot.test.tsx — purely to prove the wiring:
// this file is not the place for the chart's own business-logic coverage.

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/auth-store', () => ({ useAuth: vi.fn() }));
vi.mock('@/components/expenses/expense-detail', () => ({ ExpenseDetailDialog: () => null }));
vi.mock('@/components/settle/settlement-detail', () => ({ SettlementDetailDialog: () => null }));
vi.mock('@/lib/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks')>();
  return {
    ...actual,
    useGroups: vi.fn(),
    useFriends: vi.fn(),
    useActivityInfinite: vi.fn(),
    useAnalytics: vi.fn(),
  };
});
// Heavy siblings unrelated to this regression gate — stub them out so this
// file stays focused on chart-slot placement + the Recent Activity preview.
vi.mock('@/components/dashboard/pulse-hero', () => ({ PulseHero: () => null }));
vi.mock('@/components/dashboard/quick-actions', () => ({ QuickActions: () => null }));
vi.mock('@/components/dashboard/groups-preview', () => ({ GroupsPreview: () => null }));
vi.mock('@/components/dashboard/friends-preview', () => ({ FriendsPreview: () => null }));
vi.mock('@/components/dashboard/onboarding', () => ({ OnboardingCard: () => <div>onboarding</div> }));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseGroups = vi.mocked(useGroups);
const mockedUseFriends = vi.mocked(useFriends);
const mockedUseActivityInfinite = vi.mocked(useActivityInfinite);
const mockedUseAnalytics = vi.mocked(useAnalytics);

function user(overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: 'me',
    name: 'Me',
    avatarColor: '#000',
    email: 'me@example.com',
    defaultCurrency: 'GBP',
    emailNotifications: true,
    staleBalanceRemindersEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function activityItem(overrides: Partial<ActivityDto> = {}): ActivityDto {
  return {
    id: 'act-1',
    type: 'EXPENSE_ADDED',
    actor: { id: 'friend-1', name: 'Sam', avatarColor: '#111' },
    group: null,
    expenseId: 'exp-1',
    settlementId: null,
    data: { description: 'Groceries', amount: 4210, currency: 'GBP' },
    deletedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function groupsQuery(data: unknown) {
  return { data, isSuccess: true } as unknown as ReturnType<typeof useGroups>;
}
function friendsQuery(data: unknown) {
  return { data, isSuccess: true } as unknown as ReturnType<typeof useFriends>;
}
function activityQuery(items: ActivityDto[], overrides: Record<string, unknown> = {}) {
  return {
    data: { pages: [{ items, nextCursor: null }] },
    isPending: false,
    isError: false,
    error: null,
    isSuccess: true,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useActivityInfinite>;
}

// Fixture + mock for the real SpendSnapshotChart rendered inside the slot —
// proves the wiring, not the chart's own logic (see spend-snapshot-chart
// .wi036-snapshot.test.tsx for that coverage).
function analyticsSummary(overrides: Partial<AnalyticsSummaryDto> = {}): AnalyticsSummaryDto {
  return {
    currency: 'GBP',
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
function analyticsQuery(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof useAnalytics> {
  return {
    data: analyticsSummary(),
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useAnalytics>;
}

describe('DashboardPage — chart slot placement + Recent Activity regression (WI-036)', () => {
  it('renders the chart slot as a sibling section, never wrapping/inside Recent Activity, and the preview still shows its items', async () => {
    mockedUseAuth.mockReturnValue({ user: user(), status: 'authed' });
    mockedUseGroups.mockReturnValue(groupsQuery([{ id: 'g1', archivedAt: null }]));
    mockedUseFriends.mockReturnValue(friendsQuery([{ user: { id: 'f1', name: 'Sam' } }]));
    mockedUseActivityInfinite.mockReturnValue(activityQuery([activityItem()]));
    mockedUseAnalytics.mockReturnValue(analyticsQuery());

    render(<DashboardPage />);

    const chartSlot = screen.getByLabelText('Spend chart');
    const recentActivity = screen.getByLabelText('Recent activity');

    expect(chartSlot).toBeInTheDocument();
    expect(recentActivity).toBeInTheDocument();
    // Sibling, not nested either direction.
    expect(chartSlot).not.toContainElement(recentActivity);
    expect(recentActivity).not.toContainElement(chartSlot);

    // The real SpendSnapshotChart is wired into the slot (not the "coming
    // soon" placeholder): its headline label and current-month figure render
    // inside the slot, sourced from the mocked useAnalytics data.
    expect(screen.queryByText('Spend chart coming soon')).not.toBeInTheDocument();
    const thisMonthLabel = await screen.findByText('This month');
    expect(chartSlot).toContainElement(thisMonthLabel);
    expect(screen.getByText(formatMoney(4000, 'GBP'))).toBeInTheDocument();

    // Regression: Recent Activity still renders its existing item content.
    expect(screen.getByText(/added/)).toBeInTheDocument();
    expect(screen.getByText('See all')).toBeInTheDocument();
  });

  it('keeps the empty activity state unchanged, independent of the chart slot', () => {
    mockedUseAuth.mockReturnValue({ user: user(), status: 'authed' });
    mockedUseGroups.mockReturnValue(groupsQuery([{ id: 'g1', archivedAt: null }]));
    mockedUseFriends.mockReturnValue(friendsQuery([{ user: { id: 'f1', name: 'Sam' } }]));
    mockedUseActivityInfinite.mockReturnValue(activityQuery([]));
    mockedUseAnalytics.mockReturnValue(analyticsQuery());

    render(<DashboardPage />);

    expect(screen.getByLabelText('Spend chart')).toBeInTheDocument();
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });

  it('does not render the chart slot (or Recent Activity) on the brand-new-account onboarding branch', () => {
    mockedUseAuth.mockReturnValue({ user: user(), status: 'authed' });
    mockedUseGroups.mockReturnValue(groupsQuery([]));
    mockedUseFriends.mockReturnValue(friendsQuery([]));
    mockedUseActivityInfinite.mockReturnValue(activityQuery([]));

    render(<DashboardPage />);

    expect(screen.queryByLabelText('Spend chart')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Recent activity')).not.toBeInTheDocument();
  });
});
