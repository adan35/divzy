import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ActivityDto, UserDto } from '@divzy/shared';
import { useAuth } from '@/lib/auth-store';
import { useActivityInfinite } from '@/lib/hooks';
import { ActivityPreview } from './activity-preview';

// WI-039 (notifications-activity slice, web): clicking a dashboard preview
// row dispatches per spec-WI-039 §3 / ADR-022. WI-036's regression gate
// (Recent Activity unaffected by the chart slot / still shows its items and
// empty state) is also exercised here since this is the same component.

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@/lib/auth-store', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks')>();
  return { ...actual, useActivityInfinite: vi.fn() };
});

let capturedExpenseDialogProps: { expenseId: string; open: boolean } | null = null;
vi.mock('@/components/expenses/expense-detail', () => ({
  ExpenseDetailDialog: (props: { expenseId: string; open: boolean }) => {
    capturedExpenseDialogProps = props;
    return props.open ? <div data-testid="expense-dialog">{props.expenseId}</div> : null;
  },
}));

let capturedSettlementDialogProps: { settlementId: string; open: boolean } | null = null;
vi.mock('@/components/settle/settlement-detail', () => ({
  SettlementDetailDialog: (props: { settlementId: string; open: boolean }) => {
    capturedSettlementDialogProps = props;
    return props.open ? <div data-testid="settlement-dialog">{props.settlementId}</div> : null;
  },
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseActivityInfinite = vi.mocked(useActivityInfinite);

function me(overrides: Partial<UserDto> = {}): UserDto {
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
    expenseId: null,
    settlementId: null,
    data: { description: 'Groceries', amount: 4210, currency: 'GBP' },
    deletedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function activityQuery(items: ActivityDto[], overrides: Record<string, unknown> = {}) {
  return {
    data: { pages: [{ items, nextCursor: null }] },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useActivityInfinite>;
}

describe('ActivityPreview', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    capturedExpenseDialogProps = null;
    capturedSettlementDialogProps = null;
  });

  it('regression: still renders the first-page items unchanged (WI-036 §4)', () => {
    mockedUseAuth.mockReturnValue({ user: me(), status: 'authed' });
    mockedUseActivityInfinite.mockReturnValue(activityQuery([activityItem()]));
    render(<ActivityPreview />);
    expect(screen.getByText(/added.*Groceries/)).toBeInTheDocument();
    expect(screen.getByText('See all')).toBeInTheDocument();
  });

  it('regression: still shows the empty state (WI-036 §4)', () => {
    mockedUseAuth.mockReturnValue({ user: me(), status: 'authed' });
    mockedUseActivityInfinite.mockReturnValue(activityQuery([]));
    render(<ActivityPreview />);
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });

  it('opens the expense detail dialog for an expense-backed row (§3a)', async () => {
    mockedUseAuth.mockReturnValue({ user: me(), status: 'authed' });
    mockedUseActivityInfinite.mockReturnValue(
      activityQuery([activityItem({ expenseId: 'exp-42' })]),
    );
    render(<ActivityPreview />);
    await userEvent.click(screen.getByText(/added/));
    expect(capturedExpenseDialogProps).toMatchObject({ expenseId: 'exp-42', open: true });
    expect(screen.getByTestId('expense-dialog')).toHaveTextContent('exp-42');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('navigates to the group for a group-backed, non-expense row (§3c)', async () => {
    mockedUseAuth.mockReturnValue({ user: me(), status: 'authed' });
    mockedUseActivityInfinite.mockReturnValue(
      activityQuery([
        activityItem({
          type: 'MEMBER_JOINED',
          expenseId: null,
          group: { id: 'group-9', name: 'Lisbon', emoji: '✈️' },
        }),
      ]),
    );
    render(<ActivityPreview />);
    await userEvent.click(screen.getByText(/joined/));
    expect(pushMock).toHaveBeenCalledWith('/groups/group-9');
  });

  it('navigates to the friend page for FRIEND_ADDED (§3c, closes the dead-click gap)', async () => {
    mockedUseAuth.mockReturnValue({ user: me(), status: 'authed' });
    mockedUseActivityInfinite.mockReturnValue(
      activityQuery([
        activityItem({
          type: 'FRIEND_ADDED',
          expenseId: null,
          group: null,
          actor: { id: 'me', name: 'Me', avatarColor: '#000' },
          data: { friendId: 'friend-77', friendName: 'Robin' },
        }),
      ]),
    );
    render(<ActivityPreview />);
    await userEvent.click(screen.getByText(/added Robin/));
    expect(pushMock).toHaveBeenCalledWith('/friends/friend-77');
  });

  it('opens the settlement detail dialog for a settlement-backed row instead of navigating (WI-039b §1)', async () => {
    mockedUseAuth.mockReturnValue({ user: me(), status: 'authed' });
    mockedUseActivityInfinite.mockReturnValue(
      activityQuery([
        activityItem({
          type: 'SETTLEMENT_ADDED',
          expenseId: null,
          settlementId: 'settle-42',
          group: { id: 'group-9', name: 'Lisbon', emoji: '✈️' },
          data: { fromName: 'Sam', toName: 'Me', amount: 1200, currency: 'GBP' },
        }),
      ]),
    );
    render(<ActivityPreview />);
    await userEvent.click(screen.getByText(/recorded a payment/));
    expect(capturedSettlementDialogProps).toMatchObject({ settlementId: 'settle-42', open: true });
    expect(screen.getByTestId('settlement-dialog')).toHaveTextContent('settle-42');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('opens the settlement detail dialog for a direct (no-group) SETTLEMENT_DELETED row (WI-039b §1)', async () => {
    mockedUseAuth.mockReturnValue({ user: me(), status: 'authed' });
    mockedUseActivityInfinite.mockReturnValue(
      activityQuery([
        activityItem({
          type: 'SETTLEMENT_DELETED',
          expenseId: null,
          settlementId: 'settle-77',
          group: null,
          data: { amount: 500, currency: 'GBP' },
        }),
      ]),
    );
    render(<ActivityPreview />);
    await userEvent.click(screen.getByText(/deleted a payment/));
    expect(capturedSettlementDialogProps).toMatchObject({ settlementId: 'settle-77', open: true });
    expect(pushMock).not.toHaveBeenCalled();
  });

  // -- WI-054 — strikethrough on deletedAt rows (forked ActivityRow) --------

  it('WI-054: strikes through the sentence text when deletedAt is set, without touching the actor name', () => {
    mockedUseAuth.mockReturnValue({ user: me(), status: 'authed' });
    mockedUseActivityInfinite.mockReturnValue(
      activityQuery([activityItem({ deletedAt: '2026-07-05T00:00:00.000Z' })]),
    );
    render(<ActivityPreview />);
    expect(screen.getByText(/added.*Groceries/)).toHaveClass('line-through');
    expect(screen.getByText('Sam')).not.toHaveClass('line-through');
  });

  it('WI-054: regression — a non-deleted row is never struck through', () => {
    mockedUseAuth.mockReturnValue({ user: me(), status: 'authed' });
    mockedUseActivityInfinite.mockReturnValue(activityQuery([activityItem({ deletedAt: null })]));
    render(<ActivityPreview />);
    expect(screen.getByText(/added.*Groceries/)).not.toHaveClass('line-through');
  });

  // -- WI-055 — actor-relative color coding (forked ActivityRow) ------------

  it('WI-055: green accent when colorHint is green', () => {
    mockedUseAuth.mockReturnValue({ user: me(), status: 'authed' });
    mockedUseActivityInfinite.mockReturnValue(
      activityQuery([activityItem({ colorHint: 'green' })]),
    );
    const { container } = render(<ActivityPreview />);
    expect(container.querySelector('[role="button"]')).toHaveClass('border-pos');
  });

  it('WI-055: red accent when colorHint is red', () => {
    mockedUseAuth.mockReturnValue({ user: me(), status: 'authed' });
    mockedUseActivityInfinite.mockReturnValue(activityQuery([activityItem({ colorHint: 'red' })]));
    const { container } = render(<ActivityPreview />);
    expect(container.querySelector('[role="button"]')).toHaveClass('border-neg');
  });

  it('WI-055: regression — no color accent when colorHint is null/absent', () => {
    mockedUseAuth.mockReturnValue({ user: me(), status: 'authed' });
    mockedUseActivityInfinite.mockReturnValue(activityQuery([activityItem()]));
    const { container } = render(<ActivityPreview />);
    const row = container.querySelector('[role="button"]');
    expect(row).not.toHaveClass('border-pos');
    expect(row).not.toHaveClass('border-neg');
  });

  // -- WI-062 — GROUP_UPDATED verb disambiguation ----------------------------

  it('WI-062: renders "archived <group>" when data.archived is true', () => {
    mockedUseAuth.mockReturnValue({ user: me(), status: 'authed' });
    mockedUseActivityInfinite.mockReturnValue(
      activityQuery([
        activityItem({
          type: 'GROUP_UPDATED',
          group: { id: 'group-9', name: 'Ski Trip', emoji: '⛷️' },
          data: { groupName: 'Ski Trip', archived: true },
        }),
      ]),
    );
    render(<ActivityPreview />);
    expect(screen.getByText('archived Ski Trip')).toBeInTheDocument();
  });

  it('WI-062: renders "deleted <group>" when data.deleted is true, taking precedence over archived', () => {
    mockedUseAuth.mockReturnValue({ user: me(), status: 'authed' });
    mockedUseActivityInfinite.mockReturnValue(
      activityQuery([
        activityItem({
          type: 'GROUP_UPDATED',
          group: { id: 'group-9', name: 'Ski Trip', emoji: '⛷️' },
          data: { groupName: 'Ski Trip', deleted: true },
        }),
      ]),
    );
    render(<ActivityPreview />);
    expect(screen.getByText('deleted Ski Trip')).toBeInTheDocument();
  });

  it('WI-062: falls back to "updated <group>" when no flags are set', () => {
    mockedUseAuth.mockReturnValue({ user: me(), status: 'authed' });
    mockedUseActivityInfinite.mockReturnValue(
      activityQuery([
        activityItem({
          type: 'GROUP_UPDATED',
          group: { id: 'group-9', name: 'Ski Trip', emoji: '⛷️' },
          data: { groupName: 'Ski Trip', changedFields: ['name'] },
        }),
      ]),
    );
    render(<ActivityPreview />);
    expect(screen.getByText('updated Ski Trip')).toBeInTheDocument();
  });

  it('WI-062: regression — unarchive (archived: false) still renders "updated <group>"', () => {
    mockedUseAuth.mockReturnValue({ user: me(), status: 'authed' });
    mockedUseActivityInfinite.mockReturnValue(
      activityQuery([
        activityItem({
          type: 'GROUP_UPDATED',
          group: { id: 'group-9', name: 'Ski Trip', emoji: '⛷️' },
          data: { groupName: 'Ski Trip', archived: false },
        }),
      ]),
    );
    render(<ActivityPreview />);
    expect(screen.getByText('updated Ski Trip')).toBeInTheDocument();
  });

  it('WI-062: null-group fallback reads "<verb> a group"', () => {
    mockedUseAuth.mockReturnValue({ user: me(), status: 'authed' });
    mockedUseActivityInfinite.mockReturnValue(
      activityQuery([
        activityItem({
          type: 'GROUP_UPDATED',
          group: null,
          data: { groupName: 'Ski Trip', deleted: true },
        }),
      ]),
    );
    render(<ActivityPreview />);
    expect(screen.getByText('deleted a group')).toBeInTheDocument();
  });
});
