'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  BarChart3,
  Bell,
  CheckCheck,
  History,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  MoreHorizontal,
  Plus,
  Repeat,
  Settings,
  Sun,
  UserRound,
  Users,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import type { NotificationDto } from '@divzy/shared';
import { useAuth } from '@/lib/auth-store';
import {
  useLogout,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsList,
  useUnreadCount,
} from '@/lib/hooks';
import { useRealtimeSync } from '@/lib/socket';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dropdown,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
} from '@/components/ui/dropdown';
import { Skeleton } from '@/components/ui/skeleton';
import { FullPageSpinner, Spinner } from '@/components/ui/spinner';
import { ExpenseEditorDialog } from '@/components/expenses/expense-editor';

// ---------------------------------------------------------------------------
// Navigation model
// ---------------------------------------------------------------------------

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/groups', label: 'Groups', icon: Users },
  { href: '/friends', label: 'Friends', icon: UserRound },
  { href: '/activity', label: 'Activity', icon: History },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/recurring', label: 'Recurring', icon: Repeat },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

const MOBILE_TABS = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { href: '/groups', label: 'Groups', icon: Users },
  { href: '/friends', label: 'Friends', icon: UserRound },
  { href: '/activity', label: 'Activity', icon: History },
] as const;

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/dashboard"
      className={cn('select-none text-xl font-bold lowercase tracking-tight text-brand', className)}
    >
      divzy
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Notifications bell + dropdown
// ---------------------------------------------------------------------------

function NotificationRow({ notification }: { notification: NotificationDto }) {
  const markRead = useMarkNotificationRead();
  const unread = notification.readAt === null;
  return (
    <button
      type="button"
      onClick={() => {
        if (unread && !markRead.isPending) markRead.mutate(notification.id);
      }}
      className={cn(
        'flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2',
        !unread && 'opacity-75',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
          unread ? 'bg-brand' : 'bg-transparent',
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{notification.title}</span>
        {notification.body && (
          <span className="mt-0.5 block text-[13px] leading-snug text-ink-2 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
            {notification.body}
          </span>
        )}
        <span className="mt-0.5 block text-xs text-ink-3">
          {formatRelative(notification.createdAt)}
        </span>
      </span>
    </button>
  );
}

function NotificationsMenu() {
  const [opened, setOpened] = useState(false);
  const unread = useUnreadCount();
  const list = useNotificationsList();
  const markAll = useMarkAllNotificationsRead();

  const count = unread.data?.count ?? 0;
  const notifications = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Dropdown
      align="end"
      contentClassName="w-[340px] max-w-[calc(100vw-2rem)] p-0"
      onOpenChange={(open) => {
        if (open) {
          setOpened(true);
          void list.refetch();
        }
      }}
      trigger={
        <span
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-[10px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          aria-label={count > 0 ? `Notifications (${count} unread)` : 'Notifications'}
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </span>
      }
    >
      <div className="flex items-center justify-between border-b border-hairline px-3.5 py-2.5">
        <span className="text-sm font-semibold text-ink">Notifications</span>
        {count > 0 && (
          <button
            type="button"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand-soft disabled:opacity-55"
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Mark all read
          </button>
        )}
      </div>
      <div className="scrollbar-thin max-h-[380px] overflow-y-auto">
        {list.isLoading && opened ? (
          <div className="space-y-3 p-3.5">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : notifications.length === 0 ? (
          <p className="px-3.5 py-8 text-center text-sm text-ink-3">
            You&rsquo;re all caught up 🎉
          </p>
        ) : (
          <>
            {notifications.map((n) => (
              <NotificationRow key={n.id} notification={n} />
            ))}
            {list.hasNextPage && (
              <button
                type="button"
                onClick={() => void list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
                className="flex w-full items-center justify-center gap-2 border-t border-hairline px-3 py-2.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-55"
              >
                {list.isFetchingNextPage && <Spinner size="sm" />}
                Show older
              </button>
            )}
          </>
        )}
      </div>
    </Dropdown>
  );
}

// ---------------------------------------------------------------------------
// User card + menu (theme toggle, logout)
// ---------------------------------------------------------------------------

function UserMenu() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const logout = useLogout();
  const router = useRouter();

  if (!user) return null;

  const handleLogout = async () => {
    await logout.mutateAsync();
    router.replace('/login');
  };

  const themeItem = (value: string, label: string, icon: ReactNode) => (
    <DropdownItem
      icon={icon}
      onSelect={() => setTheme(value)}
      keepOpen
      className={cn(theme === value && 'text-brand hover:text-brand')}
    >
      {label}
    </DropdownItem>
  );

  return (
    <Dropdown
      align="start"
      side="top"
      className="w-full"
      contentClassName="w-[228px]"
      trigger={
        <span className="flex w-full items-center gap-2.5 rounded-xl p-2 transition-colors hover:bg-surface-2">
          <Avatar user={user} size="md" />
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-medium text-ink">{user.name}</span>
            <span className="block truncate text-xs text-ink-3">{user.email}</span>
          </span>
          <MoreHorizontal className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
        </span>
      }
    >
      <DropdownLabel>Theme</DropdownLabel>
      {themeItem('light', 'Light', <Sun />)}
      {themeItem('dark', 'Dark', <Moon />)}
      {themeItem('system', 'System', <Monitor />)}
      <DropdownSeparator />
      <DropdownItem icon={<Settings />} onSelect={() => router.push('/settings')}>
        Settings
      </DropdownItem>
      <DropdownItem icon={<LogOut />} danger onSelect={() => void handleLogout()}>
        Log out
      </DropdownItem>
    </Dropdown>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export default function AppLayout({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [editorOpen, setEditorOpen] = useState(false);

  useRealtimeSync();

  useEffect(() => {
    if (status === 'guest') router.replace('/login');
  }, [status, router]);

  // Global "n" shortcut: new expense anywhere (unless typing or a dialog is up).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return;
        }
      }
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      setEditorOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (status !== 'authed') {
    return <FullPageSpinner />;
  }

  return (
    <div className="min-h-screen bg-page">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[260px] flex-col border-r border-hairline bg-surface lg:flex">
        <div className="px-5 pb-2 pt-5">
          <Wordmark />
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3" aria-label="Main">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-brand-soft text-brand'
                    : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-hairline p-3">
          <UserMenu />
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-h-screen flex-col lg:pl-[260px]">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-hairline bg-page-veil px-4 backdrop-blur lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Wordmark className="lg:hidden" />
          </div>
          <div className="flex items-center gap-1.5">
            <NotificationsMenu />
            <Button
              size="md"
              className="hidden lg:inline-flex"
              onClick={() => setEditorOpen(true)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add expense
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-6 lg:px-8 lg:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <div className="grid h-16 grid-cols-5">
          {MOBILE_TABS.slice(0, 2).map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
                  active ? 'text-brand' : 'text-ink-3',
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {label}
              </Link>
            );
          })}
          <div className="flex items-start justify-center">
            <button
              type="button"
              aria-label="Add expense"
              onClick={() => setEditorOpen(true)}
              className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-lg transition-colors hover:bg-brand-hover"
            >
              <Plus className="h-6 w-6" aria-hidden="true" />
            </button>
          </div>
          {MOBILE_TABS.slice(2).map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
                  active ? 'text-brand' : 'text-ink-3',
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>

      <ExpenseEditorDialog open={editorOpen} onOpenChange={setEditorOpen} />
    </div>
  );
}
