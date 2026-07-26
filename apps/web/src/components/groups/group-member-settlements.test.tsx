import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupBalancesDto, UserDto } from '@divzy/shared';
import { GroupMemberSettlements } from './group-member-settlements';

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
const cara = user('u4', 'Cara');

function fixtureData(overrides: Partial<GroupBalancesDto> = {}): GroupBalancesDto {
  return {
    groupId: 'g1',
    viewerCurrency: 'GBP',
    usedFallbackRates: false,
    members: [me, ana, bob, cara].map((u) => ({ user: u, balances: [] })),
    pairwise: [],
    suggestions: [],
    ...overrides,
  };
}

describe('GroupMemberSettlements — WI-084 caller-relative panel', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders empty state when every other member is settled with the caller', () => {
    const onSettleUp = vi.fn();
    render(
      <GroupMemberSettlements
        groupId="g1"
        data={fixtureData()}
        meId={me.id}
        onSettleUp={onSettleUp}
      />,
    );

    expect(screen.getByText('All settled up in this group')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows "owes you" when the member owes the caller', () => {
    const onSettleUp = vi.fn();
    render(
      <GroupMemberSettlements
        groupId="g1"
        data={fixtureData({
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
        })}
        meId={me.id}
        onSettleUp={onSettleUp}
      />,
    );

    expect(screen.getByText(/Ana owes you/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ana owes you/i })).toBeInTheDocument();
  });

  it('shows "you owe" when the caller owes the member', () => {
    render(
      <GroupMemberSettlements
        groupId="g1"
        data={fixtureData({
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
        })}
        meId={me.id}
        onSettleUp={vi.fn()}
      />,
    );

    expect(screen.getByText(/You owe Bob/i)).toBeInTheDocument();
  });

  it('shows settled members explicitly without a button', () => {
    render(
      <GroupMemberSettlements
        groupId="g1"
        data={fixtureData({
          members: [me, ana, bob].map((u) => ({ user: u, balances: [] })),
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
        })}
        meId={me.id}
        onSettleUp={vi.fn()}
      />,
    );

    expect(screen.getByText('Settled up')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('clicking a line emits the correct group-scoped prefill', async () => {
    const onSettleUp = vi.fn();
    render(
      <GroupMemberSettlements
        groupId="g1"
        data={fixtureData({
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
        })}
        meId={me.id}
        onSettleUp={onSettleUp}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Ana owes you/i }));

    expect(onSettleUp).toHaveBeenCalledWith({
      fromUserId: ana.id,
      toUserId: me.id,
      amount: 50000,
      currency: 'PKR',
    });
  });

  it('handles converted + leftover multi-currency lines', () => {
    render(
      <GroupMemberSettlements
        groupId="g1"
        data={fixtureData({
          pairwise: [
            {
              fromUserId: ana.id,
              toUserId: me.id,
              currency: 'USD',
              amount: 1000,
              from: ana,
              to: me,
              convertedAmount: 790,
            },
            {
              fromUserId: ana.id,
              toUserId: me.id,
              currency: 'JPY',
              amount: 5000,
              from: ana,
              to: me,
            },
          ],
        })}
        meId={me.id}
        onSettleUp={vi.fn()}
      />,
    );

    expect(screen.getAllByText(/Ana owes you/i)).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /Ana owes you/i })).toHaveLength(2);
  });
});
