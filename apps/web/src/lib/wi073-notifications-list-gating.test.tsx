import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NotificationDto, UserDto } from '@divzy/shared';
import { useAuthStore } from '@/lib/auth-store';
import { useNotificationsList } from './hooks';
import AppLayout from '../app/(app)/layout';

/**
 * spec-WI-073 §6.1/§6.2 — NotificationsMenu fetch gating.
 *
 * (e)/(f) exercise `useNotificationsList(enabled)` directly against a real
 * QueryClient + a mocked `api.notifications.list`, mirroring the
 * `wi056-clear-notification-invalidation.test.tsx` house style (real hook,
 * real QueryClientProvider, mocked api module only) — NOT mocking the hook
 * itself, since that's exactly the surface this story changed.
 *
 * (g) renders the real `NotificationsMenu` inside `AppLayout` (real
 * QueryClientProvider, real `useNotificationsList`/`useUnreadCount`, only
 * `api` + the shell's other dependencies mocked, following
 * `layout.test.tsx`'s shell-mocking convention but leaving the notifications
 * hooks unmocked) to prove the `onOpenChange`/`list.isStale` gated-refetch
 * wiring end-to-end, not just by reading source.
 */

vi.mock('./api', () => ({
  api: {
    notifications: {
      list: vi.fn(),
      unreadCount: vi.fn(),
      markAllRead: vi.fn(),
      clearAll: vi.fn(),
    },
  },
}));

// eslint-disable-next-line import/first -- must follow the vi.mock('./api', ...) call above
import { api } from './api';

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function makeClient(staleTime = 30_000): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { staleTime, retry: false } } });
}

function page(items: NotificationDto[] = []) {
  return { items, nextCursor: null };
}

describe('WI-073 — useNotificationsList(enabled) fetch gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('(e) enabled=false never calls api.notifications.list', async () => {
    const queryClient = makeClient();
    vi.mocked(api.notifications.list).mockResolvedValue(page());

    renderHook(() => useNotificationsList(false), { wrapper: wrapperFor(queryClient) });

    // Give any errant async fetch a chance to fire before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.notifications.list).not.toHaveBeenCalled();
  });

  it('(f) enabled=true fetches exactly once', async () => {
    const queryClient = makeClient();
    vi.mocked(api.notifications.list).mockResolvedValue(page());

    const { result } = renderHook(() => useNotificationsList(true), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.notifications.list).toHaveBeenCalledTimes(1);
  });

  it('flipping enabled false -> true triggers the auto-fetch exactly once (mirrors first-open)', async () => {
    const queryClient = makeClient();
    vi.mocked(api.notifications.list).mockResolvedValue(page());

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useNotificationsList(enabled),
      { wrapper: wrapperFor(queryClient), initialProps: { enabled: false } },
    );

    expect(api.notifications.list).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.notifications.list).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// (g) component-level onOpenChange / list.isStale gated refetch
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard',
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/lib/socket', () => ({ useRealtimeSync: vi.fn() }));
vi.mock('@/components/expenses/expense-editor', () => ({ ExpenseEditorDialog: () => null }));
vi.mock('@/components/notifications/notification-row', () => ({
  NotificationRow: () => null,
}));

function testUser(): UserDto {
  return {
    id: 'me',
    name: 'Me',
    avatarColor: '#000',
    email: 'me@example.com',
    defaultCurrency: 'GBP',
    emailNotifications: true,
    staleBalanceRemindersEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('WI-073 — NotificationsMenu onOpenChange staleness-gated refetch (component-level)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: testUser(), status: 'authed', accessToken: 'test-token' });
    vi.mocked(api.notifications.unreadCount).mockResolvedValue({ count: 0 });
  });

  function renderMenu(queryClient: QueryClient) {
    render(
      <QueryClientProvider client={queryClient}>
        <AppLayout>content</AppLayout>
      </QueryClientProvider>,
    );
  }

  async function openBell() {
    const trigger = screen.getByLabelText(/Notifications/);
    await userEvent.click(trigger);
  }

  it('no GET /notifications request is made before the bell is ever opened', async () => {
    const queryClient = makeClient();
    vi.mocked(api.notifications.list).mockResolvedValue(page());
    renderMenu(queryClient);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.notifications.list).not.toHaveBeenCalled();
  });

  it('first open fetches exactly once', async () => {
    const queryClient = makeClient();
    vi.mocked(api.notifications.list).mockResolvedValue(page());
    renderMenu(queryClient);

    await openBell();

    await waitFor(() => expect(api.notifications.list).toHaveBeenCalledTimes(1));
  });

  it('reopening within the 30s staleTime does not force a refetch', async () => {
    const queryClient = makeClient();
    vi.mocked(api.notifications.list).mockResolvedValue(page());
    renderMenu(queryClient);

    await openBell(); // first open -> 1 fetch
    await waitFor(() => expect(api.notifications.list).toHaveBeenCalledTimes(1));

    await openBell(); // close
    await openBell(); // reopen, still fresh

    // Give any errant refetch a chance to fire, then assert it did not.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.notifications.list).toHaveBeenCalledTimes(1);
  });

  it('reopening after the query has gone stale (staleTime: 0) triggers exactly one refetch', async () => {
    const queryClient = makeClient(0); // staleTime 0 -> immediately stale after settling
    vi.mocked(api.notifications.list).mockResolvedValue(page());
    renderMenu(queryClient);

    await openBell(); // first open -> 1 fetch
    await waitFor(() => expect(api.notifications.list).toHaveBeenCalledTimes(1));

    await openBell(); // close
    await openBell(); // reopen while stale -> exactly one more fetch

    await waitFor(() => expect(api.notifications.list).toHaveBeenCalledTimes(2));
  });
});
