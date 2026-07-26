// spec-WI-070 §Decision 3 / story-WI-070.md Gherkin ("Web group-detail page:
// parallel fetch, unchanged content") — Tabs/ExpenseList/BalancesView/
// TotalsView must mount off the route's groupId immediately, without waiting
// on useGroup to resolve; group-specific chrome (GroupHeader, isAdmin-derived
// UI, archived banner, the four group-object dialogs) must stay gated on
// useGroup; and a useGroup error/no-data case must show the existing
// full-page error card and mount NO group-scoped child at all.
//
// Mocking convention mirrors page.wi033-tablist.test.tsx / page.wi046-delete.
// test.tsx (same file family): mock next/navigation, sonner, @/lib/auth-store,
// @/lib/hooks (useGroup + the mutation hooks), and every heavy child.
// ExpenseList/BalancesView/TotalsView/GroupHeader are mocked as CAPTURING
// components (not `() => null`) so we can assert they mounted and received
// the route's groupId — the opposite of the sibling files above, which mock
// them away entirely since they aren't the concern under test there.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupDto } from '@divzy/shared';
import GroupPage from './page';
import { useAuth } from '@/lib/auth-store';
import {
  useArchiveGroup,
  useDeleteGroup,
  useGroup,
  useLeaveGroup,
  useUnarchiveGroup,
} from '@/lib/hooks';

let capturedExpenseListProps: { groupId?: string; friendId?: string } | null = null;
let capturedBalancesProps: { groupId?: string } | null = null;
let capturedTotalsProps: { groupId?: string } | null = null;

vi.mock('next/navigation', () => ({
  useParams: () => ({ groupId: 'group-1' }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/auth-store', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/hooks', () => ({
  useGroup: vi.fn(),
  useGroupBalances: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })),
  useGroupWhiteboard: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })),
  useArchiveGroup: vi.fn(),
  useLeaveGroup: vi.fn(),
  useUnarchiveGroup: vi.fn(),
  useDeleteGroup: vi.fn(),
  errorMessage: (error: unknown) =>
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : 'Something went wrong',
}));
vi.mock('@/components/groups/group-header', () => ({
  GroupHeader: (props: { group: GroupDto }) => (
    <div data-testid="group-header">{props.group.name}</div>
  ),
}));
vi.mock('@/components/groups/balances-view', () => ({
  BalancesView: (props: { groupId: string }) => {
    capturedBalancesProps = props;
    return <div data-testid="balances-view" />;
  },
}));
vi.mock('@/components/groups/totals-view', () => ({
  TotalsView: (props: { groupId: string }) => {
    capturedTotalsProps = props;
    return <div data-testid="totals-view" />;
  },
}));
vi.mock('@/components/groups/group-whiteboard', () => ({ GroupWhiteboard: () => null }));
vi.mock('@/components/expenses/expense-list', () => ({
  ExpenseList: (props: { groupId?: string; friendId?: string }) => {
    capturedExpenseListProps = props;
    return <div data-testid="expense-list" />;
  },
}));
vi.mock('@/components/groups/confirm-dialog', () => ({
  ConfirmDialog: (props: { open: boolean }) => (
    <div data-testid="confirm-dialog" data-open={props.open} />
  ),
}));
vi.mock('@/components/groups/group-form-dialog', () => ({
  GroupFormDialog: () => <div data-testid="group-form-dialog" />,
}));
vi.mock('@/components/groups/invite-dialog', () => ({
  InviteDialog: () => <div data-testid="invite-dialog" />,
}));
vi.mock('@/components/settle/settle-dialog', () => ({
  SettleUpDialog: () => <div data-testid="settle-up-dialog" />,
}));
vi.mock('@/components/expenses/expense-editor', () => ({
  ExpenseEditorDialog: () => <div data-testid="expense-editor-dialog" />,
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseGroup = vi.mocked(useGroup);

function fixtureGroup(overrides: Partial<GroupDto> = {}): GroupDto {
  return {
    id: 'group-1',
    name: 'Lisbon trip',
    emoji: '✈️',
    type: 'TRIP',
    currency: 'USD',
    inviteCode: 'ABCDEFGHIJ',
    simplifyDebts: true,
    createdBy: { id: 'me', name: 'Me', avatarColor: '#000' },
    members: [
      {
        user: { id: 'me', name: 'Me', avatarColor: '#000' },
        role: 'ADMIN',
        joinedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  capturedExpenseListProps = null;
  capturedBalancesProps = null;
  capturedTotalsProps = null;
  // @ts-expect-error -- test setup only
  mockedUseAuth.mockReturnValue({ user: { id: 'me' } });
  // @ts-expect-error -- test setup only
  vi.mocked(useArchiveGroup).mockReturnValue({ mutate: vi.fn(), isPending: false });
  // @ts-expect-error -- test setup only
  vi.mocked(useLeaveGroup).mockReturnValue({ mutate: vi.fn(), isPending: false });
  // @ts-expect-error -- test setup only
  vi.mocked(useUnarchiveGroup).mockReturnValue({ mutate: vi.fn(), isPending: false });
  // @ts-expect-error -- test setup only
  vi.mocked(useDeleteGroup).mockReturnValue({ mutate: vi.fn(), isPending: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WI-070 — Tabs/ExpenseList mount off the route groupId while useGroup is still pending', () => {
  beforeEach(() => {
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroup.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it('renders the tablist and the active (Expenses) tab\'s ExpenseList off groupId immediately', () => {
    render(<GroupPage />);

    expect(screen.getAllByRole('tablist')).toHaveLength(1);
    expect(screen.getByTestId('expense-list')).toBeInTheDocument();
    expect(capturedExpenseListProps).toEqual({ groupId: 'group-1', emptyHint: expect.any(String) });
  });

  it('BalancesView mounts off groupId once its tab is selected, without waiting for useGroup', async () => {
    const user = userEvent.setup();
    render(<GroupPage />);

    await user.click(screen.getByRole('tab', { name: 'Balances' }));

    expect(screen.getByTestId('balances-view')).toBeInTheDocument();
    expect(capturedBalancesProps).toEqual({ groupId: 'group-1' });
  });

  it('TotalsView mounts off groupId once its tab is selected, without waiting for useGroup', async () => {
    const user = userEvent.setup();
    render(<GroupPage />);

    await user.click(screen.getByRole('tab', { name: 'Totals' }));

    expect(screen.getByTestId('totals-view')).toBeInTheDocument();
    expect(capturedTotalsProps).toEqual({ groupId: 'group-1' });
  });
});

describe('WI-070 — group-specific chrome stays gated on useGroup', () => {
  it('while useGroup is pending: no GroupHeader, no archived banner, none of the four group-object dialogs', () => {
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroup.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });

    render(<GroupPage />);

    expect(screen.queryByTestId('group-header')).not.toBeInTheDocument();
    expect(screen.queryByText(/read-only for everyone/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('settle-up-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('invite-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('group-form-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    // Meanwhile the route-param-only content IS mounted (the actual fix).
    expect(screen.getByTestId('expense-list')).toBeInTheDocument();
  });

  it('once useGroup resolves: GroupHeader, archived banner (if applicable), and the dialogs render', () => {
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroup.mockReturnValue({
      data: fixtureGroup({ archivedAt: '2026-07-10T00:00:00.000Z' }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<GroupPage />);

    expect(screen.getByTestId('group-header')).toBeInTheDocument();
    expect(screen.getByText('Lisbon trip')).toBeInTheDocument();
    expect(screen.getByText(/read-only for everyone/i)).toBeInTheDocument();
    expect(screen.getByTestId('settle-up-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('invite-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('group-form-dialog')).toBeInTheDocument();
    expect(screen.getAllByTestId('confirm-dialog').length).toBeGreaterThanOrEqual(3); // archive/leave/delete
  });
});

describe('WI-070 — non-member/failed group load never mounts a group-scoped child (regression guard)', () => {
  it('useGroup isError shows the full-page error card and mounts NO group-scoped child', () => {
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroup.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Not found'),
      refetch: vi.fn(),
    });

    render(<GroupPage />);

    expect(screen.getByText(/couldn.t load this group/i)).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByTestId('expense-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('balances-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('totals-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('group-header')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settle-up-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('invite-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('group-form-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it('a settled "no data, not loading" case (e.g. a disabled query) also shows the error card, mounting nothing group-scoped', () => {
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroup.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<GroupPage />);

    expect(screen.getByText(/couldn.t load this group/i)).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByTestId('expense-list')).not.toBeInTheDocument();
  });
});

describe('WI-070 — final rendered content is unchanged once both resolve', () => {
  it('renders header name, tabs, and the active tab\'s content once useGroup resolves', () => {
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroup.mockReturnValue({
      data: fixtureGroup(),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<GroupPage />);

    expect(screen.getByText('Lisbon trip')).toBeInTheDocument();
    expect(screen.getAllByRole('tab', { name: 'Expenses' })).toHaveLength(1);
    expect(screen.getAllByRole('tab', { name: 'Balances' })).toHaveLength(1);
    expect(screen.getAllByRole('tab', { name: 'Totals' })).toHaveLength(1);
    expect(screen.getByTestId('expense-list')).toBeInTheDocument();
  });
});
