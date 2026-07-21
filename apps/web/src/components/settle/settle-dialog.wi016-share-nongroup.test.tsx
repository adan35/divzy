// Test-stage independent black-box coverage — story-WI-016 Part B (settle-up
// link/QR), closing a coverage gap in Build's own test file
// (settle-dialog.wi016-share.test.tsx), which only exercises the group-scoped
// case (a `groupId` is present in every one of its fixtures). Derived
// directly from story-WI-016.md's Gherkin ("Generating a settle-up link from
// a pre-scoped Settle Up screen ... optionally groupId") and ADR-013's link
// shape (`groupId` is optional, appended only when present) — written before
// re-reading the non-group branch of `buildSettleLink` a second time, using
// this file's own fixtures/naming rather than Build's.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FriendDto, UserDto } from '@divzy/shared';
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
    return <svg data-testid="nongroup-share-qr" />;
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
    avatarColor: '#654321',
    email: `${id}@example.com`,
    defaultCurrency: 'USD',
    emailNotifications: true,
    staleBalanceRemindersEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const me = user('user_id_5', 'Priya');
const dev = user('user_id_6', 'Dev');

function fixtureFriend(u: UserDto): FriendDto {
  return {
    user: u,
    balances: [{ currency: 'USD', amount: -3000 }], // Priya owes Dev 30.00
    balancesNative: [{ currency: 'USD', amount: -3000 }],
    balancesConverted: null,
    usedFallbackRates: false,
    lastActivityAt: null,
  };
}

function friendsQuery(data: FriendDto[]) {
  return { data, isLoading: false, isError: false, error: null } as unknown as ReturnType<
    typeof useFriends
  >;
}

function mutationStub() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
  } as unknown as ReturnType<typeof useCreateSettlement>;
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

describe('SettleUpDialog — WI-016 Part B share link, non-group (friend) scope', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ user: me, status: 'authed' });
    mockedUseUploadReceipt.mockReturnValue(uploadStub());
    mockedUseGroup.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useGroup>);
    mockedUseFriends.mockReturnValue(friendsQuery([fixtureFriend(dev)]));
    mockedUseCreateSettlement.mockReturnValue(mutationStub());
    mockedUseGroupBalances.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useGroupBalances>);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    capturedQrValue = undefined;
  });

  it('a non-group (friend) settle-up link omits groupId entirely — never "groupId=undefined" or an empty param', async () => {
    const testUser = userEvent.setup();
    render(
      <SettleUpDialog
        open
        onOpenChange={() => {}}
        prefill={{ fromUserId: me.id, toUserId: dev.id, amount: 3000, currency: 'USD' }}
      />,
    );
    await screen.findByLabelText('Amount');

    await testUser.click(screen.getByRole('button', { name: /share/i }));

    expect(screen.getByTestId('nongroup-share-qr')).toBeInTheDocument();
    const link = capturedQrValue as string;
    expect(link).toBe(
      `${window.location.origin}/settle?fromUserId=${me.id}&toUserId=${dev.id}&amount=3000&currency=USD`,
    );
    expect(link).not.toContain('groupId');

    // The visible "Copy link"-adjacent readonly link input shows the exact
    // same string the QR encodes — single source of truth, no drift between
    // the two surfaces.
    expect(screen.getByLabelText('Settle-up link')).toHaveValue(link);
  });

  it('the generated link is always an in-app Divzy link — never a venmo://, paypal://, or any other external payment-app URI scheme', async () => {
    const testUser = userEvent.setup();
    render(
      <SettleUpDialog
        open
        onOpenChange={() => {}}
        prefill={{ fromUserId: me.id, toUserId: dev.id, amount: 3000, currency: 'USD' }}
      />,
    );
    await screen.findByLabelText('Amount');
    await testUser.click(screen.getByRole('button', { name: /share/i }));

    const link = capturedQrValue as string;
    // Asserts the scheme itself is exactly http/https (an in-app Divzy web
    // link), never any other URI scheme (venmo://, paypal://, or otherwise).
    const scheme = link.split('://')[0];
    expect(scheme).toBe('http');
    expect(link.startsWith(`${window.location.origin}/settle?`)).toBe(true);
    expect(link).not.toMatch(/venmo:\/\//i);
    expect(link).not.toMatch(/paypal:\/\//i);
  });
});
