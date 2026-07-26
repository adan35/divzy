import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupBalancesDto, GroupSummaryDto, UserDto } from '@divzy/shared';
import { useAuth } from '@/lib/auth-store';
import { useGroups, useGroupBalancesMany } from '@/lib/hooks';
import {
  buildUnsettledLines,
  UnsettledPaymentsDialog,
} from './unsettled-payments-dialog';

const useAuthMock = vi.mocked(useAuth);
const useGroupsMock = vi.mocked(useGroups);
const useGroupBalancesManyMock = vi.mocked(useGroupBalancesMany);

vi.mock('@/lib/auth-store', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks')>();
  return {
    ...actual,
    useGroups: vi.fn(),
    useGroupBalancesMany: vi.fn(),
  };
});

function fixtureMe(overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: 'me',
    name: 'Me',
    avatarColor: '#000',
    email: 'me@example.com',
    defaultCurrency: 'USD',
    emailNotifications: true,
    staleBalanceRemindersEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fixtureGroup(overrides: Partial<GroupSummaryDto> = {}): GroupSummaryDto {
  return {
    id: 'group-1',
    name: 'Trip',
    emoji: '✈️',
    type: 'TRIP',
    currency: 'USD',
    memberCount: 3,
    yourBalances: [],
    yourBalancesNative: [{ currency: 'USD', amount: -2000 }],
    yourBalanceConverted: { currency: 'USD', amount: -2000 },
    usedFallbackRates: false,
    lastActivityAt: '2026-07-01T00:00:00.000Z',
    archivedAt: null,
    settled: false,
    ...overrides,
  };
}

function fixtureBalances(
  overrides: Partial<GroupBalancesDto> = {},
): GroupBalancesDto {
  return {
    groupId: 'group-1',
    viewerCurrency: 'USD',
    usedFallbackRates: false,
    members: [],
    pairwise: [],
    suggestions: [],
    ...overrides,
  };
}

function mockAuth(me?: UserDto) {
  useAuthMock.mockReturnValue({ user: me ?? fixtureMe(), status: 'authed' });
}

function mockGroups(groups: GroupSummaryDto[]) {
  useGroupsMock.mockReturnValue({
    data: groups,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useGroups>);
}

function mockBalances(
  results: Array<{ data?: GroupBalancesDto; isPending?: boolean; isError?: boolean; error?: Error } | null>,
) {
  useGroupBalancesManyMock.mockReturnValue(
    results.map((r) => ({
      data: r?.data,
      isPending: r?.isPending ?? false,
      isError: r?.isError ?? false,
      error: r?.error ?? null,
      refetch: vi.fn(),
    })) as unknown as ReturnType<typeof useGroupBalancesMany>,
  );
}

const onOpenChangeMock = vi.fn();
const onSettleUpMock = vi.fn();

function renderDialog(open = true) {
  return render(
    <UnsettledPaymentsDialog
      open={open}
      onOpenChange={onOpenChangeMock}
      onSettleUp={onSettleUpMock}
    />,
  );
}

describe('UnsettledPaymentsDialog (WI-088)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a skeleton while groups or balances are loading', () => {
    mockAuth();
    mockGroups([fixtureGroup()]);
    mockBalances([{ isPending: true }]);

    renderDialog();

    expect(screen.getByText(/unsettled payments/i)).toBeInTheDocument();
    expect(document.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('shows an error card with retry when a balance fetch fails', async () => {
    mockAuth();
    mockGroups([fixtureGroup()]);
    mockBalances([{ isError: true, error: new Error('Network error') }]);

    renderDialog();

    expect(screen.getByText(/network error/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('shows an empty state when the caller owes nothing', () => {
    mockAuth();
    mockGroups([
      fixtureGroup({
        yourBalances: [],
        yourBalancesNative: [],
        yourBalanceConverted: null,
      }),
    ]);
    mockBalances([{ data: fixtureBalances() }]);

    renderDialog();

    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /record payment/i })).not.toBeInTheDocument();
  });

  it('lists suggestion-derived rows when simplify is ON', () => {
    mockAuth();
    mockGroups([fixtureGroup({ id: 'g-trip', name: 'Trip' })]);
    mockBalances([
      {
        data: fixtureBalances({
          groupId: 'g-trip',
          suggestions: [
            {
              currency: 'USD',
              amount: 2500,
              fromUserId: 'me',
              toUserId: 'ana',
              from: { id: 'me', name: 'Me', avatarColor: '#000' },
              to: { id: 'ana', name: 'Ana', avatarColor: '#111' },
            },
          ],
          pairwise: [
            {
              currency: 'USD',
              amount: 3000,
              fromUserId: 'me',
              toUserId: 'ana',
              from: { id: 'me', name: 'Me', avatarColor: '#000' },
              to: { id: 'ana', name: 'Ana', avatarColor: '#111' },
            },
          ],
        }),
      },
    ]);

    renderDialog();

    const row = screen.getByRole('button', { name: /record payment to ana for trip/i });
    expect(row).toBeInTheDocument();
    expect(row.textContent).toContain('$25.00');
  });

  it('lists pairwise-derived rows when simplify is OFF', async () => {
    mockAuth();
    mockGroups([fixtureGroup({ id: 'g-trip', name: 'Trip' })]);
    mockBalances([
      {
        data: fixtureBalances({
          groupId: 'g-trip',
          suggestions: [
            {
              currency: 'USD',
              amount: 2500,
              fromUserId: 'me',
              toUserId: 'ana',
              from: { id: 'me', name: 'Me', avatarColor: '#000' },
              to: { id: 'ana', name: 'Ana', avatarColor: '#111' },
            },
          ],
          pairwise: [
            {
              currency: 'USD',
              amount: 3000,
              fromUserId: 'me',
              toUserId: 'ana',
              from: { id: 'me', name: 'Me', avatarColor: '#000' },
              to: { id: 'ana', name: 'Ana', avatarColor: '#111' },
            },
          ],
        }),
      },
    ]);

    renderDialog();

    const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: /simplify debts/i }));

    const row = screen.getByRole('button', { name: /record payment to ana for trip/i });
    expect(row).toBeInTheDocument();
    expect(row.textContent).toContain('$30.00');
  });

  it('excludes rows where the caller is the recipient', () => {
    mockAuth();
    mockGroups([fixtureGroup({ id: 'g-trip', name: 'Trip' })]);
    mockBalances([
      {
        data: fixtureBalances({
          groupId: 'g-trip',
          suggestions: [
            {
              currency: 'USD',
              amount: 2500,
              fromUserId: 'ana',
              toUserId: 'me',
              from: { id: 'ana', name: 'Ana', avatarColor: '#111' },
              to: { id: 'me', name: 'Me', avatarColor: '#000' },
            },
          ],
        }),
      },
    ]);

    renderDialog();

    expect(screen.queryByRole('button', { name: /record payment to ana for trip/i })).not.toBeInTheDocument();
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });

  it('clicking a line calls onSettleUp with groupId and prefill', async () => {
    mockAuth();
    mockGroups([fixtureGroup({ id: 'g-trip', name: 'Trip' })]);
    mockBalances([
      {
        data: fixtureBalances({
          groupId: 'g-trip',
          suggestions: [
            {
              currency: 'USD',
              amount: 2500,
              fromUserId: 'me',
              toUserId: 'ana',
              from: { id: 'me', name: 'Me', avatarColor: '#000' },
              to: { id: 'ana', name: 'Ana', avatarColor: '#111' },
            },
          ],
        }),
      },
    ]);

    renderDialog();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /record payment to ana for trip/i }));

    expect(onSettleUpMock).toHaveBeenCalledWith({
      groupId: 'g-trip',
      prefill: {
        fromUserId: 'me',
        toUserId: 'ana',
        amount: 2500,
        currency: 'USD',
      },
    });
  });
});

describe('buildUnsettledLines', () => {
  const me = fixtureMe();

  it('returns only caller-payer rows across multiple groups', () => {
    const groups: GroupSummaryDto[] = [
      fixtureGroup({ id: 'g1', name: 'Trip', emoji: '✈️' }),
      fixtureGroup({ id: 'g2', name: 'Home', emoji: '🏠' }),
    ];
    const balances: GroupBalancesDto[] = [
      fixtureBalances({
        groupId: 'g1',
        suggestions: [
          {
            currency: 'USD',
            amount: 1000,
            fromUserId: 'me',
            toUserId: 'ana',
            from: { id: 'me', name: 'Me', avatarColor: '#000' },
            to: { id: 'ana', name: 'Ana', avatarColor: '#111' },
          },
          {
            currency: 'USD',
            amount: 500,
            fromUserId: 'ana',
            toUserId: 'me',
            from: { id: 'ana', name: 'Ana', avatarColor: '#111' },
            to: { id: 'me', name: 'Me', avatarColor: '#000' },
          },
        ],
      }),
      fixtureBalances({
        groupId: 'g2',
        suggestions: [
          {
            currency: 'EUR',
            amount: 2000,
            fromUserId: 'me',
            toUserId: 'bob',
            from: { id: 'me', name: 'Me', avatarColor: '#000' },
            to: { id: 'bob', name: 'Bob', avatarColor: '#222' },
          },
        ],
      }),
    ];

    const lines = buildUnsettledLines(groups, balances, me, true);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      groupId: 'g1',
      counterparty: { id: 'ana' },
      amount: 1000,
      currency: 'USD',
    });
    expect(lines[1]).toMatchObject({
      groupId: 'g2',
      counterparty: { id: 'bob' },
      amount: 2000,
      currency: 'EUR',
    });
  });

  it('sorts primary currency first, then by |amount| descending', () => {
    const groups: GroupSummaryDto[] = [fixtureGroup({ id: 'g1', name: 'Trip' })];
    const balances: GroupBalancesDto[] = [
      fixtureBalances({
        groupId: 'g1',
        suggestions: [
          {
            currency: 'EUR',
            amount: 9000,
            fromUserId: 'me',
            toUserId: 'ana',
            from: { id: 'me', name: 'Me', avatarColor: '#000' },
            to: { id: 'ana', name: 'Ana', avatarColor: '#111' },
          },
          {
            currency: 'USD',
            amount: 1000,
            fromUserId: 'me',
            toUserId: 'bob',
            from: { id: 'me', name: 'Me', avatarColor: '#000' },
            to: { id: 'bob', name: 'Bob', avatarColor: '#222' },
          },
        ],
      }),
    ];

    const lines = buildUnsettledLines(groups, balances, me, true);

    expect(lines.map((l) => l.currency)).toEqual(['USD', 'EUR']);
  });

  it('drops zero-amount rows', () => {
    const groups: GroupSummaryDto[] = [fixtureGroup({ id: 'g1', name: 'Trip' })];
    const balances: GroupBalancesDto[] = [
      fixtureBalances({
        groupId: 'g1',
        suggestions: [
          {
            currency: 'USD',
            amount: 0,
            fromUserId: 'me',
            toUserId: 'ana',
            from: { id: 'me', name: 'Me', avatarColor: '#000' },
            to: { id: 'ana', name: 'Ana', avatarColor: '#111' },
          },
        ],
      }),
    ];

    const lines = buildUnsettledLines(groups, balances, me, true);

    expect(lines).toHaveLength(0);
  });

  it('switches from suggestions to pairwise when simplify is OFF', () => {
    const groups: GroupSummaryDto[] = [fixtureGroup({ id: 'g1', name: 'Trip' })];
    const balances: GroupBalancesDto[] = [
      fixtureBalances({
        groupId: 'g1',
        suggestions: [
          {
            currency: 'USD',
            amount: 1000,
            fromUserId: 'me',
            toUserId: 'ana',
            from: { id: 'me', name: 'Me', avatarColor: '#000' },
            to: { id: 'ana', name: 'Ana', avatarColor: '#111' },
          },
        ],
        pairwise: [
          {
            currency: 'USD',
            amount: 1500,
            fromUserId: 'me',
            toUserId: 'ana',
            from: { id: 'me', name: 'Me', avatarColor: '#000' },
            to: { id: 'ana', name: 'Ana', avatarColor: '#111' },
          },
        ],
      }),
    ];

    expect(buildUnsettledLines(groups, balances, me, true)[0].amount).toBe(1000);
    expect(buildUnsettledLines(groups, balances, me, false)[0].amount).toBe(1500);
  });
});
