import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FriendDto } from '@divzy/shared';
import { FriendRow } from './friends-preview';

// story-WI-001's coverage-gap addendum (2026-07-14): "Friends list and friend detail
// collapse a multi-currency balance to one converted figure."

/**
 * WI-068 (AC-4a): the balance line now renders its money portion through
 * `<MoneyText>`, a nested `<span>` — RTL's default `getByText` won't match
 * text split across elements even when the parent's aggregated
 * `textContent` equals the target. Prefer the innermost matching element.
 */
function textMatcher(expected: string) {
  return (_: string, element: Element | null) => {
    if (element?.textContent !== expected) return false;
    const onlyChild = element.children.length === 1 ? element.children[0] : null;
    return onlyChild?.textContent !== expected;
  };
}

function fixtureFriend(overrides: Partial<FriendDto> = {}): FriendDto {
  return {
    user: { id: 'sam-1', name: 'Sam Lee', avatarColor: '#000' },
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    lastActivityAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('FriendRow (dashboard Friends preview)', () => {
  it('collapses a multi-currency balance to one converted figure: "You owe Sam £65.30"', () => {
    render(
      <FriendRow
        friend={fixtureFriend({ balancesConverted: { currency: 'GBP', amount: -6530 } })}
      />,
    );
    expect(screen.getByText(textMatcher('You owe Sam £65.30'))).toBeInTheDocument();
    expect(screen.queryByText(/\$50\.00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/€30\.00/)).not.toBeInTheDocument();
  });

  it('shows "Settled up" when there is nothing converted and no leftovers', () => {
    render(<FriendRow friend={fixtureFriend()} />);
    expect(screen.getByText('Settled up')).toBeInTheDocument();
  });

  it('shows the fallback-rates disclaimer only when usedFallbackRates is true', () => {
    render(
      <FriendRow
        friend={fixtureFriend({
          balancesConverted: { currency: 'GBP', amount: -6530 },
          usedFallbackRates: true,
        })}
      />,
    );
    expect(screen.getByText(/offline rates/i)).toBeInTheDocument();
  });
});
