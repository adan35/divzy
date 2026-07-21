// spec-WI-040 D3 — web share-link landing page for an incoming friend-add
// code, mirroring /join/[code]'s guest-redirect / confirm / success shape.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FriendDto } from '@divzy/shared';
import AddFriendByCodePage from './page';
import { useAuth } from '@/lib/auth-store';
import { useAddFriendByCode } from '@/lib/hooks';

const replaceMock = vi.fn();
const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ code: 'ABCDEFGHIJ' }),
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/auth-store', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/hooks', () => ({
  useAddFriendByCode: vi.fn(),
  errorMessage: () => 'error',
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseAddFriendByCode = vi.mocked(useAddFriendByCode);

function fixtureFriend(): FriendDto {
  return {
    user: { id: 'friend-1', name: 'Alex Rivera', avatarColor: '#111' },
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    lastActivityAt: null,
  };
}

describe('AddFriendByCodePage (spec-WI-040)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('redirects a guest to /login with a return path', () => {
    // @ts-expect-error -- test setup only
    mockedUseAuth.mockReturnValue({ status: 'guest' });
    // @ts-expect-error -- test setup only
    mockedUseAddFriendByCode.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });

    render(<AddFriendByCodePage />);

    expect(replaceMock).toHaveBeenCalledWith(
      expect.stringContaining('/login?next='),
    );
  });

  it('shows the code and an Add friend action for an authed user', () => {
    // @ts-expect-error -- test setup only
    mockedUseAuth.mockReturnValue({ status: 'authed' });
    // @ts-expect-error -- test setup only
    mockedUseAddFriendByCode.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });

    render(<AddFriendByCodePage />);

    expect(screen.getByText('ABCDEFGHIJ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add friend/i })).toBeInTheDocument();
  });

  it('calls useAddFriendByCode with the code and shows the new friend on success', async () => {
    const user = userEvent.setup();
    const mutate = vi.fn((_code: string, opts?: { onSuccess?: (f: FriendDto) => void }) => {
      opts?.onSuccess?.(fixtureFriend());
    });
    // @ts-expect-error -- test setup only
    mockedUseAuth.mockReturnValue({ status: 'authed' });
    // @ts-expect-error -- test setup only
    mockedUseAddFriendByCode.mockReturnValue({ mutate, isPending: false, isError: false });

    render(<AddFriendByCodePage />);
    await user.click(screen.getByRole('button', { name: /add friend/i }));

    expect(mutate).toHaveBeenCalledWith('ABCDEFGHIJ', expect.anything());
    expect(await screen.findByText(/you.re friends now/i)).toBeInTheDocument();
    expect(screen.getAllByText(/alex rivera/i).length).toBeGreaterThan(0);
  });
});
