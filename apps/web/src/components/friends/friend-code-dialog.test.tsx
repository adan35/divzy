// spec-WI-040 (web half) — persistent friend-add code share sheet: code +
// copy + QR + regenerate. No camera scan on web (mobile-only, per spec).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { FriendCodeDialog } from './friend-code-dialog';
import { useFriendCode, useRotateFriendCode } from '@/lib/hooks';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/hooks', () => ({
  useFriendCode: vi.fn(),
  useRotateFriendCode: vi.fn(),
}));

const mockedUseFriendCode = vi.mocked(useFriendCode);
const mockedUseRotateFriendCode = vi.mocked(useRotateFriendCode);

describe('FriendCodeDialog (spec-WI-040)', () => {
  let originalClipboard: typeof navigator.clipboard | undefined;
  const rotateMutate = vi.fn();

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
    // @ts-expect-error -- test setup only
    mockedUseRotateFriendCode.mockReturnValue({ mutate: rotateMutate, isPending: false });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
      writable: true,
    });
  });

  it('shows a loading state while the code is being created lazily', () => {
    // @ts-expect-error -- test setup only
    mockedUseFriendCode.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<FriendCodeDialog open onOpenChange={() => {}} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders the code, the shareUrl, and a QR code', () => {
    // @ts-expect-error -- test setup only
    mockedUseFriendCode.mockReturnValue({
      data: { code: 'ABCDEFGHIJ', shareUrl: 'https://divzy.app/add-friend/ABCDEFGHIJ' },
      isLoading: false,
      isError: false,
    });
    render(<FriendCodeDialog open onOpenChange={() => {}} />);

    expect(screen.getByText('ABCDEFGHIJ')).toBeInTheDocument();
    expect(
      screen.getByDisplayValue('https://divzy.app/add-friend/ABCDEFGHIJ'),
    ).toBeInTheDocument();
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('copies the share link and shows a success toast', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    // @ts-expect-error -- test setup only
    mockedUseFriendCode.mockReturnValue({
      data: { code: 'ABCDEFGHIJ', shareUrl: 'https://divzy.app/add-friend/ABCDEFGHIJ' },
      isLoading: false,
      isError: false,
    });
    render(<FriendCodeDialog open onOpenChange={() => {}} />);

    await user.click(screen.getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith('https://divzy.app/add-friend/ABCDEFGHIJ');
    expect(toast.success).toHaveBeenCalled();
  });

  it('regenerates the code via useRotateFriendCode on confirm', async () => {
    const user = userEvent.setup();
    // @ts-expect-error -- test setup only
    mockedUseFriendCode.mockReturnValue({
      data: { code: 'ABCDEFGHIJ', shareUrl: 'https://divzy.app/add-friend/ABCDEFGHIJ' },
      isLoading: false,
      isError: false,
    });
    render(<FriendCodeDialog open onOpenChange={() => {}} />);

    await user.click(screen.getByRole('button', { name: /regenerate/i }));
    await user.click(screen.getByRole('button', { name: /confirm|yes|regenerate code/i }));

    expect(rotateMutate).toHaveBeenCalled();
  });

  it('has no camera-scan affordance on web (display/copy/regenerate/QR only)', () => {
    // @ts-expect-error -- test setup only
    mockedUseFriendCode.mockReturnValue({
      data: { code: 'ABCDEFGHIJ', shareUrl: 'https://divzy.app/add-friend/ABCDEFGHIJ' },
      isLoading: false,
      isError: false,
    });
    render(<FriendCodeDialog open onOpenChange={() => {}} />);
    expect(screen.queryByRole('button', { name: /scan/i })).not.toBeInTheDocument();
  });
});
