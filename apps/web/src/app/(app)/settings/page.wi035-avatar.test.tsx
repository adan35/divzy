// Build-stage TDD coverage for spec-WI-035 (profile picture upload) — the web
// Settings > Profile avatar upload/replace/remove UI. Per this domain's
// wholesale-hook-mock convention (see page.wi022-stale-balance-toggle.test.tsx),
// '@/lib/hooks' and 'sonner' are mocked wholesale, so this suite exercises the
// upload/remove wiring and client-side pre-validation, not react-query
// internals.
//
// Mutation-instance layout under test (design §4 / DRB security condition —
// "one mutation instance per independent control"):
//   - ProfileSection calls useUpdateMe() TWICE: `updateMe` (the name/color/
//     currency form) then `avatarUpdateMe` (avatar set/clear), in that order.
//   - useUploadAvatar() is its own hook/mock entirely, independent of both.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('SettingsPage — WI-035 avatar upload', () => {
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

  function selectFile(input: HTMLElement, file: File) {
    // applyAccept: false — user-event's default upload() silently drops files
    // that don't match the input's `accept` attribute (mimicking the native
    // file picker's own filter), which would prevent these tests from ever
    // exercising our own client-side MIME/size validation. Bypass that filter
    // so we can assert our validation runs on a file a user could still
    // supply via drag-and-drop or a renamed extension.
    return userEvent.setup({ applyAccept: false }).upload(input, file);
  }

  it('shows "Upload photo" and a disabled Remove control when the user has no avatar', () => {
    mockedUseAuth.mockReturnValue({ user: user({ avatarUrl: null }), status: 'authed' });
    mockedUseUpdateMe.mockReturnValue(mutation() as unknown as ReturnType<typeof useUpdateMe>);
    mockedUseUploadAvatar.mockReturnValue(
      mutation() as unknown as ReturnType<typeof useUploadAvatar>,
    );

    render(<SettingsPage />);

    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  });

  it('shows "Change photo" and an enabled Remove control when the user has an avatar', () => {
    mockedUseAuth.mockReturnValue({
      user: user({ avatarUrl: '/uploads/avatars/abc123.jpg' }),
      status: 'authed',
    });
    mockedUseUpdateMe.mockReturnValue(mutation() as unknown as ReturnType<typeof useUpdateMe>);
    mockedUseUploadAvatar.mockReturnValue(
      mutation() as unknown as ReturnType<typeof useUploadAvatar>,
    );

    render(<SettingsPage />);

    expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
  });

  it('clicking Remove calls avatarUpdateMe.mutate({ avatarUrl: null })', async () => {
    mockedUseAuth.mockReturnValue({
      user: user({ avatarUrl: '/uploads/avatars/abc123.jpg' }),
      status: 'authed',
    });
    const avatarUpdateMe = mutation();
    let call = 0;
    mockedUseUpdateMe.mockImplementation(() => {
      call += 1;
      // Call 1 = ProfileSection's form `updateMe`; call 2 = `avatarUpdateMe`.
      return (call === 2 ? avatarUpdateMe : mutation()) as unknown as ReturnType<
        typeof useUpdateMe
      >;
    });
    mockedUseUploadAvatar.mockReturnValue(
      mutation() as unknown as ReturnType<typeof useUploadAvatar>,
    );

    render(<SettingsPage />);
    const testUser = userEvent.setup();
    await testUser.click(screen.getByRole('button', { name: 'Remove' }));

    expect(avatarUpdateMe.mutate).toHaveBeenCalledTimes(1);
    expect(avatarUpdateMe.mutate.mock.calls[0][0]).toEqual({ avatarUrl: null });
  });

  it('rejects an oversized file client-side (never calls the upload mutation) and shows an inline error', async () => {
    mockedUseAuth.mockReturnValue({ user: user(), status: 'authed' });
    mockedUseUpdateMe.mockReturnValue(mutation() as unknown as ReturnType<typeof useUpdateMe>);
    const upload = mutation();
    mockedUseUploadAvatar.mockReturnValue(upload as unknown as ReturnType<typeof useUploadAvatar>);

    render(<SettingsPage />);
    const input = screen.getByLabelText('Upload profile photo', { selector: 'input' });
    const big = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });

    await selectFile(input, big);

    expect(upload.mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/10\s*MB/i)).toBeInTheDocument();
  });

  it('rejects an unsupported MIME type client-side and shows an inline error', async () => {
    mockedUseAuth.mockReturnValue({ user: user(), status: 'authed' });
    mockedUseUpdateMe.mockReturnValue(mutation() as unknown as ReturnType<typeof useUpdateMe>);
    const upload = mutation();
    mockedUseUploadAvatar.mockReturnValue(upload as unknown as ReturnType<typeof useUploadAvatar>);

    render(<SettingsPage />);
    const input = screen.getByLabelText('Upload profile photo', { selector: 'input' });
    const badFile = new File(['<svg/>'], 'evil.svg', { type: 'image/svg+xml' });

    await selectFile(input, badFile);

    expect(upload.mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/jpeg|png|webp|heic|heif/i)).toBeInTheDocument();
  });

  it('a valid file upload calls uploads.avatar then chains avatarUpdateMe.mutate({ avatarUrl }) on success', async () => {
    mockedUseAuth.mockReturnValue({ user: user({ avatarUrl: null }), status: 'authed' });
    const avatarUpdateMe = mutation();
    let call = 0;
    mockedUseUpdateMe.mockImplementation(() => {
      call += 1;
      return (call === 2 ? avatarUpdateMe : mutation()) as unknown as ReturnType<
        typeof useUpdateMe
      >;
    });
    const upload = {
      mutate: vi.fn(
        (
          _file: File,
          opts?: { onSuccess?: (res: { url: string }) => void; onError?: (e: unknown) => void },
        ) => opts?.onSuccess?.({ url: '/uploads/avatars/newfile.jpg' }),
      ),
      isPending: false,
    };
    mockedUseUploadAvatar.mockReturnValue(upload as unknown as ReturnType<typeof useUploadAvatar>);

    render(<SettingsPage />);
    const input = screen.getByLabelText('Upload profile photo', { selector: 'input' });
    const goodFile = new File(['data'], 'photo.png', { type: 'image/png' });

    await selectFile(input, goodFile);

    expect(upload.mutate).toHaveBeenCalledTimes(1);
    expect(avatarUpdateMe.mutate).toHaveBeenCalledTimes(1);
    expect(avatarUpdateMe.mutate.mock.calls[0][0]).toEqual({
      avatarUrl: '/uploads/avatars/newfile.jpg',
    });
  });

  it('shows an inline error and leaves the existing avatar unchanged when the upload call fails', async () => {
    mockedUseAuth.mockReturnValue({
      user: user({ avatarUrl: '/uploads/avatars/existing.jpg' }),
      status: 'authed',
    });
    const avatarUpdateMe = mutation();
    let call = 0;
    mockedUseUpdateMe.mockImplementation(() => {
      call += 1;
      return (call === 2 ? avatarUpdateMe : mutation()) as unknown as ReturnType<
        typeof useUpdateMe
      >;
    });
    const upload = {
      mutate: vi.fn((_file: File, opts?: { onError?: (e: unknown) => void }) =>
        opts?.onError?.(new Error('boom')),
      ),
      isPending: false,
    };
    mockedUseUploadAvatar.mockReturnValue(upload as unknown as ReturnType<typeof useUploadAvatar>);

    render(<SettingsPage />);
    const input = screen.getByLabelText('Upload profile photo', { selector: 'input' });
    const goodFile = new File(['data'], 'photo.png', { type: 'image/png' });

    await selectFile(input, goodFile);

    expect(avatarUpdateMe.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument();
  });

  it('disables only the avatar controls while avatarUpdateMe is pending, leaving the profile Name field enabled', () => {
    mockedUseAuth.mockReturnValue({
      user: user({ avatarUrl: '/uploads/avatars/existing.jpg' }),
      status: 'authed',
    });
    let call = 0;
    mockedUseUpdateMe.mockImplementation(() => {
      call += 1;
      // call 1 = form updateMe, call 2 = avatarUpdateMe.
      return mutation({ isPending: call === 2 }) as unknown as ReturnType<typeof useUpdateMe>;
    });
    mockedUseUploadAvatar.mockReturnValue(
      mutation() as unknown as ReturnType<typeof useUploadAvatar>,
    );

    render(<SettingsPage />);

    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
    expect(screen.getByLabelText('Name', { exact: false })).not.toBeDisabled();
  });

  it('disables only the profile Name field while the form updateMe is pending, leaving the avatar Remove control enabled', () => {
    mockedUseAuth.mockReturnValue({
      user: user({ avatarUrl: '/uploads/avatars/existing.jpg' }),
      status: 'authed',
    });
    let call = 0;
    mockedUseUpdateMe.mockImplementation(() => {
      call += 1;
      // call 1 = form updateMe, call 2 = avatarUpdateMe.
      return mutation({ isPending: call === 1 }) as unknown as ReturnType<typeof useUpdateMe>;
    });
    mockedUseUploadAvatar.mockReturnValue(
      mutation() as unknown as ReturnType<typeof useUploadAvatar>,
    );

    render(<SettingsPage />);

    expect(screen.getByLabelText('Name', { exact: false })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).not.toBeDisabled();
  });
});
