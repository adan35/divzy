// Build-stage TDD coverage for spec-WI-068 §9.1 nav-shell punch list:
// active-item `brand-soft` pill + 2px `brand` left indicator, the ink+gold-dot
// wordmark (type-only, no logo change), the bell's `brand-fill` unread
// badge, the mobile FAB's `brand-fill`/`shadow-pop` chrome, and the 44px
// icon-button audit (bell trigger). Follows layout.test.tsx's established
// mocking harness (shell hooks stubbed; notification rows and the expense
// editor dialog stubbed so this suite never needs a real QueryClientProvider
// or socket connection).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { UserDto } from '@divzy/shared';
import { useAuth } from '@/lib/auth-store';
import { useNotificationsList, useUnreadCount } from '@/lib/hooks';
import AppLayout from './layout';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard',
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/lib/auth-store', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/socket', () => ({ useRealtimeSync: vi.fn() }));
vi.mock('@/components/expenses/expense-editor', () => ({ ExpenseEditorDialog: () => null }));
vi.mock('@/components/notifications/notification-row', () => ({ NotificationRow: () => null }));
vi.mock('@/lib/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks')>();
  return {
    ...actual,
    useLogout: vi.fn(() => ({ mutateAsync: vi.fn() })),
    useNotificationsList: vi.fn(),
    useUnreadCount: vi.fn(),
    useMarkAllNotificationsRead: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useClearAllNotifications: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  };
});

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseUnreadCount = vi.mocked(useUnreadCount);
const mockedUseNotificationsList = vi.mocked(useNotificationsList);

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

describe('AppLayout — WI-068 nav shell', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ user: user(), status: 'authed' });
    mockedUseUnreadCount.mockReturnValue({
      data: { count: 3 },
      isSuccess: true,
    } as unknown as ReturnType<typeof useUnreadCount>);
    mockedUseNotificationsList.mockReturnValue({
      data: { pages: [{ items: [], nextCursor: null }] },
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      refetch: vi.fn(),
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useNotificationsList>);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('wordmark reads ink (not brand-blue) with a distinct gold "." accent — type-only, no logo change', () => {
    render(<AppLayout>content</AppLayout>);
    const wordmarks = screen.getAllByText('divzy');
    expect(wordmarks.length).toBeGreaterThan(0);
    for (const mark of wordmarks) {
      expect(mark.className).toContain('text-ink');
      expect(mark.className).not.toContain('text-brand');
    }
    const dots = screen.getAllByText('.', { selector: 'span' });
    expect(dots.length).toBeGreaterThan(0);
    expect(dots[0]!.className).toContain('text-accent');
  });

  it('the active nav item shows the brand-soft pill and a 2px brand left indicator; inactive items reserve the same space (no CLS)', () => {
    render(<AppLayout>content</AppLayout>);
    const dashboardLink = screen.getByRole('link', { name: /dashboard/i });
    expect(dashboardLink).toHaveAttribute('aria-current', 'page');
    expect(dashboardLink.className).toContain('bg-brand-soft');
    expect(dashboardLink.className).toContain('border-brand');
    expect(dashboardLink.className).toContain('border-l-2');

    // "Groups" appears in both the desktop sidebar and the mobile tab bar —
    // the desktop sidebar nav renders first in DOM order.
    const groupsLink = screen.getAllByRole('link', { name: /^groups$/i })[0]!;
    expect(groupsLink).not.toHaveAttribute('aria-current');
    expect(groupsLink.className).toContain('border-l-2');
    expect(groupsLink.className).toContain('border-transparent');
  });

  it('the notification bell unread badge uses brand-fill/on-brand, not the old brand/white pairing', () => {
    render(<AppLayout>content</AppLayout>);
    const badge = screen.getByText('3');
    expect(badge.className).toContain('bg-brand-fill');
    expect(badge.className).toContain('text-on-brand');
    expect(badge.className).not.toContain('text-white');
  });

  it('the notification bell trigger meets the 44px touch-target floor (pro-rules §12)', () => {
    render(<AppLayout>content</AppLayout>);
    const bell = screen.getByLabelText(/notifications/i);
    expect(bell.className).toContain('h-11');
    expect(bell.className).toContain('w-11');
  });

  it('the mobile center FAB uses brand-fill/on-brand/shadow-pop, not the old brand/white/shadow-lg chrome', () => {
    render(<AppLayout>content</AppLayout>);
    // Two "Add expense" controls exist (desktop text Button + mobile FAB) —
    // the FAB is the only one identified purely by aria-label.
    const fab = screen.getByLabelText('Add expense');
    expect(fab.className).toContain('bg-brand-fill');
    expect(fab.className).toContain('text-on-brand');
    expect(fab.className).toContain('shadow-pop');
    expect(fab.className).not.toContain('shadow-lg');
  });
});
