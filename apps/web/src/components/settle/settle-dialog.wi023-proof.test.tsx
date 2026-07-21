// Build-stage TDD coverage for spec-WI-023 (payment-proof attachment on a
// settlement) — the web attach-at-create flow in `SettleUpDialog`. Mirrors
// `settle-dialog.wi016-share.test.tsx`'s mocking approach exactly
// (useAuth/useGroup/useFriends/useCreateSettlement/useGroupBalances), plus
// a mocked `useUploadReceipt` (the same generic upload hook the expense
// editor's receipt control already uses — spec-WI-023 §6, ADR-020: no
// settlements-specific upload endpoint).
//
// `proofUrl` on `CreateSettlementInput` was landed by a concurrent backend
// build during this build session (see build-WI-023.md / build-WI-023-web.md).
// This file drives the dialog and asserts on the exact payload
// `createSettlement.mutate` is called with.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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

/** Upload mock whose `mutate` synchronously fires `onSuccess` with a fixed URL. */
function uploadStub(overrides: Partial<ReturnType<typeof useUploadReceipt>> = {}) {
  return {
    mutate: vi.fn((_file: File, opts?: { onSuccess?: (res: { url: string }) => void }) => {
      opts?.onSuccess?.({ url: '/uploads/receipts/proof-1.png' });
    }),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useUploadReceipt>;
}

function pngFile(name = 'proof.png'): File {
  return new File(['fake-bytes'], name, { type: 'image/png' });
}

describe('SettleUpDialog — WI-023 payment-proof attachment', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ user: me, status: 'authed' });
    mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup()));
    mockedUseFriends.mockReturnValue(friendsQuery([]));
    mockedUseCreateSettlement.mockReturnValue(mutationStub());
    mockedUseUploadReceipt.mockReturnValue(uploadStub());
    mockedUseGroupBalances.mockReturnValue(
      groupBalancesQuery(
        fixtureGroupBalances([
          { user: me, balances: [{ currency: 'EUR', amount: -5000 }] },
          { user: bob, balances: [{ currency: 'EUR', amount: 5000 }] },
        ]),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders an "Attach proof" control in the record-a-payment form', () => {
    render(<SettleUpDialog open onOpenChange={() => {}} groupId="group_ski_2026" />);

    expect(screen.getByRole('button', { name: /attach proof/i })).toBeInTheDocument();
  });

  it('uploads the picked file via the shared receipt-upload hook, then shows an attached state', async () => {
    const upload = uploadStub();
    mockedUseUploadReceipt.mockReturnValue(upload);
    const testUser = userEvent.setup();

    render(<SettleUpDialog open onOpenChange={() => {}} groupId="group_ski_2026" />);

    const input = screen.getByLabelText(/upload payment proof/i) as HTMLInputElement;
    const file = pngFile();
    await testUser.upload(input, file);

    expect(upload.mutate).toHaveBeenCalledWith(file, expect.objectContaining({
      onSuccess: expect.any(Function),
    }));
    // No settlements-specific upload endpoint — the exact same hook the
    // expense editor's receipt control uses is reused as-is (ADR-020).
    expect(useUploadReceipt).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByText(/proof attached/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /attach proof/i })).not.toBeInTheDocument();
  });

  it('includes the uploaded proofUrl in the settlement creation payload', async () => {
    const createSettlement = mutationStub();
    mockedUseCreateSettlement.mockReturnValue(createSettlement);
    const testUser = userEvent.setup();

    render(<SettleUpDialog open onOpenChange={() => {}} groupId="group_ski_2026" />);

    const input = screen.getByLabelText(/upload payment proof/i) as HTMLInputElement;
    await testUser.upload(input, pngFile());
    await waitFor(() => {
      expect(screen.getByText(/proof attached/i)).toBeInTheDocument();
    });

    await testUser.type(screen.getByLabelText('Amount'), '10');
    await testUser.click(screen.getByRole('button', { name: /record payment/i }));

    expect(createSettlement.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ proofUrl: '/uploads/receipts/proof-1.png' }),
      expect.anything(),
    );
  });

  it('creating with no attachment is unchanged — proofUrl is undefined in the payload', async () => {
    const createSettlement = mutationStub();
    mockedUseCreateSettlement.mockReturnValue(createSettlement);
    const testUser = userEvent.setup();

    render(<SettleUpDialog open onOpenChange={() => {}} groupId="group_ski_2026" />);

    await testUser.type(screen.getByLabelText('Amount'), '10');
    await testUser.click(screen.getByRole('button', { name: /record payment/i }));

    expect(createSettlement.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ proofUrl: undefined }),
      expect.anything(),
    );
  });

  it('removing an attached proof reverts to the "Attach proof" control', async () => {
    const testUser = userEvent.setup();

    render(<SettleUpDialog open onOpenChange={() => {}} groupId="group_ski_2026" />);

    const input = screen.getByLabelText(/upload payment proof/i) as HTMLInputElement;
    await testUser.upload(input, pngFile());
    await waitFor(() => {
      expect(screen.getByText(/proof attached/i)).toBeInTheDocument();
    });

    await testUser.click(screen.getByRole('button', { name: /remove proof/i }));

    expect(screen.getByRole('button', { name: /attach proof/i })).toBeInTheDocument();
    expect(screen.queryByText(/proof attached/i)).not.toBeInTheDocument();
  });
});
