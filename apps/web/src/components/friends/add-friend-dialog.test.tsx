// spec-WI-045 (web half) — "Add a friend" gains phone as a second identifier
// kind alongside email. Single "Email or phone" field, validated inline with
// shared zEmail/zPhone, submitted via zAddFriendInput.safeParse -> { kind,
// identifier }. No hand-rolled regex.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@divzy/api-client';
import type { FriendDto } from '@divzy/shared';
import { AddFriendDialog } from './add-friend-dialog';
import { useAddFriend } from '@/lib/hooks';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/hooks', () => ({
  useAddFriend: vi.fn(),
}));

const mockedUseAddFriend = vi.mocked(useAddFriend);

function fixtureFriend(overrides: Partial<FriendDto> = {}): FriendDto {
  return {
    user: { id: 'friend-1', name: 'Alex Rivera', avatarColor: '#111' },
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    balancesByGroup: [],
    lastActivityAt: null,
    ...overrides,
  };
}

describe('AddFriendDialog — email or phone identifier (spec-WI-045)', () => {
  const mutate = vi.fn();
  const reset = vi.fn();

  beforeEach(() => {
    // @ts-expect-error -- test setup only
    mockedUseAddFriend.mockReturnValue({
      mutate,
      isPending: false,
      error: null,
      reset,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders a single "Email or phone" field with a generalized placeholder', () => {
    render(<AddFriendDialog open onOpenChange={() => {}} />);

    expect(screen.getByLabelText(/^Email or phone/)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('you@example.com or +1 415 555 2671'),
    ).toBeInTheDocument();
  });

  it('shows the description mentioning email or phone', () => {
    render(<AddFriendDialog open onOpenChange={() => {}} />);

    expect(
      screen.getByText(/enter the email or phone number they use on divzy/i),
    ).toBeInTheDocument();
  });

  it('submits { kind: "email", identifier } for a valid email', async () => {
    const user = userEvent.setup();
    render(<AddFriendDialog open onOpenChange={() => {}} />);

    await user.type(screen.getByLabelText(/^Email or phone/), 'Friend@Example.com');
    await user.click(screen.getByRole('button', { name: /add friend/i }));

    expect(mutate).toHaveBeenCalledWith(
      { kind: 'email', identifier: 'friend@example.com' },
      expect.anything(),
    );
  });

  it('submits { kind: "phone", identifier } for a valid phone number', async () => {
    const user = userEvent.setup();
    render(<AddFriendDialog open onOpenChange={() => {}} />);

    await user.type(screen.getByLabelText(/^Email or phone/), '+14155552671');
    await user.click(screen.getByRole('button', { name: /add friend/i }));

    expect(mutate).toHaveBeenCalledWith(
      { kind: 'phone', identifier: '+14155552671' },
      expect.anything(),
    );
  });

  it('shows "Enter a valid email or phone number" for an invalid identifier', async () => {
    const user = userEvent.setup();
    render(<AddFriendDialog open onOpenChange={() => {}} />);

    const input = screen.getByLabelText(/^Email or phone/);
    await user.type(input, 'not-an-identifier');
    fireEvent.blur(input);

    expect(screen.getByText('Enter a valid email or phone number')).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('shows the generalized not-found copy on a 404', () => {
    // @ts-expect-error -- test setup only
    mockedUseAddFriend.mockReturnValue({
      mutate,
      isPending: false,
      error: new ApiError(404, 'No Divzy account exists with that email or phone number', 'USER_NOT_FOUND'),
      reset,
    });

    render(<AddFriendDialog open onOpenChange={() => {}} />);

    expect(screen.getByText(/no divzy account for that email or phone yet/i)).toBeInTheDocument();
  });
});
