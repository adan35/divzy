// Build-stage TDD coverage for spec-WI-068 §9.1 (auth screens row): the
// submit-error banner pairs its `neg`-toned text with an icon (pro-rules:
// signal colors are never meaning-alone). Existing wiring/copy
// (page.wi045-phone.test.tsx) is untouched — this suite only locks the new
// icon pairing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@divzy/api-client';
import LoginPage from './page';
import { useLogin } from '@/lib/hooks';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/lib/hooks', () => ({
  useLogin: vi.fn(),
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : 'error')),
}));

const mockedUseLogin = vi.mocked(useLogin);

function loginMutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, ...overrides };
}

describe('LoginPage — WI-068 error icon pairing', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('pairs the submit-error alert with a visible (aria-hidden) icon, not text/color alone', async () => {
    const mutate = vi.fn(
      (_input: unknown, opts?: { onError?: (e: unknown) => void }) =>
        opts?.onError?.(new ApiError(401, 'Invalid credentials', 'INVALID_CREDENTIALS')),
    );
    mockedUseLogin.mockReturnValue(loginMutation({ mutate }) as unknown as ReturnType<typeof useLogin>);

    render(<LoginPage />);
    const testUser = userEvent.setup();
    await testUser.type(screen.getByLabelText('Email or phone'), 'me@example.com');
    await testUser.type(screen.getByLabelText('Password'), 'wrong');
    await testUser.click(screen.getByRole('button', { name: 'Log in' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/wrong email\/phone or password/i);
    const icon = alert.querySelector('svg[aria-hidden="true"]');
    expect(icon).not.toBeNull();
  });
});
