// WI-085 regression: the "Who owes whom in this group" panel under the
// Expenses tab was removed in WI-086. This file now asserts its absence and
// that the page-level settle dialog still wires through the route groupId.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupBalancesDto, GroupDto, UserDto } from '@divzy/shared';
import GroupPage from './page';
import { useAuth } from '@/lib/auth-store';
import {
  useArchiveGroup,
  useDeleteGroup,
  useGroup,
  useGroupBalances,
  useLeaveGroup,
  useUnarchiveGroup,
} from '@/lib/hooks';

vi.mock('next/navigation', () => ({
  useParams: () => ({ groupId: 'group-1' }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/auth-store', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/hooks', () => ({
  useGroup: vi.fn(),
  useGroupBalances: vi.fn(),
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
}));
vi.mock('@/components/groups/group-header', () => ({
  GroupHeader: (props: { iOwe?: boolean; onSettleUp: () => void }) => (
    <button
      type="button"
      data-owe={props.iOwe ? 'true' : undefined}
      onClick={props.onSettleUp}
    >
      Settle Up
    </button>
  ),
}));
vi.mock('@/components/groups/balances-view', () => ({ BalancesView: () => null }));
vi.mock('@/components/groups/confirm-dialog', () => ({ ConfirmDialog: () => null }));
vi.mock('@/components/groups/group-form-dialog', () => ({ GroupFormDialog: () => null }));
vi.mock('@/components/groups/invite-dialog', () => ({ InviteDialog: () => null }));
vi.mock('@/components/groups/totals-view', () => ({ TotalsView: () => null }));
vi.mock('@/components/groups/group-whiteboard', () => ({ GroupWhiteboard: () => null }));
vi.mock('@/components/expenses/expense-editor', () => ({ ExpenseEditorDialog: () => null }));
vi.mock('@/components/expenses/expense-list', () => ({ ExpenseList: () => null }));

let capturedPrefill: unknown;
let capturedInitialView: unknown;
vi.mock('@/components/settle/settle-dialog', () => ({
  SettleUpDialog: (props: {
    open: boolean;
    groupId?: string;
    prefill?: unknown;
    initialView?: string;
  }) => {
    capturedPrefill = props.prefill;
    capturedInitialView = props.initialView;
    return null;
  },
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseGroup = vi.mocked(useGroup);
const mockedUseGroupBalances = vi.mocked(useGroupBalances);

function user(id: string, name: string): UserDto {
  return {
    id,
    name,
    avatarColor: '#123456',
    email: `${id}@example.com`,
    defaultCurrency: 'GBP',
    emailNotifications: true,
    staleBalanceRemindersEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const me = user('me', 'Me');
const ana = user('ana', 'Ana');

function fixtureGroup(overrides: Partial<GroupDto> = {}): GroupDto {
  return {
    id: 'group-1',
    name: 'Trip',
    emoji: '✈️',
    type: 'TRIP',
    currency: 'GBP',
    inviteCode: 'ABCDEFGHIJ',
    simplifyDebts: true,
    createdBy: me,
    members: [{ user: me, role: 'ADMIN', joinedAt: '2026-01-01T00:00:00.000Z' }],
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fixtureBalances(overrides: Partial<GroupBalancesDto> = {}): GroupBalancesDto {
  return {
    groupId: 'group-1',
    viewerCurrency: 'GBP',
    usedFallbackRates: false,
    members: [{ user: me, balances: [] }, { user: ana, balances: [] }],
    pairwise: [],
    suggestions: [],
    ...overrides,
  };
}

describe('GroupPage — WI-086 panel removed + header wiring', () => {
  beforeEach(() => {
    capturedPrefill = undefined;
    capturedInitialView = undefined;
    // @ts-expect-error -- test setup only
    mockedUseAuth.mockReturnValue({ user: me });
    // @ts-expect-error -- test setup only
    vi.mocked(useArchiveGroup).mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only
    vi.mocked(useLeaveGroup).mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only
    vi.mocked(useUnarchiveGroup).mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only
    vi.mocked(useDeleteGroup).mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroup.mockReturnValue({
      data: fixtureGroup(),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroupBalances.mockReturnValue({
      data: fixtureBalances(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not render the "Who owes whom in this group" panel under the Expenses tab', () => {
    render(<GroupPage />);
    expect(screen.queryByText('Who owes whom in this group')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ana owes you/i })).not.toBeInTheDocument();
  });

  it('marks the header Settle Up button as owing when the caller has a negative balance', () => {
    mockedUseGroupBalances.mockReturnValue({
      data: fixtureBalances({
        members: [
          { user: me, balances: [{ currency: 'GBP', amount: -1000 }] },
          { user: ana, balances: [] },
        ],
      }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useGroupBalances>);
    render(<GroupPage />);
    expect(screen.getByRole('button', { name: 'Settle Up' })).toHaveAttribute('data-owe', 'true');
  });

  it('opens the page-level SettleUpDialog in list mode when the header button is clicked', async () => {
    const user_ = userEvent.setup();
    render(<GroupPage />);

    await user_.click(screen.getByRole('button', { name: 'Settle Up' }));

    expect(capturedInitialView).toBe('list');
    expect(capturedPrefill).toBeUndefined();
  });
});
