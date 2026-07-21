// Build-stage TDD coverage for spec-WI-034 (professional-language copy pass,
// auth-owned surfaces) — the Session card's sign-out copy per
// `.company/domains/auth/design/WI-034.md` item 1: drops the "your data stays
// right where it is" reassurance sentence. Logout wiring itself is untouched
// (verified separately by not asserting on it here).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { UserDto } from '@divzy/shared';
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
    avatarColor: '#000',
    avatarUrl: null,
    email: 'me@example.com',
    defaultCurrency: 'USD',
    emailNotifications: true,
    staleBalanceRemindersEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('SettingsPage — WI-034 sign-out copy', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ user: user(), status: 'authed' });
    mockedUseUpdateMe.mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<
      typeof useUpdateMe
    >);
    mockedUseLogout.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useLogout>);
    mockedUseChangePassword.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useChangePassword>);
    mockedUseUploadAvatar.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useUploadAvatar>);
    mockedUseNotificationPreferences.mockReturnValue({
      data: { categories: [] },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useNotificationPreferences>);
    mockedUseUpdateNotificationPreference.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateNotificationPreference>);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the shortened sign-out copy with no reassurance sentence', () => {
    render(<SettingsPage />);
    expect(screen.getByText('Sign out of this device.')).toBeInTheDocument();
    expect(
      screen.queryByText(/your data stays right where it is/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/sign out on this device/i)).not.toBeInTheDocument();
  });

  it('leaves the Log out button intact', () => {
    render(<SettingsPage />);
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
  });
});
