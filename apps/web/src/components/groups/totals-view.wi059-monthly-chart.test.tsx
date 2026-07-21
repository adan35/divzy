// Build-stage TDD coverage for spec-WI-059 — verifies TotalsView mounts
// GroupMonthlyChart in the non-empty branch, before the per-currency tiles,
// with the group's home currency (not any viewer-default). GroupMonthlyChart
// itself is mocked — its own data/loading/error/empty behavior is covered by
// group-monthly-chart.test.tsx.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ExpenseDto, GroupDto, PublicUserDto } from '@divzy/shared';
import { TotalsView } from './totals-view';
import { useExpensesInfinite, useGroup } from '@/lib/hooks';

vi.mock('@/lib/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks')>();
  return { ...actual, useGroup: vi.fn(), useExpensesInfinite: vi.fn() };
});
vi.mock('./group-monthly-chart', () => ({
  GroupMonthlyChart: vi.fn(({ groupId, currency }: { groupId: string; currency: string }) => (
    <div data-testid="group-monthly-chart" data-group-id={groupId} data-currency={currency} />
  )),
}));

const mockedUseGroup = vi.mocked(useGroup);
const mockedUseExpensesInfinite = vi.mocked(useExpensesInfinite);

const ana: PublicUserDto = { id: 'ana', name: 'Ana', avatarColor: '#111111' };

function groupFixture(overrides: Partial<GroupDto> = {}): GroupDto {
  return {
    id: 'g1',
    name: 'Trip',
    emoji: '🏖️',
    type: 'TRIP',
    currency: 'PKR',
    inviteCode: 'ABCDEFGHIJ',
    simplifyDebts: true,
    createdBy: ana,
    members: [{ user: ana, role: 'ADMIN', joinedAt: '2026-01-01T00:00:00.000Z' }],
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function expenseFixture(overrides: Partial<ExpenseDto> = {}): ExpenseDto {
  return {
    id: 'exp-1',
    groupId: 'g1',
    group: { id: 'g1', name: 'Trip', emoji: '🏖️', currency: 'PKR' },
    description: 'Dinner',
    amount: 1000,
    currency: 'PKR',
    category: 'FOOD_DRINK',
    date: '2026-07-01T00:00:00.000Z',
    splitType: 'EQUAL',
    notes: null,
    receiptUrl: null,
    payers: [{ user: ana, amount: 1000 }],
    splits: [{ user: ana, amount: 1000, shares: null, percentBps: null, adjustment: null }],
    items: [],
    createdBy: ana,
    updatedBy: null,
    commentCount: 0,
    deletedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('TotalsView — mounts GroupMonthlyChart (WI-059)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the chart in the group home currency, before the per-currency tiles, when the group has expenses', () => {
    mockedUseGroup.mockReturnValue({
      data: groupFixture(),
      isLoading: false,
    } as unknown as ReturnType<typeof useGroup>);
    mockedUseExpensesInfinite.mockReturnValue({
      data: { pages: [{ items: [expenseFixture()] }] },
      hasNextPage: false,
      isFetchingNextPage: false,
      isError: false,
      isLoading: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useExpensesInfinite>);

    render(<TotalsView groupId="g1" />);

    const chart = screen.getByTestId('group-monthly-chart');
    expect(chart).toHaveAttribute('data-group-id', 'g1');
    expect(chart).toHaveAttribute('data-currency', 'PKR');

    // Mounted before the per-currency tiles, per spec §3.
    const tileLabel = screen.getByText(/Total spent · PKR/);
    expect(
      chart.compareDocumentPosition(tileLabel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('does not render the chart when the group has no expenses (existing empty state short-circuits first)', () => {
    mockedUseGroup.mockReturnValue({
      data: groupFixture(),
      isLoading: false,
    } as unknown as ReturnType<typeof useGroup>);
    mockedUseExpensesInfinite.mockReturnValue({
      data: { pages: [{ items: [] }] },
      hasNextPage: false,
      isFetchingNextPage: false,
      isError: false,
      isLoading: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useExpensesInfinite>);

    render(<TotalsView groupId="g1" />);

    expect(screen.getByText('No expenses yet')).toBeInTheDocument();
    expect(screen.queryByTestId('group-monthly-chart')).not.toBeInTheDocument();
  });
});
