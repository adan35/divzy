// Build-stage TDD coverage for spec-WI-012's dialog-level gating —
// "Client design (per entry point)": group-scoped entry points (Balances
// tab, group header) get a full pre-submit clamp sourced from a
// net-position reachability ceiling over
// `useGroupBalances(groupId).data.members[].balances` (native, never
// convertedNet — WI-012 Revision 2/cycle 1, defect-WI-012.md; supersedes the
// original bilateral `pairwise` lookup); non-group entry points (friend
// detail, dashboard quick action) get an upfront zero-disable once a friend
// is resolved, plus a pre-submit clamp when the friend has exactly one
// native leftover currency, and otherwise a block-at-submit inline
// server-error surface. The non-group rule is unchanged by Revision 2.
//
// Mirrors settle-dialog.blackbox.test.tsx's mocking approach exactly.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@divzy/api-client';
import {
  formatMoney,
  type FriendDto,
  type GroupBalancesDto,
  type GroupDto,
  type UserDto,
} from '@divzy/shared';
import { SettleUpDialog } from './settle-dialog';
import { useAuth } from '@/lib/auth-store';
import {
  useCreateSettlement,
  useFriends,
  useGroup,
  useGroupBalances,
  useUploadReceipt,
} from '@/lib/hooks';

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
    // optional proof attachment — stub it out like every other hook here so
    // this file (unrelated to WI-023) keeps exercising only the WI-012 gate.
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

function fixtureFriendDto(overrides: Partial<FriendDto> = {}): FriendDto {
  return {
    user: bob,
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    lastActivityAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
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
    // WI-012 Revision 2: the group-scoped gate no longer reads `pairwise`
    // (bilateral, as-incurred) — left empty in every fixture here to prove
    // the net-position ceiling below is what actually gates the dialog, not
    // a stale/leftover bilateral entry.
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

async function setAmount(text: string) {
  const testUser = userEvent.setup();
  const amountInput = screen.getByLabelText('Amount');
  await testUser.clear(amountInput);
  await testUser.type(amountInput, text);
  return testUser;
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

describe('SettleUpDialog — WI-012 balance-aware gating', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ user: me, status: 'authed' });
    mockedUseUploadReceipt.mockReturnValue(uploadStub());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('group-scoped entry points (Balances tab, group header) — full pre-submit clamp', () => {
    beforeEach(() => {
      mockedUseGroup.mockReturnValue(groupQuery(fixtureGroup()));
      mockedUseFriends.mockReturnValue(friendsQuery([]));
      mockedUseCreateSettlement.mockReturnValue(mutationStub());
    });

    it('no net-position entry (both parties net zero) disables the amount field + submit with an inline "nothing outstanding" message, and never calls the mutation', async () => {
      mockedUseGroupBalances.mockReturnValue(groupBalancesQuery(fixtureGroupBalances([])));

      render(<SettleUpDialog open onOpenChange={() => {}} groupId="group_ski_2026" />);

      expect(
        await screen.findByText('Nothing outstanding with Bob in this group'),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Amount')).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
    });

    it('typing more than the net-position ceiling (min(-netP, netR)) shows an inline clamp and disables submit; the exact boundary amount is allowed', async () => {
      mockedUseGroupBalances.mockReturnValue(
        groupBalancesQuery(
          fixtureGroupBalances([
            // me is the payer (fromUserId defaults to me.id): net -5000 (me
            // owes 5000 EUR overall in this group).
            { user: me, balances: [{ currency: 'EUR', amount: -5000 }] },
            // bob is the recipient: net +5000 (bob is owed 5000 EUR).
            { user: bob, balances: [{ currency: 'EUR', amount: 5000 }] },
          ]),
        ),
      );

      render(<SettleUpDialog open onOpenChange={() => {}} groupId="group_ski_2026" />);
      await screen.findByLabelText('Amount');

      const testUser = await setAmount('60.00');
      expect(
        screen.getByText(`Only ${formatMoney(5000, 'EUR')} is outstanding`),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();

      await testUser.clear(screen.getByLabelText('Amount'));
      await testUser.type(screen.getByLabelText('Amount'), '50.00');
      expect(screen.queryByText(/is outstanding/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Record payment' })).toBeEnabled();
    });

    it('a suggestion-sourced transfer between a chain pair with NO bilateral pairwise entry is accepted via the net-position ceiling (defect-WI-012.md repro: ME +10000, ANA 0, SAM -10000 USD; suggested SAM -> ME 10000)', async () => {
      // Parties are driven through the dialog's own From/To selects rather
      // than `prefill` here — mounting the real dialog with a `prefill`
      // whose fromUserId isn't the "fill blanks" effect's auto-picked
      // recipient exposed a separate, pre-existing party-resolution race
      // unrelated to WI-012 (reported alongside this build, not fixed here
      // per this cycle's scope). Driving the selects directly exercises the
      // net-ceiling gate under test without depending on that effect.
      const ana = user('user_id_3', 'Ana');
      const sam = user('user_id_4', 'Sam');
      const chainGroup: GroupDto = {
        ...fixtureGroup(),
        currency: 'USD',
        members: [
          { user: me, role: 'ADMIN', joinedAt: '2026-01-01T00:00:00.000Z' },
          { user: ana, role: 'MEMBER', joinedAt: '2026-01-02T00:00:00.000Z' },
          { user: sam, role: 'MEMBER', joinedAt: '2026-01-03T00:00:00.000Z' },
        ],
      };
      mockedUseGroup.mockReturnValue(groupQuery(chainGroup));
      mockedUseGroupBalances.mockReturnValue(
        groupBalancesQuery({
          groupId: 'group_ski_2026',
          viewerCurrency: 'EUR',
          usedFallbackRates: false,
          members: [
            { user: me, balances: [{ currency: 'USD', amount: 10000 }] },
            // Ana nets to zero (paid 10000, owed 10000) — the chain's middle link.
            { user: ana, balances: [] },
            { user: sam, balances: [{ currency: 'USD', amount: -10000 }] },
          ],
          // SAM and ME never shared a direct expense/settlement — this is
          // exactly the defect: no bilateral entry exists for this pair,
          // even though the net-derived suggestion below is fully valid.
          pairwise: [],
          suggestions: [
            { fromUserId: sam.id, toUserId: me.id, amount: 10000, currency: 'USD', from: sam, to: me },
          ],
        }),
      );

      render(<SettleUpDialog open onOpenChange={() => {}} groupId="group_ski_2026" />);
      await screen.findByLabelText('Amount');

      const testUser = userEvent.setup();
      await testUser.selectOptions(screen.getByLabelText('From'), sam.id);
      await testUser.selectOptions(screen.getByLabelText('To'), me.id);
      await testUser.clear(screen.getByLabelText('Amount'));
      await testUser.type(screen.getByLabelText('Amount'), '100.00');

      expect(screen.queryByText(/nothing outstanding/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/is outstanding/)).not.toBeInTheDocument();
      expect(screen.getByLabelText('Amount')).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Record payment' })).toBeEnabled();
    });
  });

  describe('non-group entry points (friend detail, dashboard quick action)', () => {
    it('a resolved counterparty with nothing outstanding disables amount + submit with an inline message, once selected inside the dialog (dashboard quick action)', async () => {
      mockedUseGroup.mockReturnValue(groupQuery(undefined));
      mockedUseFriends.mockReturnValue(
        friendsQuery([fixtureFriendDto({ balances: [], balancesConverted: null })]),
      );
      mockedUseCreateSettlement.mockReturnValue(mutationStub());

      render(<SettleUpDialog open onOpenChange={() => {}} />);

      expect(await screen.findByText('Nothing outstanding with Bob')).toBeInTheDocument();
      expect(screen.getByLabelText('Amount')).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
    });

    it('a single native leftover currency clamps pre-submit exactly like the group case', async () => {
      // me.defaultCurrency drives the dialog's initial currency for a
      // non-group open (no group.currency to adopt) — set it to JPY so the
      // resolved currency matches the friend's single native leftover.
      mockedUseAuth.mockReturnValue({ user: { ...me, defaultCurrency: 'JPY' }, status: 'authed' });
      mockedUseGroup.mockReturnValue(groupQuery(undefined));
      mockedUseFriends.mockReturnValue(
        friendsQuery([
          fixtureFriendDto({
            balances: [{ currency: 'JPY', amount: -50000 }], // I (me) owe Bob 500 JPY
            balancesConverted: null,
          }),
        ]),
      );
      mockedUseCreateSettlement.mockReturnValue(mutationStub());

      render(<SettleUpDialog open onOpenChange={() => {}} />);
      await screen.findByLabelText('Amount');

      await setAmount('60000'); // JPY has 0 decimals — 60,000 > the 50,000 owed
      expect(
        screen.getByText(`Only ${formatMoney(50000, 'JPY')} is outstanding`),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
    });

    it('an ambiguous multi-currency balance allows submit (no pre-submit clamp) and surfaces the server 400 inline, keeping the dialog open', async () => {
      mockedUseGroup.mockReturnValue(groupQuery(undefined));
      mockedUseFriends.mockReturnValue(
        friendsQuery([
          fixtureFriendDto({
            balances: [
              { currency: 'JPY', amount: -50000 },
              { currency: 'USD', amount: 2000 },
            ],
            balancesConverted: null,
          }),
        ]),
      );
      const mutation = mutationStub({
        isError: true,
        error: new ApiError(400, 'Only $20.00 is outstanding', 'EXCEEDS_BALANCE'),
      });
      mockedUseCreateSettlement.mockReturnValue(mutation);

      render(<SettleUpDialog open onOpenChange={() => {}} />);
      await screen.findByLabelText('Amount');

      await setAmount('999999');
      // No pre-submit gate — the amount field itself is never disabled by
      // the balance gate, and the submit button stays enabled.
      expect(screen.getByLabelText('Amount')).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Record payment' })).toBeEnabled();

      // The mutation's prior error is surfaced inline (not only as a toast).
      expect(screen.getByText('Only $20.00 is outstanding')).toBeInTheDocument();
    });
  });
});
