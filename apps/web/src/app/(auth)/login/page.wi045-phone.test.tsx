// Build-stage TDD coverage for spec-WI-045 (phone-number login, auth's web
// slice) — the Login page's "Email or phone" identifier field. Per this
// domain's wholesale-hook-mock convention (see the Settings page's
// page.wi0NN-*.test.tsx suites), '@/lib/hooks' is mocked wholesale, so this
// suite exercises the page's own validation/submission wiring, not
// react-query internals.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@divzy/api-client';
import LoginPage from './page';
import { useLogin } from '@/lib/hooks';

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock('@/lib/hooks', () => ({
  useLogin: vi.fn(),
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : 'error')),
}));

const mockedUseLogin = vi.mocked(useLogin);

function loginMutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, ...overrides };
}

describe('LoginPage — WI-045 phone-shaped identifier', () => {
  beforeEach(() => {
    replaceMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders a generic "Email or phone" text field (not type="email")', () => {
    mockedUseLogin.mockReturnValue(loginMutation() as unknown as ReturnType<typeof useLogin>);

    render(<LoginPage />);

    const input = screen.getByLabelText('Email or phone');
    expect(input).toHaveAttribute('type', 'text');
  });

  it('accepts a phone-shaped identifier and submits { kind: "phone", identifier, password }', async () => {
    const mutate = vi.fn();
    mockedUseLogin.mockReturnValue(
      loginMutation({ mutate }) as unknown as ReturnType<typeof useLogin>,
    );

    render(<LoginPage />);
    const testUser = userEvent.setup();
    await testUser.type(screen.getByLabelText('Email or phone'), '+14155552671');
    await testUser.type(screen.getByLabelText('Password'), 'hunter22');
    await testUser.click(screen.getByRole('button', { name: 'Log in' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const [body] = mutate.mock.calls[0];
    expect(body).toEqual({
      kind: 'phone',
      identifier: '+14155552671',
      password: 'hunter22',
    });
  });

  it('still accepts an email-shaped identifier and submits { kind: "email", ... }', async () => {
    const mutate = vi.fn();
    mockedUseLogin.mockReturnValue(
      loginMutation({ mutate }) as unknown as ReturnType<typeof useLogin>,
    );

    render(<LoginPage />);
    const testUser = userEvent.setup();
    await testUser.type(screen.getByLabelText('Email or phone'), 'me@example.com');
    await testUser.type(screen.getByLabelText('Password'), 'hunter22');
    await testUser.click(screen.getByRole('button', { name: 'Log in' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const [body] = mutate.mock.calls[0];
    expect(body).toEqual({
      kind: 'email',
      identifier: 'me@example.com',
      password: 'hunter22',
    });
  });

  it('rejects a value that is neither an email nor a phone number and never calls mutate', async () => {
    const mutate = vi.fn();
    mockedUseLogin.mockReturnValue(
      loginMutation({ mutate }) as unknown as ReturnType<typeof useLogin>,
    );

    render(<LoginPage />);
    const testUser = userEvent.setup();
    await testUser.type(screen.getByLabelText('Email or phone'), 'not-an-identifier');
    await testUser.type(screen.getByLabelText('Password'), 'hunter22');
    await testUser.click(screen.getByRole('button', { name: 'Log in' }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/enter a valid email or phone/i)).toBeInTheDocument();
  });

  it('surfaces a 401 as a generic wrong-identifier-or-password message regardless of identifier kind', async () => {
    const mutate = vi.fn(
      (_input: unknown, opts?: { onError?: (e: unknown) => void }) =>
        opts?.onError?.(new ApiError(401, 'Invalid credentials', 'INVALID_CREDENTIALS')),
    );
    mockedUseLogin.mockReturnValue(
      loginMutation({ mutate }) as unknown as ReturnType<typeof useLogin>,
    );

    render(<LoginPage />);
    const testUser = userEvent.setup();
    await testUser.type(screen.getByLabelText('Email or phone'), '+14155552671');
    await testUser.type(screen.getByLabelText('Password'), 'wrong');
    await testUser.click(screen.getByRole('button', { name: 'Log in' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/wrong email\/phone or password/i);
  });
});
