// spec-WI-061 — GroupSpendChart moves from above the groups list to after it
// (after the active grid AND the archived section, before GroupFormDialog).
// This suite asserts DOM render order only; the chart's own internal
// loading/error/empty behavior is analytics-owned (WI-060) and untouched, so
// it is stubbed here exactly like the sibling WI-027/028/038 suite does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupSummaryDto } from '@divzy/shared';
import GroupsPage from './page';
import { useAuth } from '@/lib/auth-store';
import { useCreateGroup, useGroups, useUnarchiveGroup, useUpdateGroup } from '@/lib/hooks';

const pushMock = vi.fn();
const searchParamsValue = { get: () => null };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  useSearchParams: () => searchParamsValue,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/auth-store', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/hooks', () => ({
  useGroups: vi.fn(),
  useUnarchiveGroup: vi.fn(),
  useCreateGroup: vi.fn(),
  useUpdateGroup: vi.fn(),
  errorMessage: (err: unknown) => (err instanceof Error ? err.message : 'error'),
}));
// Marker stub standing in for the real (analytics-owned, self-fetching)
// chart — a unique, findable node lets us assert DOM position without
// needing to also mock useAnalytics().
vi.mock('@/components/groups/group-spend-chart', () => ({
  GroupSpendChart: () => <div data-testid="spend-chart-marker">SPEND CHART</div>,
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseGroups = vi.mocked(useGroups);
const mockedUseUnarchiveGroup = vi.mocked(useUnarchiveGroup);
const mockedUseCreateGroup = vi.mocked(useCreateGroup);
const mockedUseUpdateGroup = vi.mocked(useUpdateGroup);

function fixtureGroup(overrides: Partial<GroupSummaryDto> = {}): GroupSummaryDto {
  return {
    id: 'group-1',
    name: 'Lisbon trip',
    emoji: '✈️',
    type: 'TRIP',
    currency: 'USD',
    memberCount: 3,
    yourBalances: [],
    yourBalancesNative: [],
    yourBalanceConverted: null,
    usedFallbackRates: false,
    lastActivityAt: '2026-07-01T00:00:00.000Z',
    archivedAt: null,
    settled: false,
    ...overrides,
  };
}

/** True if `after` appears later in document order than `before`. */
function isAfter(before: Element, after: Element): boolean {
  return !!(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('GroupsPage — GroupSpendChart mount order (WI-061)', () => {
  beforeEach(() => {
    localStorage.clear();
    // @ts-expect-error -- test setup only
    mockedUseAuth.mockReturnValue({ user: { id: 'me', defaultCurrency: 'USD' } });
    // @ts-expect-error -- test setup only
    mockedUseCreateGroup.mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only
    mockedUseUpdateGroup.mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only
    mockedUseUnarchiveGroup.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the chart after the active grid and the (collapsed) archived section', () => {
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroups.mockReturnValue({
      data: [
        fixtureGroup({ id: 'g-active', name: 'Roomies', archivedAt: null }),
        fixtureGroup({ id: 'g-archived', name: 'Old crew', archivedAt: '2026-06-01T00:00:00.000Z' }),
      ],
      isLoading: false,
      isError: false,
    });

    render(<GroupsPage />);

    const chart = screen.getByTestId('spend-chart-marker');
    const activeCard = screen.getByText('Roomies');
    const archivedToggle = screen.getByRole('button', { name: /archived/i });

    expect(isAfter(activeCard, chart)).toBe(true);
    expect(isAfter(archivedToggle, chart)).toBe(true);
  });

  it('renders the chart after the archived section when it is expanded', async () => {
    const user = userEvent.setup();
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroups.mockReturnValue({
      data: [
        fixtureGroup({ id: 'g-active', name: 'Roomies', archivedAt: null }),
        fixtureGroup({ id: 'g-archived', name: 'Old crew', archivedAt: '2026-06-01T00:00:00.000Z' }),
      ],
      isLoading: false,
      isError: false,
    });

    render(<GroupsPage />);
    await user.click(screen.getByRole('button', { name: /archived/i }));

    const chart = screen.getByTestId('spend-chart-marker');
    const archivedCard = screen.getByText('Old crew');
    expect(isAfter(archivedCard, chart)).toBe(true);
  });

  it('renders the chart after the "No active groups" empty state when only archived groups exist', () => {
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroups.mockReturnValue({
      data: [fixtureGroup({ id: 'g-archived', name: 'Old crew', archivedAt: '2026-06-01T00:00:00.000Z' })],
      isLoading: false,
      isError: false,
    });

    render(<GroupsPage />);

    const chart = screen.getByTestId('spend-chart-marker');
    const emptyState = screen.getByText('No active groups');
    expect(isAfter(emptyState, chart)).toBe(true);
  });

  it('still renders the chart when groups.data is loading, errored, or fully empty', () => {
    // Loading state.
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroups.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { unmount: unmountLoading } = render(<GroupsPage />);
    expect(screen.getByTestId('spend-chart-marker')).toBeInTheDocument();
    unmountLoading();

    // Error state.
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroups.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('boom'),
      refetch: vi.fn(),
    });
    const { unmount: unmountError } = render(<GroupsPage />);
    expect(screen.getByTestId('spend-chart-marker')).toBeInTheDocument();
    unmountError();

    // Zero groups at all.
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroups.mockReturnValue({ data: [], isLoading: false, isError: false });
    render(<GroupsPage />);
    expect(screen.getByTestId('spend-chart-marker')).toBeInTheDocument();
  });

  it('leaves the unsettled-only toggle and balance filter positioned ahead of the group cards, unaffected by the chart move', () => {
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroups.mockReturnValue({
      data: [fixtureGroup({ id: 'g-active', name: 'Roomies', archivedAt: null })],
      isLoading: false,
      isError: false,
    });

    render(<GroupsPage />);

    const toggle = screen.getByRole('switch', { name: /unsettled only/i });
    const filterSelect = screen.getByRole('combobox', { name: /filter groups/i });
    const activeCard = screen.getByText('Roomies');
    const chart = screen.getByTestId('spend-chart-marker');

    expect(isAfter(toggle, activeCard)).toBe(true);
    expect(isAfter(filterSelect, activeCard)).toBe(true);
    expect(isAfter(activeCard, chart)).toBe(true);
  });
});
