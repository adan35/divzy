// spec-WI-046 — Delete group entry point wiring on the group detail page,
// mirroring the existing archive/leave ConfirmDialog pattern. On success:
// navigate away (back to /groups) and invalidate the group/groups-list cache
// (covered by useDeleteGroup itself, exercised here via the mocked mutate
// call). On 409 OUTSTANDING_BALANCE, the dialog stays open and the API's
// message surfaces via the hook's own toast (no special-cased handling here).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
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

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ groupId: 'group-1' }),
  useRouter: () => ({ push: pushMock, back: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/auth-store', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/hooks', () => ({
  useGroup: vi.fn(),
  useArchiveGroup: vi.fn(),
  useLeaveGroup: vi.fn(),
  useUnarchiveGroup: vi.fn(),
  useDeleteGroup: vi.fn(),
}));
vi.mock('@/components/groups/group-header', () => ({
  GroupHeader: (props: { onDelete: () => void; isAdmin: boolean }) => (
    <button type="button" onClick={props.onDelete} disabled={!props.isAdmin}>
      trigger-delete
    </button>
  ),
}));
vi.mock('@/components/groups/balances-view', () => ({ BalancesView: () => null }));
vi.mock('@/components/groups/group-form-dialog', () => ({ GroupFormDialog: () => null }));
vi.mock('@/components/groups/invite-dialog', () => ({ InviteDialog: () => null }));
vi.mock('@/components/groups/totals-view', () => ({ TotalsView: () => null }));
vi.mock('@/components/expenses/expense-editor', () => ({ ExpenseEditorDialog: () => null }));
vi.mock('@/components/expenses/expense-list', () => ({ ExpenseList: () => null }));
vi.mock('@/components/settle/settle-dialog', () => ({ SettleUpDialog: () => null }));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseGroup = vi.mocked(useGroup);
const mockedUseDeleteGroup = vi.mocked(useDeleteGroup);

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
      { user: { id: 'me', name: 'Me', avatarColor: '#000' }, role: 'ADMIN', joinedAt: '2026-01-01T00:00:00.000Z' },
    ],
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('GroupPage — Delete group wiring (spec-WI-046)', () => {
  const deleteMutate = vi.fn();

  beforeEach(() => {
    // @ts-expect-error -- test setup only
    mockedUseAuth.mockReturnValue({ user: { id: 'me' } });
    // @ts-expect-error -- test setup only
    vi.mocked(useArchiveGroup).mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only
    vi.mocked(useLeaveGroup).mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only
    vi.mocked(useUnarchiveGroup).mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only
    mockedUseDeleteGroup.mockReturnValue({ mutate: deleteMutate, isPending: false });
    // @ts-expect-error -- test setup only (partial UseQueryResult)
    mockedUseGroup.mockReturnValue({
      data: fixtureGroup(),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('opens a confirm dialog warning the action is permanent when Delete group is triggered', async () => {
    const user = userEvent.setup();
    render(<GroupPage />);

    await user.click(screen.getByText('trigger-delete'));

    expect(screen.getByRole('heading', { name: /delete lisbon trip\?/i })).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it('calls useDeleteGroup and navigates to /groups on success', async () => {
    deleteMutate.mockImplementation((_groupId: string, opts?: { onSuccess?: () => void }) => {
      opts?.onSuccess?.();
    });
    const user = userEvent.setup();
    render(<GroupPage />);

    await user.click(screen.getByText('trigger-delete'));
    await user.click(screen.getByRole('button', { name: /delete group/i }));

    expect(deleteMutate).toHaveBeenCalledWith('group-1', expect.anything());
    expect(toast.success).toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith('/groups');
  });

  it('keeps the dialog open and does not navigate when the mutation errors (e.g. 409 OUTSTANDING_BALANCE)', async () => {
    deleteMutate.mockImplementation(() => {
      // onError isn't invoked here — the hook's own toastError handles it;
      // the page must not navigate or close the dialog on failure.
    });
    const user = userEvent.setup();
    render(<GroupPage />);

    await user.click(screen.getByText('trigger-delete'));
    await user.click(screen.getByRole('button', { name: /delete group/i }));

    expect(pushMock).not.toHaveBeenCalledWith('/groups');
    expect(screen.getByRole('heading', { name: /delete lisbon trip\?/i })).toBeInTheDocument();
  });
});
