// Build-stage TDD coverage for spec-WI-068 §9.1 (auth screens row): mirrors
// login/page.wi068-error-icon.test.tsx for the Register page's submit-error
// banner — pairs `neg`-toned text with a visible icon.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@divzy/api-client';
import RegisterPage from './page';
import { useRegister } from '@/lib/hooks';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/lib/hooks', () => ({
  useRegister: vi.fn(),
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : 'error')),
}));

const mockedUseRegister = vi.mocked(useRegister);

function registerMutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, ...overrides };
}

describe('RegisterPage — WI-068 error icon pairing', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('pairs the submit-error alert (e.g. 409 email conflict) with a visible (aria-hidden) icon', async () => {
    const mutate = vi.fn(
      (_input: unknown, opts?: { onError?: (e: unknown) => void }) =>
        opts?.onError?.(new ApiError(409, 'Email taken', 'EMAIL_TAKEN')),
    );
    mockedUseRegister.mockReturnValue(
      registerMutation({ mutate }) as unknown as ReturnType<typeof useRegister>,
    );

    render(<RegisterPage />);
    const testUser = userEvent.setup();
    await testUser.type(screen.getByLabelText('Name'), 'Sam');
    await testUser.type(screen.getByLabelText('Email'), 'me@example.com');
    await testUser.type(screen.getByLabelText('Password'), 'hunter2222');
    await testUser.type(screen.getByLabelText('Confirm password'), 'hunter2222');
    await testUser.click(screen.getByRole('button', { name: 'Create account' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/already registered/i);
    const icon = alert.querySelector('svg[aria-hidden="true"]');
    expect(icon).not.toBeNull();
  });
});
