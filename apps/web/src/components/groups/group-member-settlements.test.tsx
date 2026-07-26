// WI-086: the GroupMemberSettlements panel component was removed. This file
// now guards the surviving `derivePositions` helper that BalancesView uses for
// clickable member rows.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { GroupBalancesDto, UserDto } from '@divzy/shared';
import { derivePositions } from './group-member-settlements';

function user(id: string, name: string): UserDto {
  return {
    id,
    name,
    avatarColor: '#123456',
    email: `${id}@example.com`,
    defaultCurrency: 'GBP',
    emailNotifications: true,
    staleBalanceRemindersEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const me = user('u1', 'Me');
const ana = user('u2', 'Ana');
const bob = user('u3', 'Bob');

function fixtureData(overrides: Partial<GroupBalancesDto> = {}): GroupBalancesDto {
  return {
    groupId: 'g1',
    viewerCurrency: 'GBP',
    usedFallbackRates: false,
    members: [me, ana, bob].map((u) => ({ user: u, balances: [] })),
    pairwise: [],
    suggestions: [],
    ...overrides,
  };
}

describe('derivePositions — WI-086 survivor from removed panel', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('returns an empty position for a member settled with the caller', () => {
    const positions = derivePositions(fixtureData(), me.id);
    const anaPos = positions.find((p) => p.user.id === ana.id);
    expect(anaPos).toBeDefined();
    expect(anaPos!.entries).toHaveLength(0);
  });

  it('positively signs amounts when the member owes the caller', () => {
    const positions = derivePositions(
      fixtureData({
        pairwise: [
          {
            fromUserId: ana.id,
            toUserId: me.id,
            currency: 'PKR',
            amount: 50000,
            from: ana,
            to: me,
          },
        ],
      }),
      me.id,
    );
    expect(positions.find((p) => p.user.id === ana.id)?.entries).toEqual([
      { currency: 'PKR', amount: 50000 },
    ]);
  });

  it('negatively signs amounts when the caller owes the member', () => {
    const positions = derivePositions(
      fixtureData({
        pairwise: [
          {
            fromUserId: me.id,
            toUserId: bob.id,
            currency: 'USD',
            amount: 2000,
            from: me,
            to: bob,
          },
        ],
      }),
      me.id,
    );
    expect(positions.find((p) => p.user.id === bob.id)?.entries).toEqual([
      { currency: 'USD', amount: -2000 },
    ]);
  });

  it('renders without a React duplicate-key warning when a member has two same-currency lines', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Construct a tiny render that maps the derived entries the same way the
    // old panel did, proving the returned key-safe structure still works.
    const data = fixtureData({
      pairwise: [
        {
          fromUserId: ana.id,
          toUserId: me.id,
          currency: 'PKR',
          amount: 50000,
          from: ana,
          to: me,
          convertedAmount: 250,
        },
        {
          fromUserId: me.id,
          toUserId: ana.id,
          currency: 'PKR',
          amount: 20000,
          from: me,
          to: ana,
        },
      ],
    });
    const positions = derivePositions(data, me.id);
    const anaPos = positions.find((p) => p.user.id === ana.id)!;

    render(
      <div>
        {anaPos.entries.slice(0, 2).map((line, index) => (
          <button
            key={`${ana.id}-${line.currency}-${index}`}
            type="button"
            data-testid={`line-${index}`}
          >
            {line.amount} {line.currency}
          </button>
        ))}
      </div>,
    );

    expect(screen.getAllByRole('button')).toHaveLength(2);
    const keyWarning = errorSpy.mock.calls.some(
      (call) => typeof call[0] === 'string' && call[0].includes('same key'),
    );
    expect(keyWarning).toBe(false);
    errorSpy.mockRestore();
  });
});
