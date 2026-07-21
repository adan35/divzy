import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NotificationDto, UserDto } from '@divzy/shared';
import { useAuth } from '@/lib/auth-store';
import {
  useClearAllNotifications,
  useMarkAllNotificationsRead,
  useNotificationsList,
  useUnreadCount,
} from '@/lib/hooks';
import AppLayout from './layout';

/**
 * spec-WI-065 §4a: the "Clear all" header control sits beside the existing
 * "Mark all read" button in `NotificationsMenu` — two side-by-side controls,
 * "Mark all read" first, "Clear all" second, gated independently
 * (`count > 0` vs `notifications.length > 0`). This file focuses on that
 * header only; the notification rows themselves are stubbed (covered by
 * `notification-row.test.tsx`), and the surrounding shell hooks
 * (auth/theme/router/socket) are stubbed so the test never needs a real
 * `QueryClientProvider` or network/socket connection.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard',
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/lib/auth-store', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/socket', () => ({ useRealtimeSync: vi.fn() }));
vi.mock('@/components/expenses/expense-editor', () => ({ ExpenseEditorDialog: () => null }));
vi.mock('@/components/notifications/notification-row', () => ({
  NotificationRow: () => null,
}));
vi.mock('@/lib/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks')>();
  return {
    ...actual,
    useLogout: vi.fn(() => ({ mutateAsync: vi.fn() })),
    useNotificationsList: vi.fn(),
    useUnreadCount: vi.fn(),
    useMarkAllNotificationsRead: vi.fn(),
    useClearAllNotifications: vi.fn(),
  };
});

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseNotificationsList = vi.mocked(useNotificationsList);
const mockedUseUnreadCount = vi.mocked(useUnreadCount);
const mockedUseMarkAllNotificationsRead = vi.mocked(useMarkAllNotificationsRead);
const mockedUseClearAllNotifications = vi.mocked(useClearAllNotifications);

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

function notification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: 'notif-1',
    type: 'EXPENSE_ADDED',
    title: 'Sam added an expense',
    body: '',
    data: {},
    readAt: null,
    clearedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function unreadCountQuery(count: number) {
  return { data: { count }, isSuccess: true } as unknown as ReturnType<typeof useUnreadCount>;
}

function notificationsListQuery(items: NotificationDto[]) {
  return {
    data: { pages: [{ items, nextCursor: null }] },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
  } as unknown as ReturnType<typeof useNotificationsList>;
}

function mutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, ...overrides } as unknown as ReturnType<
    typeof useMarkAllNotificationsRead
  >;
}

async function openNotificationsMenu() {
  const trigger = screen.getByLabelText(/Notifications/);
  await userEvent.click(trigger);
}

describe('NotificationsMenu header — Mark all read / Clear all (WI-065)', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ user: user(), status: 'authed' });
  });

  it('shows both buttons, "Mark all read" before "Clear all", when there is unread + loaded items', async () => {
    mockedUseUnreadCount.mockReturnValue(unreadCountQuery(2));
    mockedUseNotificationsList.mockReturnValue(notificationsListQuery([notification()]));
    mockedUseMarkAllNotificationsRead.mockReturnValue(mutation());
    mockedUseClearAllNotifications.mockReturnValue(mutation());

    render(<AppLayout>content</AppLayout>);
    await openNotificationsMenu();

    const markAllButton = screen.getByRole('button', { name: /Mark all read/ });
    const clearAllButton = screen.getByRole('button', { name: /Clear all/ });
    expect(markAllButton).toBeInTheDocument();
    expect(clearAllButton).toBeInTheDocument();

    // Order: Mark all read first (leftmost), Clear all second.
    const position = markAllButton.compareDocumentPosition(clearAllButton);
    // eslint-disable-next-line no-bitwise
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hides "Mark all read" but keeps "Clear all" when everything is already read (count 0, list non-empty)', async () => {
    mockedUseUnreadCount.mockReturnValue(unreadCountQuery(0));
    mockedUseNotificationsList.mockReturnValue(notificationsListQuery([notification({ readAt: '2026-07-02T00:00:00.000Z' })]));
    mockedUseMarkAllNotificationsRead.mockReturnValue(mutation());
    mockedUseClearAllNotifications.mockReturnValue(mutation());

    render(<AppLayout>content</AppLayout>);
    await openNotificationsMenu();

    expect(screen.queryByRole('button', { name: /Mark all read/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clear all/ })).toBeInTheDocument();
  });

  it('hides "Clear all" when the list is empty, independent of unread count', async () => {
    mockedUseUnreadCount.mockReturnValue(unreadCountQuery(0));
    mockedUseNotificationsList.mockReturnValue(notificationsListQuery([]));
    mockedUseMarkAllNotificationsRead.mockReturnValue(mutation());
    mockedUseClearAllNotifications.mockReturnValue(mutation());

    render(<AppLayout>content</AppLayout>);
    await openNotificationsMenu();

    expect(screen.queryByRole('button', { name: /Mark all read/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Clear all/ })).not.toBeInTheDocument();
    expect(screen.getByText(/all caught up/)).toBeInTheDocument();
  });

  it('calls clearAll.mutate() once when clicked — never a per-row loop', async () => {
    const clearAllMutation = mutation();
    mockedUseUnreadCount.mockReturnValue(unreadCountQuery(2));
    mockedUseNotificationsList.mockReturnValue(
      notificationsListQuery([notification(), notification({ id: 'notif-2' })]),
    );
    mockedUseMarkAllNotificationsRead.mockReturnValue(mutation());
    mockedUseClearAllNotifications.mockReturnValue(clearAllMutation);

    render(<AppLayout>content</AppLayout>);
    await openNotificationsMenu();

    await userEvent.click(screen.getByRole('button', { name: /Clear all/ }));

    expect(clearAllMutation.mutate).toHaveBeenCalledTimes(1);
    expect(clearAllMutation.mutate).toHaveBeenCalledWith();
  });
});
