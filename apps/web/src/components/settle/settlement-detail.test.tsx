import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import {
  formatMoney,
  type GroupDto,
  type PublicUserDto,
  type SettlementDto,
} from '@divzy/shared';
import { useAuth } from '@/lib/auth-store';
import { useDeleteSettlement, useGroup, useRestoreSettlement, useSettlement } from '@/lib/hooks';
import { SettlementDetailDialog } from './settlement-detail';

vi.mock('@/lib/auth-store', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/lib/hooks', () => ({
  errorMessage: (error: unknown) => String(error),
  useSettlement: vi.fn(),
  useGroup: vi.fn(),
  useDeleteSettlement: vi.fn(),
  useRestoreSettlement: vi.fn(),
}));

const mePublic: PublicUserDto = { id: 'me', name: 'Me', avatarColor: '#111111' };
const ana: PublicUserDto = { id: 'ana', name: 'Ana', avatarColor: '#222222' };
const sam: PublicUserDto = { id: 'sam', name: 'Sam', avatarColor: '#333333' };
const priya: PublicUserDto = { id: 'priya', name: 'Priya', avatarColor: '#444444' };
const jordan: PublicUserDto = { id: 'jordan', name: 'Jordan', avatarColor: '#555555' };

function money(minor: number, currency: string): string {
  return formatMoney(minor, currency).replace(/\s+/g, ' ');
}

/**
 * `screen.getByText('X')` only concatenates an element's own direct text-node
 * children (RTL's default `getNodeText`) — it does not span nested elements
 * (e.g. `<span>Ana</span> paid <span>Sam</span>`). This is the standard
 * function-matcher recipe for text split across multiple elements.
 */
function getByCombinedText(text: string) {
  return screen.getByText((_content, element) => {
    if (!element) return false;
    const normalize = (value: string | null) => value?.replace(/\s+/g, ' ').trim() ?? '';
    const hasExactText = normalize(element.textContent) === text;
    const childrenHaveText = Array.from(element.children).some(
      (child) => normalize(child.textContent) === text,
    );
    return hasExactText && !childrenHaveText;
  });
}

function makeSettlement(overrides: Partial<SettlementDto> = {}): SettlementDto {
  return {
    id: 'settle-1',
    groupId: null,
    group: null,
    from: ana,
    to: sam,
    amount: 1500,
    currency: 'PKR',
    method: 'BANK_TRANSFER',
    note: null,
    proofUrl: null,
    date: '2026-07-10T00:00:00.000Z',
    createdBy: sam,
    deletedAt: null,
    createdAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

function makeGroup(overrides: Partial<GroupDto> = {}): GroupDto {
  return {
    id: 'group-1',
    name: 'Goa Trip',
    emoji: '🌴',
    type: 'TRIP',
    currency: 'PKR',
    inviteCode: 'ABC123',
    simplifyDebts: true,
    createdBy: ana,
    members: [
      { user: ana, role: 'MEMBER', joinedAt: '2026-01-01T00:00:00.000Z' },
      { user: sam, role: 'MEMBER', joinedAt: '2026-01-01T00:00:00.000Z' },
    ],
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as GroupDto;
}

function mockQueries({
  settlement,
  settlementOverrides = {},
  group,
  me = mePublic,
  isLoading = false,
  isError = false,
  error = null,
  deleteMutate = vi.fn(),
  deletePending = false,
  restoreMutate = vi.fn(),
  restorePending = false,
}: {
  settlement?: SettlementDto | null;
  settlementOverrides?: Partial<SettlementDto>;
  group?: GroupDto | null;
  me?: PublicUserDto | null;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  deleteMutate?: Mock;
  deletePending?: boolean;
  restoreMutate?: Mock;
  restorePending?: boolean;
} = {}) {
  const resolvedSettlement =
    settlement === undefined ? makeSettlement(settlementOverrides) : settlement;

  (useAuth as unknown as Mock).mockReturnValue({
    user: me
      ? {
          ...me,
          email: `${me.id}@example.com`,
          defaultCurrency: 'PKR',
          emailNotifications: false,
          createdAt: '2026-01-01T00:00:00.000Z',
        }
      : null,
    status: me ? 'authed' : 'guest',
  });

  const refetch = vi.fn();
  (useSettlement as unknown as Mock).mockReturnValue({
    data: resolvedSettlement ?? undefined,
    isLoading,
    isError,
    error,
    refetch,
  });

  (useGroup as unknown as Mock).mockReturnValue({
    data: group ?? undefined,
    isLoading: false,
    isError: false,
    error: null,
  });

  (useDeleteSettlement as unknown as Mock).mockReturnValue({
    mutate: deleteMutate,
    isPending: deletePending,
  });

  (useRestoreSettlement as unknown as Mock).mockReturnValue({
    mutate: restoreMutate,
    isPending: restorePending,
  });

  return { refetch, deleteMutate, restoreMutate };
}

function renderDialog(onOpenChange: (open: boolean) => void = () => {}) {
  return render(
    <SettlementDetailDialog settlementId="settle-1" open onOpenChange={onOpenChange} />,
  );
}

describe('SettlementDetailDialog — required data points (story-WI-039b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scenario: renders amount, who-paid-whom, date, method, group, note, and proof', () => {
    mockQueries({
      settlement: makeSettlement({
        groupId: 'group-1',
        group: { id: 'group-1', name: 'Goa Trip', emoji: '🌴' },
        note: 'For the hotel',
        proofUrl: '/uploads/receipts/proof.png',
      }),
      group: makeGroup(),
    });
    renderDialog();

    expect(screen.getByText(money(1500, 'PKR'))).toBeInTheDocument();
    expect(getByCombinedText('Ana paid Sam')).toBeInTheDocument();
    expect(screen.getByText(/July 10, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Bank transfer/)).toBeInTheDocument();
    expect(screen.getByText(/🌴\s*Goa Trip/)).toBeInTheDocument();
    expect(screen.getByText('For the hotel')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View proof/ })).toBeInTheDocument();
  });

  it('scenario: proof URL ending in .pdf renders a labeled PDF link instead of an image', () => {
    mockQueries({
      settlement: makeSettlement({ proofUrl: '/uploads/receipts/proof.pdf' }),
    });
    renderDialog();

    expect(screen.getByRole('link', { name: /View proof \(PDF\)/ })).toBeInTheDocument();
    expect(screen.queryByAltText('Payment proof')).not.toBeInTheDocument();
  });

  it('scenario: direct (non-group) settlement omits the group section cleanly', () => {
    mockQueries({ settlement: makeSettlement({ groupId: null, group: null }) });
    renderDialog();

    expect(screen.queryByText(/Goa Trip/)).not.toBeInTheDocument();
  });

  it('scenario: "You" substitution for the current viewer as payer/recipient', () => {
    mockQueries({
      settlement: makeSettlement({ from: mePublic, to: sam }),
      me: mePublic,
    });
    renderDialog();

    expect(getByCombinedText('You paid Sam')).toBeInTheDocument();
  });
});

describe('SettlementDetailDialog — Delete affordance gating (spec-WI-054b §4.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scenario: group settlement — active admin who is not a party sees Delete', () => {
    mockQueries({
      settlement: makeSettlement({
        groupId: 'group-1',
        group: { id: 'group-1', name: 'Goa Trip', emoji: '🌴' },
        from: ana,
        to: sam,
        createdBy: ana,
      }),
      group: makeGroup({
        members: [
          { user: ana, role: 'MEMBER', joinedAt: '2026-01-01T00:00:00.000Z' },
          { user: sam, role: 'MEMBER', joinedAt: '2026-01-01T00:00:00.000Z' },
          { user: priya, role: 'ADMIN', joinedAt: '2026-01-01T00:00:00.000Z' },
        ],
      }),
      me: priya,
    });
    renderDialog();

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('scenario: group settlement — existing party (payer) still sees Delete, admin or not', () => {
    mockQueries({
      settlement: makeSettlement({
        groupId: 'group-1',
        group: { id: 'group-1', name: 'Goa Trip', emoji: '🌴' },
        from: ana,
        to: sam,
        createdBy: sam,
      }),
      group: makeGroup(),
      me: ana,
    });
    renderDialog();

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('scenario: group settlement — non-admin, non-party member sees no Delete action', () => {
    mockQueries({
      settlement: makeSettlement({
        groupId: 'group-1',
        group: { id: 'group-1', name: 'Goa Trip', emoji: '🌴' },
        from: ana,
        to: sam,
        createdBy: ana,
      }),
      group: makeGroup({
        members: [
          { user: ana, role: 'MEMBER', joinedAt: '2026-01-01T00:00:00.000Z' },
          { user: sam, role: 'MEMBER', joinedAt: '2026-01-01T00:00:00.000Z' },
          { user: jordan, role: 'MEMBER', joinedAt: '2026-01-01T00:00:00.000Z' },
        ],
      }),
      me: jordan,
    });
    renderDialog();

    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('scenario: direct settlement — an existing party sees Delete', () => {
    mockQueries({
      settlement: makeSettlement({ groupId: null, group: null, from: ana, to: sam, createdBy: sam }),
      me: ana,
    });
    renderDialog();

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('scenario: an active settlement never offers Restore, even to a party', () => {
    mockQueries({
      settlement: makeSettlement({ from: ana, to: sam }),
      me: ana,
    });
    renderDialog();

    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('scenario: a deleted settlement never offers Delete, even to a party', () => {
    mockQueries({
      settlement: makeSettlement({
        from: ana,
        to: sam,
        deletedAt: '2026-07-15T00:00:00.000Z',
      }),
      me: ana,
    });
    renderDialog();

    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('never renders the word "Revert" or "Reverted" anywhere in the dialog', () => {
    mockQueries({
      settlement: makeSettlement({
        from: ana,
        to: sam,
        deletedAt: '2026-07-15T00:00:00.000Z',
      }),
      me: ana,
    });
    renderDialog();

    expect(document.body.textContent).not.toMatch(/Revert/i);
  });
});

describe('SettlementDetailDialog — confirmation step before delete (spec-WI-054b §4.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scenario: clicking Delete does not call the mutation until confirmed', async () => {
    const user = userEvent.setup();
    const { deleteMutate } = mockQueries({
      settlement: makeSettlement({ from: ana, to: sam, createdBy: sam }),
      me: ana,
    });
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleteMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/Delete this settlement\?/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Delete settlement/ }));
    expect(deleteMutate).toHaveBeenCalledWith(
      { settlementId: 'settle-1', groupId: null },
      expect.anything(),
    );
  });

  it('scenario: delete success shows the "deleted" success toast copy', async () => {
    const user = userEvent.setup();
    const successSpy = vi.spyOn(toast, 'success').mockImplementation(() => 'toast-id');
    const { deleteMutate } = mockQueries({
      settlement: makeSettlement({ from: ana, to: sam, createdBy: sam }),
      me: ana,
    });
    deleteMutate.mockImplementation((_vars, options) => {
      options?.onSuccess?.();
    });
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: /Delete settlement/ }));

    expect(successSpy).toHaveBeenCalledWith('Settlement deleted — balances updated');
    successSpy.mockRestore();
  });
});

describe('SettlementDetailDialog — Restore affordance (spec-WI-054b §4.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scenario: deleted settlement, authorized party — shows Restore, shows "Deleted" badge, never Delete', () => {
    mockQueries({
      settlement: makeSettlement({
        from: ana,
        to: sam,
        deletedAt: '2026-07-15T00:00:00.000Z',
      }),
      me: ana,
    });
    renderDialog();

    expect(screen.getByText('Deleted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('scenario: deleted settlement, active group admin (non-party) — shows Restore', () => {
    mockQueries({
      settlement: makeSettlement({
        groupId: 'group-1',
        group: { id: 'group-1', name: 'Goa Trip', emoji: '🌴' },
        from: ana,
        to: sam,
        createdBy: ana,
        deletedAt: '2026-07-15T00:00:00.000Z',
      }),
      group: makeGroup({
        members: [
          { user: ana, role: 'MEMBER', joinedAt: '2026-01-01T00:00:00.000Z' },
          { user: sam, role: 'MEMBER', joinedAt: '2026-01-01T00:00:00.000Z' },
          { user: priya, role: 'ADMIN', joinedAt: '2026-01-01T00:00:00.000Z' },
        ],
      }),
      me: priya,
    });
    renderDialog();

    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });

  it('scenario: deleted settlement, unauthorized-but-visible viewer (non-admin, non-party group member) — shows "Deleted" badge but neither action', () => {
    mockQueries({
      settlement: makeSettlement({
        groupId: 'group-1',
        group: { id: 'group-1', name: 'Goa Trip', emoji: '🌴' },
        from: ana,
        to: sam,
        createdBy: ana,
        deletedAt: '2026-07-15T00:00:00.000Z',
      }),
      group: makeGroup({
        members: [
          { user: ana, role: 'MEMBER', joinedAt: '2026-01-01T00:00:00.000Z' },
          { user: sam, role: 'MEMBER', joinedAt: '2026-01-01T00:00:00.000Z' },
          { user: jordan, role: 'MEMBER', joinedAt: '2026-01-01T00:00:00.000Z' },
        ],
      }),
      me: jordan,
    });
    renderDialog();

    expect(screen.getByText('Deleted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('scenario: clicking Restore calls the mutation immediately — no confirmation dialog', async () => {
    const user = userEvent.setup();
    const { restoreMutate } = mockQueries({
      settlement: makeSettlement({
        from: ana,
        to: sam,
        deletedAt: '2026-07-15T00:00:00.000Z',
      }),
      me: ana,
    });
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Restore' }));

    expect(restoreMutate).toHaveBeenCalledWith(
      { settlementId: 'settle-1', groupId: null },
      expect.anything(),
    );
    expect(screen.queryByText(/Delete this settlement\?/)).not.toBeInTheDocument();
  });

  it('scenario: restore success shows the "restored" toast and does not close/navigate the dialog', async () => {
    const user = userEvent.setup();
    const successSpy = vi.spyOn(toast, 'success').mockImplementation(() => 'toast-id');
    const onOpenChange = vi.fn();
    const { restoreMutate } = mockQueries({
      settlement: makeSettlement({
        from: ana,
        to: sam,
        deletedAt: '2026-07-15T00:00:00.000Z',
      }),
      me: ana,
    });
    restoreMutate.mockImplementation((_vars, options) => {
      options?.onSuccess?.();
    });
    renderDialog(onOpenChange);

    await user.click(screen.getByRole('button', { name: 'Restore' }));

    expect(successSpy).toHaveBeenCalledWith('Settlement restored — balances updated');
    expect(onOpenChange).not.toHaveBeenCalled();
    successSpy.mockRestore();
  });
});

describe('SettlementDetailDialog — already-deleted state (DRB condition 2, client side)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scenario: deletedAt populated — loads successfully (200), shows a "Deleted" indicator, no error state', () => {
    mockQueries({
      settlement: makeSettlement({
        deletedAt: '2026-07-15T00:00:00.000Z',
        from: ana,
        to: sam,
      }),
      isLoading: false,
      isError: false,
    });
    renderDialog();

    expect(screen.getByText('Deleted')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Try again/)).not.toBeInTheDocument();
    // Data still renders — the deleted state is not an error/blank state.
    expect(screen.getByText(money(1500, 'PKR'))).toBeInTheDocument();
  });
});

describe('SettlementDetailDialog — loading and error states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scenario: loading renders a skeleton, no data', () => {
    mockQueries({ settlement: null, isLoading: true });
    renderDialog();

    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText('Ana paid Sam')).not.toBeInTheDocument();
  });

  it('scenario: genuine error renders a bounded "Try again" retry, not an infinite loop', async () => {
    const user = userEvent.setup();
    const { refetch } = mockQueries({
      settlement: null,
      isLoading: false,
      isError: true,
      error: new Error('Network error'),
    });
    renderDialog();

    expect(screen.getByText(/Network error/)).toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: /Try again/ });
    await user.click(retryButton);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
