import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FriendDto } from '@divzy/shared';
import { FriendsBalanceSummary } from './friends-balance-summary';

// Tests written from story-WI-049's Gherkin ACs / spec-WI-049 §2, before
// `FriendsBalanceSummary` existed.

const user = (id: string, name: string) => ({ id, name, avatarColor: '#111111' });

function makeFriend(overrides: Partial<FriendDto> = {}): FriendDto {
  return {
    user: user('f1', 'Friend'),
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    lastActivityAt: null,
    ...overrides,
  };
}

describe('FriendsBalanceSummary', () => {
  it('renders nothing when friends is empty', () => {
    const { container } = render(<FriendsBalanceSummary friends={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the correct accumulated "You are owed" and "You owe" totals', () => {
    const friends: FriendDto[] = [
      makeFriend({ user: user('alex', 'Alex'), balancesConverted: { currency: 'USD', amount: 2000 } }),
      makeFriend({ user: user('bea', 'Bea'), balancesConverted: { currency: 'USD', amount: 500 } }),
      makeFriend({ user: user('chris', 'Chris'), balancesConverted: { currency: 'USD', amount: -1200 } }),
    ];

    render(<FriendsBalanceSummary friends={friends} />);

    expect(screen.getByText('$25.00')).toBeInTheDocument();
    expect(screen.getByText('$12.00')).toBeInTheDocument();
  });

  it('all friends settled up renders the celebratory settled treatment, not $0.00 or blank', () => {
    const friends: FriendDto[] = [makeFriend(), makeFriend()];

    render(<FriendsBalanceSummary friends={friends} />);

    expect(screen.getByText('All settled up')).toBeInTheDocument();
  });

  it('unresolved-currency friend triggers the "Not yet converted" disclosure and is excluded from totals', () => {
    const friends: FriendDto[] = [
      makeFriend({ user: user('alex', 'Alex'), balancesConverted: { currency: 'USD', amount: 2000 } }),
      makeFriend({
        user: user('unresolved', 'Unresolved'),
        balancesConverted: null,
        balances: [{ currency: 'XYZ', amount: -500 }],
      }),
    ];

    render(<FriendsBalanceSummary friends={friends} />);

    expect(screen.getByText('Not yet converted')).toBeInTheDocument();
    expect(screen.getByText('$20.00')).toBeInTheDocument();
  });

  it('renders the fallback-rates notice iff a contributing friend used a fallback rate', () => {
    const friends: FriendDto[] = [
      makeFriend({ balancesConverted: { currency: 'USD', amount: 100 }, usedFallbackRates: true }),
    ];

    render(<FriendsBalanceSummary friends={friends} />);

    expect(screen.getByText('Converted with offline rates')).toBeInTheDocument();
  });

  it('does not render the fallback-rates notice when no contributing friend used one', () => {
    const friends: FriendDto[] = [makeFriend({ balancesConverted: { currency: 'USD', amount: 100 } })];

    render(<FriendsBalanceSummary friends={friends} />);

    expect(screen.queryByText('Converted with offline rates')).not.toBeInTheDocument();
  });
});
