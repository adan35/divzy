// spec-WI-005 (web half) — invite copy button reliability.
//
// Covers: (1) the existing happy path (navigator.clipboard.writeText resolves)
// keeps working unchanged; (2) navigator.clipboard missing entirely falls back
// to the hidden-textarea/execCommand path and still shows success; (3) the
// fallback itself failing (execCommand returns false) surfaces toast.error and
// logs the real error via console.error, never silently swallowed; (4) the
// modern API being present but rejecting (permission denied etc.) also logs
// via console.error before showing toast.error.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import type { GroupDto } from '@divzy/shared';
import { InviteDialog } from './invite-dialog';
import { useAddMember, useAddMemberByFriend, useFriends, useRotateInviteCode } from '@/lib/hooks';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/hooks', () => ({
  useAddMember: vi.fn(),
  useAddMemberByFriend: vi.fn(),
  useRotateInviteCode: vi.fn(),
  useFriends: vi.fn(),
}));

const mockedUseAddMember = vi.mocked(useAddMember);
const mockedUseAddMemberByFriend = vi.mocked(useAddMemberByFriend);
const mockedUseRotateInviteCode = vi.mocked(useRotateInviteCode);
const mockedUseFriends = vi.mocked(useFriends);

function fixtureGroup(overrides: Partial<GroupDto> = {}): GroupDto {
  return {
    id: 'group-1',
    name: 'Roomies',
    emoji: '🏠',
    type: 'HOME',
    currency: 'USD',
    inviteCode: 'ABCDEFGHIJ',
    simplifyDebts: true,
    createdBy: { id: 'user-1', name: 'Sam Lee', avatarColor: '#000' },
    members: [
      {
        user: { id: 'user-1', name: 'Sam Lee', avatarColor: '#000' },
        role: 'ADMIN',
        joinedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('InviteDialog — copy invite link reliability (spec-WI-005)', () => {
  let originalClipboard: typeof navigator.clipboard | undefined;
  let originalExecCommand: typeof document.execCommand | undefined;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
    originalExecCommand = document.execCommand;
    // @ts-expect-error -- test setup only
    mockedUseAddMember.mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only
    mockedUseAddMemberByFriend.mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only
    mockedUseRotateInviteCode.mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only
    mockedUseFriends.mockReturnValue({ data: [], isLoading: false });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
      writable: true,
    });
    if (originalExecCommand) document.execCommand = originalExecCommand;
    vi.restoreAllMocks();
  });

  function setClipboard(value: unknown) {
    Object.defineProperty(navigator, 'clipboard', {
      value,
      configurable: true,
      writable: true,
    });
  }

  it('copies via navigator.clipboard.writeText and shows success (unchanged happy path)', async () => {
    // userEvent.setup() must run before setClipboard() — user-event installs
    // its own clipboard stub during setup(), which would otherwise clobber
    // this test's mock if installed afterward.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    render(<InviteDialog open group={fixtureGroup()} isAdmin onOpenChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: /copy invite link/i }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/join/ABCDEFGHIJ'));
    expect(toast.success).toHaveBeenCalledWith('Invite link copied');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('falls back to execCommand copy when navigator.clipboard is undefined, and still shows success', async () => {
    const user = userEvent.setup();
    setClipboard(undefined);
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    render(<InviteDialog open group={fixtureGroup()} isAdmin onOpenChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: /copy invite link/i }));

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(toast.success).toHaveBeenCalledWith('Invite link copied');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('falls back to execCommand when clipboard.writeText is not a function, and still shows success', async () => {
    const user = userEvent.setup();
    setClipboard({});
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    render(<InviteDialog open group={fixtureGroup()} isAdmin onOpenChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: /copy invite link/i }));

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(toast.success).toHaveBeenCalledWith('Invite link copied');
  });

  it('logs and surfaces an error toast when the fallback copy also fails (execCommand returns false)', async () => {
    const user = userEvent.setup();
    setClipboard(undefined);
    document.execCommand = vi.fn().mockReturnValue(false);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<InviteDialog open group={fixtureGroup()} isAdmin onOpenChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: /copy invite link/i }));

    expect(consoleError).toHaveBeenCalledWith(
      '[invite-dialog] copy failed',
      expect.any(Error),
    );
    expect(toast.error).toHaveBeenCalledWith(
      'Could not copy automatically — select the link and copy it.',
    );
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
  });

  it('logs and surfaces an error toast when navigator.clipboard.writeText itself rejects', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'));
    setClipboard({ writeText });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<InviteDialog open group={fixtureGroup()} isAdmin onOpenChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: /copy invite link/i }));

    expect(consoleError).toHaveBeenCalledWith(
      '[invite-dialog] copy failed',
      expect.any(Error),
    );
    expect(toast.error).toHaveBeenCalledWith(
      'Could not copy automatically — select the link and copy it.',
    );
  });
});
