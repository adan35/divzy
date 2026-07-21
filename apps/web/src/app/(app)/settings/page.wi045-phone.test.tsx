// Build-stage TDD coverage for spec-WI-045 (phone-number login + settings,
// auth's web slice) — the Settings > Profile phone field. Per this domain's
// wholesale-hook-mock convention (see page.wi022-stale-balance-toggle.test.tsx
// / page.wi035-avatar.test.tsx), '@/lib/hooks' and 'sonner' are mocked
// wholesale, so this suite only exercises the phone field's own wiring, not
// react-query internals.
//
// Mutation-instance layout under test (spec §6 / DRB "one mutation instance
// per independent control" principle, same as the avatar controls):
//   - ProfileSection calls useUpdateMe() THREE times, in this order:
//     `updateMe` (name/avatarColor/currency form), `avatarUpdateMe` (avatar
//     set/clear, WI-035), `phoneUpdateMe` (this field, WI-045).
//   - 409 PHONE_TAKEN is NOT handled specially by the page — it relies on
//     `useUpdateMe()`'s own default `onError: toastError` path (verified here
//     the same way page.wi046-delete.test.tsx verifies the analogous
//     `useDeleteGroup` 409 case: the page's own success side effect must NOT
//     fire, and the typed value must NOT be discarded, when the mutation
//     doesn't call its passed `onSuccess`).
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
    avatarColor: '#2a78d6',
    avatarUrl: null,
    email: 'me@example.com',
    phone: null,
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

describe('SettingsPage — WI-045 phone field', () => {
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
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders empty for a user with no phone set', () => {
    mockedUseAuth.mockReturnValue({ user: user({ phone: null }), status: 'authed' });
    mockedUseUpdateMe.mockReturnValue(mutation() as unknown as ReturnType<typeof useUpdateMe>);

    render(<SettingsPage />);

    expect(screen.getByLabelText('Phone')).toHaveValue('');
  });

  it('renders the existing phone value on load', () => {
    mockedUseAuth.mockReturnValue({
      user: user({ phone: '+14155552671' }),
      status: 'authed',
    });
    mockedUseUpdateMe.mockReturnValue(mutation() as unknown as ReturnType<typeof useUpdateMe>);

    render(<SettingsPage />);

    expect(screen.getByLabelText('Phone')).toHaveValue('+14155552671');
  });

  it('the Save control next to Phone is disabled until the value changes', () => {
    mockedUseAuth.mockReturnValue({ user: user({ phone: null }), status: 'authed' });
    mockedUseUpdateMe.mockReturnValue(mutation() as unknown as ReturnType<typeof useUpdateMe>);

    render(<SettingsPage />);

    const saveButtons = screen.getAllByRole('button', { name: 'Save' });
    expect(saveButtons[0]).toBeDisabled();
  });

  // NOTE: unlike the WI-035 avatar tests (a single synchronous click with no
  // renders in between), these tests type into the Phone field first, and
  // `userEvent.type` re-renders ProfileSection once per keystroke. A
  // call-order counter (`call === 3`) only lines up on the very first render
  // — it silently points at the wrong mock object after any re-render, which
  // would make these tests pass even when the wiring is broken. Use ONE
  // shared mutation double for every `useUpdateMe()` call site instead (same
  // pattern as page.wi041-notifications.test.tsx's simpler cases); nothing
  // here needs cross-instance isolation, unlike the dedicated "disables only
  // ..." test below.
  it('setting a valid phone number calls phoneUpdateMe.mutate({ phone }) and shows a success toast', async () => {
    mockedUseAuth.mockReturnValue({ user: user({ phone: null }), status: 'authed' });
    const mutate = vi.fn(
      (_input: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
    );
    mockedUseUpdateMe.mockReturnValue(
      mutation({ mutate }) as unknown as ReturnType<typeof useUpdateMe>,
    );

    render(<SettingsPage />);
    const testUser = userEvent.setup();
    await testUser.type(screen.getByLabelText('Phone'), '+14155552671');
    await testUser.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({ phone: '+14155552671' });
    expect(toast.success).toHaveBeenCalledWith('Phone number updated');
  });

  it('clearing an existing phone number sends { phone: null } and shows a removal toast', async () => {
    mockedUseAuth.mockReturnValue({ user: user({ phone: '+14155552671' }), status: 'authed' });
    const mutate = vi.fn(
      (_input: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
    );
    mockedUseUpdateMe.mockReturnValue(
      mutation({ mutate }) as unknown as ReturnType<typeof useUpdateMe>,
    );

    render(<SettingsPage />);
    const testUser = userEvent.setup();
    const input = screen.getByLabelText('Phone');
    await testUser.clear(input);
    await testUser.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({ phone: null });
    expect(toast.success).toHaveBeenCalledWith('Phone number removed');
  });

  it('shows an inline validation error for a malformed phone number and never calls mutate', async () => {
    mockedUseAuth.mockReturnValue({ user: user({ phone: null }), status: 'authed' });
    const mutate = vi.fn();
    mockedUseUpdateMe.mockReturnValue(
      mutation({ mutate }) as unknown as ReturnType<typeof useUpdateMe>,
    );

    render(<SettingsPage />);
    const testUser = userEvent.setup();
    await testUser.type(screen.getByLabelText('Phone'), 'not-a-phone');
    await testUser.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    expect(screen.getByRole('alert')).toHaveTextContent(/valid phone number/i);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('on a 409 PHONE_TAKEN-style failure (mutate does not invoke onSuccess), no success toast fires and the typed value is preserved', async () => {
    mockedUseAuth.mockReturnValue({ user: user({ phone: null }), status: 'authed' });
    // Mimics the real useUpdateMe()'s default onError: toastError path — the
    // page passes no onError of its own, so a rejection just never calls
    // onSuccess; the generic hook (not under test here, mocked away) is
    // responsible for surfacing the 409's message.
    const mutate = vi.fn();
    mockedUseUpdateMe.mockReturnValue(
      mutation({ mutate }) as unknown as ReturnType<typeof useUpdateMe>,
    );

    render(<SettingsPage />);
    const testUser = userEvent.setup();
    const input = screen.getByLabelText('Phone');
    await testUser.type(input, '+14155552671');
    await testUser.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(input).toHaveValue('+14155552671');
  });

  it('disables only the phone Save control while phoneUpdateMe is pending, leaving Name and avatar controls enabled', () => {
    mockedUseAuth.mockReturnValue({
      user: user({ phone: null, avatarUrl: '/uploads/avatars/existing.jpg' }),
      status: 'authed',
    });
    let call = 0;
    mockedUseUpdateMe.mockImplementation(() => {
      call += 1;
      // call 1 = form updateMe, call 2 = avatarUpdateMe, call 3 = phoneUpdateMe.
      return mutation({ isPending: call === 3 }) as unknown as ReturnType<typeof useUpdateMe>;
    });

    render(<SettingsPage />);

    expect(screen.getByLabelText('Phone')).toBeDisabled();
    expect(screen.getByLabelText('Name', { exact: false })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).not.toBeDisabled();
  });
});
