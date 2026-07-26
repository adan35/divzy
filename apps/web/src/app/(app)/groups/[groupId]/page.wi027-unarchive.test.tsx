// spec-WI-027 — Unarchive action on the group detail page's archived banner.
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
}));
vi.mock('@/components/groups/group-header', () => ({ GroupHeader: () => null }));
vi.mock('@/components/groups/balances-view', () => ({ BalancesView: () => null }));
vi.mock('@/components/groups/confirm-dialog', () => ({ ConfirmDialog: () => null }));
vi.mock('@/components/groups/group-form-dialog', () => ({ GroupFormDialog: () => null }));
vi.mock('@/components/groups/invite-dialog', () => ({ InviteDialog: () => null }));
vi.mock('@/components/groups/totals-view', () => ({ TotalsView: () => null }));
vi.mock('@/components/groups/group-whiteboard', () => ({ GroupWhiteboard: () => null }));
vi.mock('@/components/expenses/expense-editor', () => ({ ExpenseEditorDialog: () => null }));
vi.mock('@/components/expenses/expense-list', () => ({ ExpenseList: () => null }));
vi.mock('@/components/settle/settle-dialog', () => ({ SettleUpDialog: () => null }));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseGroup = vi.mocked(useGroup);
const mockedUseArchiveGroup = vi.mocked(useArchiveGroup);
const mockedUseLeaveGroup = vi.mocked(useLeaveGroup);
const mockedUseUnarchiveGroup = vi.mocked(useUnarchiveGroup);

function fixtureGroup(overrides: Partial<GroupDto> = {}): GroupDto {
  return {
    id: 'group-1',
    name: 'Old crew',
    emoji: '🏠',
    type: 'HOME',
    currency: 'USD',
    inviteCode: 'ABCDEFGHIJ',
    simplifyDebts: true,
    createdBy: { id: 'me', name: 'Me', avatarColor: '#000' },
    members: [
      { user: { id: 'me', name: 'Me', avatarColor: '#000' }, role: 'ADMIN', joinedAt: '2026-01-01T00:00:00.000Z' },
    ],
    archivedAt: '2026-06-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('GroupPage — Unarchive on the archived banner (spec-WI-027)', () => {
  const unarchiveMutate = vi.fn();

  beforeEach(() => {
    // @ts-expect-error -- test setup only
    mockedUseAuth.mockReturnValue({ user: { id: 'me' } });
    // @ts-expect-error -- test setup only
    mockedUseArchiveGroup.mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only
    mockedUseLeaveGroup.mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only
    mockedUseUnarchiveGroup.mockReturnValue({ mutate: unarchiveMutate, isPending: false });
    // @ts-expect-error -- test setup only
    vi.mocked(useDeleteGroup).mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows Unarchive to an admin on an archived group and calls the mutation', async () => {
    const user = userEvent.setup();
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroup.mockReturnValue({
      data: fixtureGroup(),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<GroupPage />);
    await user.click(screen.getByRole('button', { name: /unarchive/i }));

    expect(unarchiveMutate).toHaveBeenCalledWith('group-1', expect.anything());
  });

  it('hides Unarchive from a non-admin member', () => {
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroup.mockReturnValue({
      data: fixtureGroup({
        members: [
          { user: { id: 'me', name: 'Me', avatarColor: '#000' }, role: 'MEMBER', joinedAt: '2026-01-01T00:00:00.000Z' },
          { user: { id: 'admin-1', name: 'Admin', avatarColor: '#111' }, role: 'ADMIN', joinedAt: '2026-01-01T00:00:00.000Z' },
        ],
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<GroupPage />);
    expect(screen.queryByRole('button', { name: /unarchive/i })).not.toBeInTheDocument();
  });

  it('does not render the banner when the group is active', () => {
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroup.mockReturnValue({
      data: fixtureGroup({ archivedAt: null }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<GroupPage />);
    expect(screen.queryByRole('button', { name: /unarchive/i })).not.toBeInTheDocument();
  });
});
