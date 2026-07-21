// Build-stage TDD coverage for spec-WI-041 (granular notification
// preferences, auth's web Settings slice) — the push/email matrix rendered
// from GET /users/me/notification-preferences, with the 3 reserved
// categories (EXPENSE_DUE, MONTHLY_SUMMARY, PRODUCT_NEWS) disabled and
// labeled "Coming soon" rather than hidden or live. Per this domain's
// wholesale-hook-mock convention, '@/lib/hooks' is mocked wholesale.
//
// Mutation-instance layout under test (design §4 — "one mutation instance
// per control", same principle as WI-035): useUpdateNotificationPreference()
// is called TWICE per row (push, then email), in category order matching the
// canonical NOTIFICATION_CATEGORIES array — so each switch's pending state is
// independent of every other switch, not just every other row.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NotificationPreferencesDto, UserDto } from '@divzy/shared';
import SettingsPage from './page';
import { useAuth } from '@/lib/auth-store';
import {
  useChangePassword,
  useLogout,
  useNotificationPreferences,
  useUpdateMe,
  useUpdateNotificationPreference,
  useUploadAvatar,
} from '@/lib/hooks';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}));

vi.mock('@/lib/auth-store', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/hooks', () => ({
  useUpdateMe: vi.fn(),
  useLogout: vi.fn(),
  useChangePassword: vi.fn(),
  useUploadAvatar: vi.fn(),
  useNotificationPreferences: vi.fn(),
  useUpdateNotificationPreference: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseUpdateMe = vi.mocked(useUpdateMe);
const mockedUseLogout = vi.mocked(useLogout);
const mockedUseChangePassword = vi.mocked(useChangePassword);
const mockedUseUploadAvatar = vi.mocked(useUploadAvatar);
const mockedUseNotificationPreferences = vi.mocked(useNotificationPreferences);
const mockedUseUpdateNotificationPreference = vi.mocked(useUpdateNotificationPreference);

function user(overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: 'u1',
    name: 'Me',
    avatarColor: '#2a78d6',
    avatarUrl: null,
    email: 'me@example.com',
    defaultCurrency: 'USD',
    emailNotifications: true,
    staleBalanceRemindersEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, ...overrides };
}

function fullMatrix(): NotificationPreferencesDto {
  return {
    categories: [
      { category: 'EXPENSE_ADDED', pushEnabled: true, emailEnabled: true, available: true },
      { category: 'EXPENSE_EDITED', pushEnabled: true, emailEnabled: false, available: true },
      { category: 'EXPENSE_DELETED', pushEnabled: false, emailEnabled: true, available: true },
      { category: 'COMMENT', pushEnabled: true, emailEnabled: true, available: true },
      { category: 'PAYMENT_RECEIVED', pushEnabled: true, emailEnabled: true, available: true },
      { category: 'GROUP_INVITE', pushEnabled: true, emailEnabled: true, available: true },
      { category: 'EXPENSE_DUE', pushEnabled: true, emailEnabled: true, available: false },
      { category: 'MONTHLY_SUMMARY', pushEnabled: true, emailEnabled: true, available: false },
      { category: 'PRODUCT_NEWS', pushEnabled: true, emailEnabled: true, available: false },
    ],
  };
}

describe('SettingsPage — WI-041 notification preferences matrix', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ user: user(), status: 'authed' });
    mockedUseUpdateMe.mockReturnValue(mutation() as unknown as ReturnType<typeof useUpdateMe>);
    mockedUseLogout.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useLogout>);
    mockedUseChangePassword.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useChangePassword>);
    mockedUseUploadAvatar.mockReturnValue(
      mutation() as unknown as ReturnType<typeof useUploadAvatar>,
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders every buildable category as a live, independently-checked push+email pair', () => {
    mockedUseNotificationPreferences.mockReturnValue({
      data: fullMatrix(),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useNotificationPreferences>);
    mockedUseUpdateNotificationPreference.mockReturnValue(
      mutation() as unknown as ReturnType<typeof useUpdateNotificationPreference>,
    );

    render(<SettingsPage />);

    const editedPush = screen.getByRole('switch', { name: /expense edited push/i });
    const editedEmail = screen.getByRole('switch', { name: /expense edited email/i });
    expect(editedPush).toHaveAttribute('aria-checked', 'true');
    expect(editedEmail).toHaveAttribute('aria-checked', 'false');
    expect(editedPush).not.toBeDisabled();
    expect(editedEmail).not.toBeDisabled();
  });

  it('renders the 3 deferred categories disabled with a "Coming soon" label, never as live toggles', () => {
    mockedUseNotificationPreferences.mockReturnValue({
      data: fullMatrix(),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useNotificationPreferences>);
    mockedUseUpdateNotificationPreference.mockReturnValue(
      mutation() as unknown as ReturnType<typeof useUpdateNotificationPreference>,
    );

    render(<SettingsPage />);

    for (const name of [/expense due/i, /monthly summary/i, /product news/i]) {
      const row = screen.getByText(name).closest('div')!.parentElement!;
      expect(row).toHaveTextContent(/coming soon/i);
    }
    expect(screen.getByRole('switch', { name: /expense due push/i })).toBeDisabled();
    expect(screen.getByRole('switch', { name: /expense due email/i })).toBeDisabled();
    expect(screen.getByRole('switch', { name: /monthly summary push/i })).toBeDisabled();
    expect(screen.getByRole('switch', { name: /product news email/i })).toBeDisabled();
  });

  it('toggling a buildable category push switch sends only { category, pushEnabled }', async () => {
    mockedUseNotificationPreferences.mockReturnValue({
      data: {
        categories: [
          { category: 'COMMENT', pushEnabled: false, emailEnabled: true, available: true },
        ],
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useNotificationPreferences>);
    const pushMutation = mutation();
    const emailMutation = mutation();
    let call = 0;
    mockedUseUpdateNotificationPreference.mockImplementation(() => {
      call += 1;
      return (call === 1 ? pushMutation : emailMutation) as unknown as ReturnType<
        typeof useUpdateNotificationPreference
      >;
    });

    render(<SettingsPage />);
    const testUser = userEvent.setup();
    await testUser.click(screen.getByRole('switch', { name: /comments push/i }));

    expect(pushMutation.mutate).toHaveBeenCalledTimes(1);
    expect(pushMutation.mutate.mock.calls[0][0]).toEqual({
      category: 'COMMENT',
      pushEnabled: true,
    });
    expect(emailMutation.mutate).not.toHaveBeenCalled();
  });

  it('never sends a deferred category in a PATCH (deferred switches are inert, not just visually disabled)', async () => {
    mockedUseNotificationPreferences.mockReturnValue({
      data: {
        categories: [
          { category: 'EXPENSE_DUE', pushEnabled: true, emailEnabled: true, available: false },
        ],
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useNotificationPreferences>);
    const pushMutation = mutation();
    mockedUseUpdateNotificationPreference.mockReturnValue(
      pushMutation as unknown as ReturnType<typeof useUpdateNotificationPreference>,
    );

    render(<SettingsPage />);
    const testUser = userEvent.setup();
    // Disabled switches don't fire click handlers, but assert explicitly.
    await testUser.click(screen.getByRole('switch', { name: /expense due push/i }));

    expect(pushMutation.mutate).not.toHaveBeenCalled();
  });

  it('disables only one row\'s push switch while its own mutation is pending, leaving that row\'s email switch and other rows enabled', () => {
    mockedUseNotificationPreferences.mockReturnValue({
      data: {
        categories: [
          { category: 'COMMENT', pushEnabled: true, emailEnabled: true, available: true },
          { category: 'GROUP_INVITE', pushEnabled: true, emailEnabled: true, available: true },
        ],
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useNotificationPreferences>);
    let call = 0;
    mockedUseUpdateNotificationPreference.mockImplementation(() => {
      call += 1;
      // Call order: COMMENT push(1), COMMENT email(2), GROUP_INVITE push(3), GROUP_INVITE email(4).
      return mutation({ isPending: call === 1 }) as unknown as ReturnType<
        typeof useUpdateNotificationPreference
      >;
    });

    render(<SettingsPage />);

    expect(screen.getByRole('switch', { name: /comments push/i })).toBeDisabled();
    expect(screen.getByRole('switch', { name: /comments email/i })).not.toBeDisabled();
    expect(screen.getByRole('switch', { name: /group invites push/i })).not.toBeDisabled();
    expect(screen.getByRole('switch', { name: /group invites email/i })).not.toBeDisabled();
  });

  it('shows an inline error when the preferences fail to load', () => {
    mockedUseNotificationPreferences.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useNotificationPreferences>);
    mockedUseUpdateNotificationPreference.mockReturnValue(
      mutation() as unknown as ReturnType<typeof useUpdateNotificationPreference>,
    );

    render(<SettingsPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t load/i);
  });
});
