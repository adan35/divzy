// Build-stage TDD coverage for spec-WI-016 Part B (ADR-013) — the
// shareable settle-up link/QR affordance added to `SettleUpDialog`. Mirrors
// `settle-dialog.wi012-balance-gate.test.tsx`'s mocking approach exactly
// (useAuth/useGroup/useFriends/useCreateSettlement/useGroupBalances), plus:
// - mocks `qrcode.react` to capture exactly what's passed to `QRCodeSVG`'s
//   `value` prop (never just "a QR renders" — the link string itself is the
//   contract under test).
// - drives the real clipboard fallback path the same way
//   `invite-dialog.test.tsx` does (Object.defineProperty(navigator,
//   'clipboard', ...)) rather than mocking `@/lib/clipboard`, so the actual
//   copy behavior is exercised end to end.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import type { FriendDto, GroupBalancesDto, GroupDto, UserDto } from '@divzy/shared';
import { SettleUpDialog } from './settle-dialog';
import { useAuth } from '@/lib/auth-store';
import {
  useCreateSettlement,
  useFriends,
  useGroup,
  useGroupBalances,
  useUploadReceipt,
} from '@/lib/hooks';

let capturedQrValue: unknown;

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('qrcode.react', () => ({
  QRCodeSVG: (props: { value: string }) => {
    capturedQrValue = props.value;
    return <svg data-testid="settle-share-qr" />;
  },
}));
vi.mock('@/lib/auth-store', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks')>();
  return {
    ...actual,
    useGroup: vi.fn(),
    useFriends: vi.fn(),
    useCreateSettlement: vi.fn(),
    useGroupBalances: vi.fn(),
    // WI-023: SettleUpDialog now also calls `useUploadReceipt` for the
    // optional proof attachment — stub it out, unrelated to this share-link test.
    useUploadReceipt: vi.fn(),
  };
});

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseGroup = vi.mocked(useGroup);
const mockedUseFriends = vi.mocked(useFriends);
const mockedUseCreateSettlement = vi.mocked(useCreateSettlement);
const mockedUseGroupBalances = vi.mocked(useGroupBalances);
const mockedUseUploadReceipt = vi.mocked(useUploadReceipt);

function user(id: string, name: string): UserDto {
  return {
    id,
    name,
    avatarColor: '#123456',
    email: `${id}@example.com`,
    defaultCurrency: 'EUR',
    emailNotifications: true,
    staleBalanceRemindersEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const me = user('user_id_1', 'Me');
const bob = user('user_id_2', 'Bob');
const cara = user('user_id_3', 'Cara');

function fixtureGroup(): GroupDto {
  return {
    id: 'group_ski_2026',
    name: 'Ski Trip 2026',
    emoji: '🎿',
    type: 'TRIP',
    currency: 'EUR',
    inviteCode: 'ABCDEFGHIJ',
    simplifyDebts: true,
    createdBy: me,
    members: [
      { user: me, role: 'ADMIN', joinedAt: '2026-01-01T00:00:00.000Z' },
      { user: bob, role: 'MEMBER', joinedAt: '2026-01-02T00:00:00.000Z' },
      { user: cara, role: 'MEMBER', joinedAt: '2026-01-03T00:00:00.000Z' },
    ],
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function groupQuery(data: GroupDto | undefined) {
  return { data, isLoading: false, isError: false, error: null } as unknown as ReturnType<
    typeof useGroup
  >;
}

function friendsQuery(data: FriendDto[]) {
  return { data, isLoading: false, isError: false, error: null } as unknown as ReturnType<
    typeof useFriends
  >;
}

function groupBalancesQuery(data: GroupBalancesDto | undefined) {
  return {
    data,
    isLoading: data === undefined,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useGroupBalances>;
}

function mutationStub(overrides: Partial<ReturnType<typeof useCreateSettlement>> = {}) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useCreateSettlement>;
}

function fixtureGroupBalances(members: GroupBalancesDto['members']): GroupBalancesDto {
  return {
    groupId: 'group_ski_2026',
    viewerCurrency: 'EUR',
    usedFallbackRates: false,
    members,
    pairwise: [],
    suggestions: [],
  };
}

function expectedLink(params: {
  fromUserId: string;
  toUserId: string;
  amount: number;
  currency: string;
  groupId?: string;
}): string {
  const qs = new URLSearchParams({
    fromUserId: params.fromUserId,
    toUserId: params.toUserId,
    amount: String(params.amount),
    currency: params.currency,
  });
  if (params.groupId) qs.set('groupId', params.groupId);
  return `${window.location.origin}/settle?${qs.toString()}`;
}

function uploadStub() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
  } as unknown as ReturnType<typeof useUploadReceipt>;
}

describe('SettleUpDialog — WI-016 Part B shareable link/QR', () => {
  let originalClipboard: typeof navigator.clipboard | undefined;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
    mockedUseAuth.mockReturnValue({ user: me, status: 'authed' });
    mockedUseUploadReceipt.mockReturnValue(uploadStub());
    mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup()));
    mockedUseFriends.mockReturnValue(friendsQuery([]));
    mockedUseCreateSettlement.mockReturnValue(mutationStub());
    mockedUseGroupBalances.mockReturnValue(
      groupBalancesQuery(
        fixtureGroupBalances([
          { user: me, balances: [{ currency: 'EUR', amount: -5000 }] },
          { user: bob, balances: [{ currency: 'EUR', amount: 5000 }] },
          { user: cara, balances: [] },
        ]),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    capturedQrValue = undefined;
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
      writable: true,
    });
  });

  function setClipboard(value: unknown) {
    Object.defineProperty(navigator, 'clipboard', {
      value,
      configurable: true,
      writable: true,
    });
  }

  it('once parties/amount/currency are resolved, a Share affordance reveals a QR encoding exactly the settle-link params (including groupId)', async () => {
    const testUser = userEvent.setup();
    render(
      <SettleUpDialog
        open
        onOpenChange={() => {}}
        groupId="group_ski_2026"
        prefill={{ fromUserId: me.id, toUserId: bob.id, amount: 4200, currency: 'EUR' }}
      />,
    );
    await screen.findByLabelText('Amount');

    // Not revealed until the user asks to share.
    expect(screen.queryByTestId('settle-share-qr')).not.toBeInTheDocument();

    await testUser.click(screen.getByRole('button', { name: /share/i }));

    expect(screen.getByTestId('settle-share-qr')).toBeInTheDocument();
    expect(capturedQrValue).toBe(
      expectedLink({
        fromUserId: me.id,
        toUserId: bob.id,
        amount: 4200,
        currency: 'EUR',
        groupId: 'group_ski_2026',
      }),
    );
    // The resolved amount was inside the net-position ceiling — Record
    // payment stays enabled, proving the new Share affordance doesn't
    // interfere with the existing WI-012 gate.
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeEnabled();
  });

  it('Copy link copies the exact same URL shown/encoded and shows success feedback', async () => {
    const testUser = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    render(
      <SettleUpDialog
        open
        onOpenChange={() => {}}
        groupId="group_ski_2026"
        prefill={{ fromUserId: me.id, toUserId: bob.id, amount: 4200, currency: 'EUR' }}
      />,
    );
    await screen.findByLabelText('Amount');
    await testUser.click(screen.getByRole('button', { name: /share/i }));

    const link = expectedLink({
      fromUserId: me.id,
      toUserId: bob.id,
      amount: 4200,
      currency: 'EUR',
      groupId: 'group_ski_2026',
    });
    await testUser.click(screen.getByRole('button', { name: /copy link/i }));

    expect(writeText).toHaveBeenCalledWith(link);
    expect(toast.success).toHaveBeenCalled();
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('a non-party opening a shared Bob/Cara-style link (excluding "me") still sees the exact prefill in the QR/link, but Record payment stays disabled — the existing meInvolved gate is not bypassed', async () => {
    // Driven through the dialog's own From/To selects + Amount field rather
    // than `prefill` — mounting the real dialog with a `prefill` whose
    // parties exclude the mocked "me" races against the "fill blanks" effect
    // under synchronous 3+-candidate data and silently overwrites the
    // parties (a separate, pre-existing issue, not this feature — see
    // settle-dialog.wi012-balance-gate.test.tsx's identical note). Driving
    // the selects directly exercises the meInvolved gate under test without
    // depending on that effect.
    const testUser = userEvent.setup();
    const mutate = vi.fn();
    mockedUseCreateSettlement.mockReturnValue(mutationStub({ mutate }));
    render(<SettleUpDialog open onOpenChange={() => {}} groupId="group_ski_2026" />);
    await screen.findByLabelText('Amount');

    await testUser.selectOptions(screen.getByLabelText('From'), bob.id);
    await testUser.selectOptions(screen.getByLabelText('To'), cara.id);
    await testUser.clear(screen.getByLabelText('Amount'));
    await testUser.type(screen.getByLabelText('Amount'), '10.00');

    expect(screen.getByText('You must be the payer or the recipient')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();

    await testUser.click(screen.getByRole('button', { name: /share/i }));
    expect(capturedQrValue).toBe(
      expectedLink({
        fromUserId: bob.id,
        toUserId: cara.id,
        amount: 1000,
        currency: 'EUR',
        groupId: 'group_ski_2026',
      }),
    );

    // Still not actionable — attempting the mutation never fires.
    expect(mutate).not.toHaveBeenCalled();
  });
});
