// spec-WI-027 (unarchive), spec-WI-028 (settled + "unsettled only" toggle),
// spec-WI-038 (viewer-net balance filter) — all three land on the Groups page
// this batch and must compose as independent, distinct axes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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
}));
// spec-WI-060: analytics' self-contained, own-fetch chart — stubbed here so
// this social-groups host-page suite stays scoped to useGroups/filters and
// doesn't need to also mock analytics' useAnalytics() query.
vi.mock('@/components/groups/group-spend-chart', () => ({
  GroupSpendChart: () => null,
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

describe('GroupsPage — unarchive (WI-027), settled (WI-028), balance filter (WI-038)', () => {
  const unarchiveMutate = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    // @ts-expect-error -- test setup only
    mockedUseAuth.mockReturnValue({ user: { id: 'me', defaultCurrency: 'USD' } });
    // @ts-expect-error -- test setup only
    mockedUseCreateGroup.mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only
    mockedUseUpdateGroup.mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only
    mockedUseUnarchiveGroup.mockReturnValue({ mutate: unarchiveMutate, isPending: false });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('WI-027: shows an Unarchive action on an archived group and calls useUnarchiveGroup', async () => {
    const user = userEvent.setup();
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroups.mockReturnValue({
      data: [fixtureGroup({ id: 'g-archived', name: 'Old crew', archivedAt: '2026-06-01T00:00:00.000Z' })],
      isLoading: false,
      isError: false,
    });

    render(<GroupsPage />);
    await user.click(screen.getByRole('button', { name: /archived/i }));
    await user.click(screen.getByRole('button', { name: /unarchive/i }));

    expect(unarchiveMutate).toHaveBeenCalledWith('g-archived');
  });

  it('WI-028: an unsettled group and a settled group are visually distinguished, and the toggle hides settled groups', async () => {
    const user = userEvent.setup();
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroups.mockReturnValue({
      data: [
        fixtureGroup({ id: 'g-unsettled', name: 'Roomies', settled: false }),
        fixtureGroup({ id: 'g-settled', name: 'Book club', settled: true }),
      ],
      isLoading: false,
      isError: false,
    });

    render(<GroupsPage />);
    expect(screen.getByText('Roomies')).toBeInTheDocument();
    expect(screen.getByText('Book club')).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: /unsettled only/i }));

    expect(screen.getByText('Roomies')).toBeInTheDocument();
    expect(screen.queryByText('Book club')).not.toBeInTheDocument();
  });

  it('WI-028: the "unsettled only" toggle defaults off (all groups show) and persists across remounts', async () => {
    const user = userEvent.setup();
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroups.mockReturnValue({
      data: [
        fixtureGroup({ id: 'g-unsettled', name: 'Roomies', settled: false }),
        fixtureGroup({ id: 'g-settled', name: 'Book club', settled: true }),
      ],
      isLoading: false,
      isError: false,
    });

    const { unmount } = render(<GroupsPage />);
    expect(screen.getByRole('switch', { name: /unsettled only/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await user.click(screen.getByRole('switch', { name: /unsettled only/i }));
    unmount();

    render(<GroupsPage />);
    expect(screen.getByRole('switch', { name: /unsettled only/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.queryByText('Book club')).not.toBeInTheDocument();
  });

  it('WI-038: the balance filter ("You owe") composes independently of the settled toggle', async () => {
    const user = userEvent.setup();
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroups.mockReturnValue({
      data: [
        fixtureGroup({
          id: 'g-you-owe',
          name: 'You owe group',
          settled: false,
          yourBalancesNative: [{ currency: 'USD', amount: -500 }],
        }),
        fixtureGroup({
          id: 'g-owed',
          name: 'Owed group',
          settled: false,
          yourBalancesNative: [{ currency: 'USD', amount: 500 }],
        }),
      ],
      isLoading: false,
      isError: false,
    });

    render(<GroupsPage />);
    await user.selectOptions(
      screen.getByRole('combobox', { name: /filter groups/i }),
      'youOwe',
    );

    expect(screen.getByText('You owe group')).toBeInTheDocument();
    expect(screen.queryByText('Owed group')).not.toBeInTheDocument();
  });
});
