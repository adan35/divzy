import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FriendBalanceBucket, FriendDto } from '@divzy/shared';
import { FriendBalanceBreakdown } from './friend-balance-breakdown';

vi.mock('next/link', () => ({
  default: function MockLink({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) {
    return <a {...props}>{children}</a>;
  },
}));

function fixtureFriend(overrides: Partial<FriendDto> = {}): FriendDto {
  return {
    user: { id: 'friend-1', name: 'Priya Owe', avatarColor: '#111' },
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    balancesByGroup: [],
    lastActivityAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function fixtureBucket(overrides: Partial<FriendBalanceBucket> = {}): FriendBalanceBucket {
  return {
    group: null,
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    ...overrides,
  };
}

describe('FriendBalanceBreakdown — WI-084 clickable bucket lines', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders each displayed amount line as a settle-up button with a nav link sibling', () => {
    render(
      <FriendBalanceBreakdown
        friend={fixtureFriend({
          balancesByGroup: [
            fixtureBucket({
              group: { id: 'g1', name: 'Alpha', emoji: 'A' },
              balancesNative: [{ currency: 'USD', amount: 1000 }],
              balancesConverted: { currency: 'USD', amount: 1000 },
            }),
          ],
        })}
      />,
    );

    expect(screen.getByRole('button', { name: /Settle up with Priya in Alpha/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Alpha, go to group/i })).toBeInTheDocument();
  });

  it('clicking a bucket line invokes onSettleUp with the displayed line and groupId', async () => {
    const onSettleUp = vi.fn();
    render(
      <FriendBalanceBreakdown
        friend={fixtureFriend({
          balancesByGroup: [
            fixtureBucket({
              group: { id: 'g1', name: 'Alpha', emoji: 'A' },
              balancesNative: [{ currency: 'USD', amount: 1000 }],
              balancesConverted: { currency: 'USD', amount: 1000 },
            }),
          ],
        })}
        onSettleUp={onSettleUp}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Settle up with Priya in Alpha/i }));

    expect(onSettleUp).toHaveBeenCalledTimes(1);
    expect(onSettleUp).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 'g1',
        line: { currency: 'USD', amount: 1000 },
      }),
    );
  });

  it('direct bucket omits groupId in the settle payload', async () => {
    const onSettleUp = vi.fn();
    render(
      <FriendBalanceBreakdown
        friend={fixtureFriend({
          balancesByGroup: [
            fixtureBucket({
              group: null,
              balancesNative: [{ currency: 'USD', amount: -1250 }],
              balancesConverted: { currency: 'USD', amount: -1250 },
            }),
          ],
        })}
        onSettleUp={onSettleUp}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Settle up with Priya \(outside groups\)/i }));

    expect(onSettleUp).toHaveBeenCalledWith(expect.objectContaining({ groupId: undefined }));
  });

  it('suppresses the direct-bucket nav link when showDirectBucketLink is false', () => {
    render(
      <FriendBalanceBreakdown
        friend={fixtureFriend({
          balancesByGroup: [
            fixtureBucket({
              group: null,
              balancesNative: [{ currency: 'USD', amount: -1250 }],
              balancesConverted: { currency: 'USD', amount: -1250 },
            }),
          ],
        })}
        showDirectBucketLink={false}
      />,
    );

    expect(screen.getByRole('button', { name: /Settle up with Priya/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /go to friend details/i })).not.toBeInTheDocument();
  });

  it('keeps the group-bucket nav link even when showDirectBucketLink is false', () => {
    render(
      <FriendBalanceBreakdown
        friend={fixtureFriend({
          balancesByGroup: [
            fixtureBucket({
              group: { id: 'g1', name: 'Alpha', emoji: 'A' },
              balancesNative: [{ currency: 'USD', amount: 1000 }],
              balancesConverted: { currency: 'USD', amount: 1000 },
            }),
          ],
        })}
        showDirectBucketLink={false}
      />,
    );

    expect(screen.getByRole('link', { name: /Alpha, go to group/i })).toBeInTheDocument();
  });

  it('multi-currency bucket exposes one clickable line per displayed entry', () => {
    const onSettleUp = vi.fn();
    render(
      <FriendBalanceBreakdown
        friend={fixtureFriend({
          balancesByGroup: [
            fixtureBucket({
              group: { id: 'g1', name: 'Alpha', emoji: 'A' },
              balances: [{ currency: 'JPY', amount: 5000 }],
              balancesNative: [
                { currency: 'USD', amount: 4500 },
                { currency: 'JPY', amount: 5000 },
              ],
              balancesConverted: { currency: 'USD', amount: 4500 },
            }),
          ],
        })}
        onSettleUp={onSettleUp}
      />,
    );

    expect(screen.getAllByRole('button', { name: /Settle up with Priya in Alpha/i })).toHaveLength(2);
  });
});
