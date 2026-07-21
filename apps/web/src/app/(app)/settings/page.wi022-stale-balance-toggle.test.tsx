// Build-stage TDD coverage for spec-WI-022 — "Stale balance reminders" toggle
// in Settings > Notifications (web). Mirrors the existing emailNotifications
// toggle's markup/toast pattern, but per the corrected spec (cycle 1) uses its
// own dedicated `useUpdateMe()` mutation instance (`remindersMutation`),
// independent of the Email notifications row's `updateMe` instance, so the two
// switches' pending/disabled states never couple. Per this domain's convention
// (see invite-dialog.test.tsx), 'sonner' and the hooks/store modules the page
// depends on are mocked wholesale rather than rendered against real
// providers, so this suite only exercises the toggle wiring, not
// react-query/theme/router internals.
//
// NOTE (WI-035/WI-045): ProfileSection now calls useUpdateMe() THREE times per
// render (`updateMe` for the profile form, then `avatarUpdateMe` for the
// avatar controls, then `phoneUpdateMe` for the independent phone field — see
// page.wi035-avatar.test.tsx and page.wi045-phone.test.tsx). That shifts the
// call-order numbering the pending-state tests below rely on: call 1 =
// ProfileSection's `updateMe`, call 2 = ProfileSection's `avatarUpdateMe`,
// call 3 = ProfileSection's `phoneUpdateMe`, call 4 = NotificationsSection's
// email `updateMe`, call 5 = `remindersMutation`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
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
    email: 'me@example.com',
    defaultCurrency: 'USD',
    emailNotifications: true,
    staleBalanceRemindersEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function updateMeMutation(overrides: Partial<ReturnType<typeof useUpdateMe>> = {}) {
  return {
    mutate: vi.fn(),
    isPending: false,
    ...overrides,
  } as unknown as ReturnType<typeof useUpdateMe>;
}

describe('SettingsPage — WI-022 stale balance reminders toggle', () => {
  beforeEach(() => {
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

  it('renders in the off position for a fresh user (default false), positioned below Email notifications, which is unaffected', () => {
    mockedUseAuth.mockReturnValue({
      user: user({ staleBalanceRemindersEnabled: false, emailNotifications: true }),
      status: 'authed',
    });
    mockedUseUpdateMe.mockReturnValue(updateMeMutation());

    render(<SettingsPage />);

    const emailSwitch = screen.getByRole('switch', { name: 'Email notifications' });
    const remindersSwitch = screen.getByRole('switch', { name: 'Stale balance reminders' });

    expect(remindersSwitch).toHaveAttribute('aria-checked', 'false');
    expect(emailSwitch).toHaveAttribute('aria-checked', 'true');

    // "positioned directly below" — reminders switch must come after the
    // email switch in DOM order within the Notifications card.
    const allSwitches = screen.getAllByRole('switch');
    expect(allSwitches.indexOf(emailSwitch)).toBeLessThan(allSwitches.indexOf(remindersSwitch));
  });

  it('reflects an already-enabled value on load', () => {
    mockedUseAuth.mockReturnValue({ user: user({ staleBalanceRemindersEnabled: true }), status: 'authed' });
    mockedUseUpdateMe.mockReturnValue(updateMeMutation());

    render(<SettingsPage />);

    expect(screen.getByRole('switch', { name: 'Stale balance reminders' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('turning the toggle on sends only { staleBalanceRemindersEnabled: true } and shows a success toast on success', async () => {
    mockedUseAuth.mockReturnValue({ user: user({ staleBalanceRemindersEnabled: false }), status: 'authed' });
    const mutate = vi.fn((_input: unknown, opts?: { onSuccess?: (...args: unknown[]) => void }) =>
      opts?.onSuccess?.(),
    ) as unknown as ReturnType<typeof useUpdateMe>['mutate'];
    mockedUseUpdateMe.mockReturnValue(updateMeMutation({ mutate }));

    render(<SettingsPage />);
    const testUser = userEvent.setup();
    await testUser.click(screen.getByRole('switch', { name: 'Stale balance reminders' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mutate).mock.calls[0][0]).toEqual({ staleBalanceRemindersEnabled: true });
    expect(toast.success).toHaveBeenCalledWith('Stale balance reminders on');
  });

  it('turning the toggle off sends only { staleBalanceRemindersEnabled: false }', async () => {
    mockedUseAuth.mockReturnValue({ user: user({ staleBalanceRemindersEnabled: true }), status: 'authed' });
    const mutate = vi.fn((_input: unknown, opts?: { onSuccess?: (...args: unknown[]) => void }) =>
      opts?.onSuccess?.(),
    ) as unknown as ReturnType<typeof useUpdateMe>['mutate'];
    mockedUseUpdateMe.mockReturnValue(updateMeMutation({ mutate }));

    render(<SettingsPage />);
    const testUser = userEvent.setup();
    await testUser.click(screen.getByRole('switch', { name: 'Stale balance reminders' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mutate).mock.calls[0][0]).toEqual({ staleBalanceRemindersEnabled: false });
    expect(toast.success).toHaveBeenCalledWith('Stale balance reminders off');
  });

  it('does not include emailNotifications in the body when only the reminders toggle changes', async () => {
    mockedUseAuth.mockReturnValue({
      user: user({ staleBalanceRemindersEnabled: false, emailNotifications: true }),
      status: 'authed',
    });
    const mutate = vi.fn();
    mockedUseUpdateMe.mockReturnValue(updateMeMutation({ mutate }));

    render(<SettingsPage />);
    const testUser = userEvent.setup();
    await testUser.click(screen.getByRole('switch', { name: 'Stale balance reminders' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const [body] = mutate.mock.calls[0];
    expect(body).toEqual({ staleBalanceRemindersEnabled: true });
    expect(body).not.toHaveProperty('emailNotifications');
  });

  it('disables only the reminders switch while its own mutation is pending, leaving Email notifications enabled', () => {
    // SettingsPage calls useUpdateMe() five times per render, in this fixed
    // order: ProfileSection's `updateMe`, ProfileSection's `avatarUpdateMe`
    // (WI-035), ProfileSection's `phoneUpdateMe` (WI-045),
    // NotificationsSection's email-row `updateMe`, then NotificationsSection's
    // `remindersMutation`. Drive each call site's pending state independently
    // via call order so the two Notifications-row switches can be asserted as
    // decoupled.
    mockedUseAuth.mockReturnValue({ user: user(), status: 'authed' });
    let call = 0;
    mockedUseUpdateMe.mockImplementation(() => {
      call += 1;
      return updateMeMutation({ isPending: call === 5 });
    });

    render(<SettingsPage />);

    expect(screen.getByRole('switch', { name: 'Stale balance reminders' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Email notifications' })).not.toBeDisabled();
  });

  it('disables only the Email notifications switch while its own mutation is pending, leaving reminders enabled', () => {
    mockedUseAuth.mockReturnValue({ user: user(), status: 'authed' });
    let call = 0;
    mockedUseUpdateMe.mockImplementation(() => {
      call += 1;
      return updateMeMutation({ isPending: call === 4 });
    });

    render(<SettingsPage />);

    expect(screen.getByRole('switch', { name: 'Email notifications' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Stale balance reminders' })).not.toBeDisabled();
  });
});
