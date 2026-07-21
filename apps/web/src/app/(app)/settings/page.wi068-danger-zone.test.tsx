// Build-stage TDD coverage for spec-WI-068 §9.1 as applied to the Settings
// page: the sign-out "Session" card is the page's one destructive-adjacent
// action ("danger zone" per the spec table) and gets a stronger hairline
// border plus a danger-styled (not neutral outline) Log out control. WI-035
// avatar controls and every other section are explicitly untouched by this
// slice — not re-asserted here (already covered by page.wi035-avatar.test.tsx
// et al., which stay green unmodified).
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

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'system', setTheme: vi.fn() }) }));
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

describe('SettingsPage — WI-068 danger zone (Session/Log out)', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ user: user(), status: 'authed' });
    mockedUseUpdateMe.mockReturnValue(mutation() as unknown as ReturnType<typeof useUpdateMe>);
    mockedUseChangePassword.mockReturnValue(
      mutation() as unknown as ReturnType<typeof useChangePassword>,
    );
    mockedUseUploadAvatar.mockReturnValue(
      mutation() as unknown as ReturnType<typeof useUploadAvatar>,
    );
    mockedUseNotificationPreferences.mockReturnValue({
      data: { categories: [] },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useNotificationPreferences>);
    mockedUseUpdateNotificationPreference.mockReturnValue(
      mutation() as unknown as ReturnType<typeof useUpdateNotificationPreference>,
    );
    mockedUseLogout.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useLogout>);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the Session card with a stronger hairline border (danger-zone separation)', () => {
    render(<SettingsPage />);
    const card = screen.getByText('Session').closest('[class*="border-hairline"]');
    expect(card).not.toBeNull();
    expect(card!.className).toContain('border-hairline-strong');
  });

  it('styles Log out as a danger action, not the previous neutral outline button', () => {
    render(<SettingsPage />);
    const logOutButton = screen.getByRole('button', { name: /log out/i });
    expect(logOutButton.className).toContain('text-danger');
  });

  it('the Log out control keeps working exactly as before (regression)', async () => {
    const mutateAsync = vi.fn();
    mockedUseLogout.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useLogout>);

    render(<SettingsPage />);
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.setup().click(screen.getByRole('button', { name: /log out/i }));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });
});
