// spec-WI-087 — Whiteboard tab mount point on the group detail page.
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
  useGroupBalances,
  useLeaveGroup,
  useUnarchiveGroup,
} from '@/lib/hooks';

let capturedWhiteboardProps: { groupId?: string; enabled?: boolean } | null = null;

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
vi.mock('@/components/groups/group-whiteboard', () => ({
  GroupWhiteboard: (props: { groupId: string; enabled?: boolean }) => {
    capturedWhiteboardProps = props;
    return <div data-testid="group-whiteboard" />;
  },
}));
vi.mock('@/components/expenses/expense-editor', () => ({ ExpenseEditorDialog: () => null }));
vi.mock('@/components/expenses/expense-list', () => ({ ExpenseList: () => null }));
vi.mock('@/components/settle/settle-dialog', () => ({ SettleUpDialog: () => null }));

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
      { user: { id: 'me', name: 'Me', avatarColor: '#000' }, role: 'ADMIN', joinedAt: '2026-01-01T00:00:00.000Z' },
    ],
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('GroupPage — WI-087 Whiteboard tab mount point', () => {
  beforeEach(() => {
    capturedWhiteboardProps = null;
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

  it('renders a Whiteboard tab alongside Expenses/Balances/Totals', () => {
    render(<GroupPage />);

    expect(screen.getByRole('tab', { name: 'Whiteboard' })).toBeInTheDocument();
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
  });

  it('mounts GroupWhiteboard with enabled=false before the tab is selected', () => {
    render(<GroupPage />);

    expect(capturedWhiteboardProps).toEqual({ groupId: 'group-1', enabled: false });
  });

  it('enables the whiteboard query when the Whiteboard tab is selected', async () => {
    const user = userEvent.setup();
    render(<GroupPage />);

    await user.click(screen.getByRole('tab', { name: 'Whiteboard' }));

    expect(screen.getByTestId('group-whiteboard')).toBeInTheDocument();
    expect(capturedWhiteboardProps).toEqual({ groupId: 'group-1', enabled: true });
  });
});
