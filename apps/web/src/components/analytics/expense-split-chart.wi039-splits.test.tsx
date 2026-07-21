// Build-stage TDD coverage for spec-WI-039 — the expense split-breakdown
// chart (analytics' slice). Pure presentational, props-driven component: no
// hooks to mock, so this suite renders it directly and also unit-tests the
// exported largest-remainder percent helper on its own (the one piece of
// nontrivial business logic here).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { formatMoney, type ExpenseSplitDto, type PublicUserDto } from '@divzy/shared';
import { ExpenseSplitChart, largestRemainderPercents } from './expense-split-chart';

afterEach(() => {
  cleanup();
});

function user(overrides: Partial<PublicUserDto> = {}): PublicUserDto {
  return {
    id: 'u1',
    name: 'Alex Kim',
    avatarColor: '#123456',
    ...overrides,
  };
}

function split(overrides: Partial<ExpenseSplitDto> = {}): ExpenseSplitDto {
  return {
    user: user(),
    amount: 1000,
    shares: null,
    percentBps: null,
    adjustment: null,
    ...overrides,
  };
}

describe('largestRemainderPercents', () => {
  it('returns null for an empty list (defensive, nothing to divide)', () => {
    expect(largestRemainderPercents([])).toBeNull();
  });

  it('returns null when the total is zero or negative (defensive)', () => {
    expect(largestRemainderPercents([0, 0])).toBeNull();
    expect(largestRemainderPercents([-5, -5])).toBeNull();
  });

  it('single participant → one 100% segment', () => {
    expect(largestRemainderPercents([500])).toEqual([100]);
  });

  it('evenly-divisible amounts need no remainder redistribution', () => {
    expect(largestRemainderPercents([50, 30, 20])).toEqual([50, 30, 20]);
  });

  it('distributes leftover points to the largest remainders, ties broken by original order for equal amounts', () => {
    // 100/300 each → 33.33% → floor 33, leftover 1 point. All three
    // remainders (.33) and amounts (100) tie, so the first entry wins by
    // stable original-array-order tie-break.
    const result = largestRemainderPercents([100, 100, 100]);
    expect(result).toEqual([34, 33, 33]);
    expect(result?.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('breaks equal-remainder ties by larger split.amount first', () => {
    // 67/200=33.5%, 67/200=33.5%, 66/200=33%. base=[33,33,33], leftover=1.
    // Remainders tie between index 0 and 1 (both .5); both have equal
    // amount (67) too, so original order decides — index 0 wins.
    const result = largestRemainderPercents([67, 67, 66]);
    expect(result).toEqual([34, 33, 33]);
    expect(result?.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('a genuinely larger amount wins an equal-remainder tie over a smaller later amount', () => {
    // 150/1000=15%, 349/1000=34.9%, 501/1000=50.1% — no ties here, sanity
    // check that normal (non-tied) rounding just floors + assigns leftover
    // to the single largest remainder (index 1, .9).
    const result = largestRemainderPercents([150, 349, 501]);
    expect(result).toEqual([15, 35, 50]);
    expect(result?.reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('ExpenseSplitChart', () => {
  it('renders every split entry with its own native-currency amount (never recomputed)', () => {
    render(
      <ExpenseSplitChart
        currency="USD"
        totalAmount={3000}
        splits={[
          split({ user: user({ id: 'u1', name: 'Alex Kim' }), amount: 1000 }),
          split({ user: user({ id: 'u2', name: 'Sam Lee' }), amount: 2000 }),
        ]}
      />,
    );

    expect(screen.getByText('Alex Kim')).toBeInTheDocument();
    expect(screen.getByText('Sam Lee')).toBeInTheDocument();
    expect(screen.getByText(formatMoney(1000, 'USD'))).toBeInTheDocument();
    expect(screen.getByText(formatMoney(2000, 'USD'))).toBeInTheDocument();
  });

  it('percent labels sum to exactly 100%', () => {
    render(
      <ExpenseSplitChart
        currency="USD"
        totalAmount={300}
        splits={[
          split({ user: user({ id: 'u1' }), amount: 100 }),
          split({ user: user({ id: 'u2' }), amount: 100 }),
          split({ user: user({ id: 'u3' }), amount: 100 }),
        ]}
      />,
    );

    const percents = screen.getAllByText(/^\d+%$/).map((el) => Number(el.textContent?.replace('%', '')));
    expect(percents.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('labels the viewer "You" when viewerUserId matches a split participant', () => {
    render(
      <ExpenseSplitChart
        currency="USD"
        totalAmount={2000}
        viewerUserId="u1"
        splits={[
          split({ user: user({ id: 'u1', name: 'Alex Kim' }), amount: 1000 }),
          split({ user: user({ id: 'u2', name: 'Sam Lee' }), amount: 1000 }),
        ]}
      />,
    );

    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.queryByText('Alex Kim')).not.toBeInTheDocument();
    expect(screen.getByText('Sam Lee')).toBeInTheDocument();
  });

  it('payer-only viewer (not a split participant): no "You" highlight and no fabricated zero-amount segment', () => {
    render(
      <ExpenseSplitChart
        currency="USD"
        totalAmount={2000}
        viewerUserId="payer-not-in-splits"
        splits={[
          split({ user: user({ id: 'u1', name: 'Alex Kim' }), amount: 1000 }),
          split({ user: user({ id: 'u2', name: 'Sam Lee' }), amount: 1000 }),
        ]}
      />,
    );

    expect(screen.queryByText('You')).not.toBeInTheDocument();
    expect(screen.getByText('Alex Kim')).toBeInTheDocument();
    expect(screen.getByText('Sam Lee')).toBeInTheDocument();
    // Exactly the two real participants render — no third fabricated row.
    expect(screen.getAllByText(/^\d+%$/)).toHaveLength(2);
  });

  it('single-participant expense renders one 100% segment, not an empty/error state', () => {
    render(
      <ExpenseSplitChart
        currency="USD"
        totalAmount={1500}
        splits={[split({ user: user({ id: 'u1', name: 'Alex Kim' }), amount: 1500 })]}
      />,
    );

    expect(screen.getByText('Alex Kim')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('renders zero-decimal (JPY) and 3-decimal (KWD) currencies via formatMoney, no baked-in 2-decimal assumption', () => {
    const { rerender } = render(
      <ExpenseSplitChart
        currency="JPY"
        totalAmount={1500}
        splits={[split({ user: user({ id: 'u1' }), amount: 1500 })]}
      />,
    );
    // Intl.NumberFormat's fallback rendering for currencies without a symbol
    // in this environment (e.g. "KWD 1.500") separates the code/amount with
    // a non-breaking space — normalize before comparing so this assertion
    // isn't sensitive to that whitespace quirk.
    const normalize = (s: string) => s.replace(/\s+/g, ' ');
    expect(
      screen.getByText((_, node) => normalize(node?.textContent ?? '') === normalize(formatMoney(1500, 'JPY'))),
    ).toBeInTheDocument();

    rerender(
      <ExpenseSplitChart
        currency="KWD"
        totalAmount={1500}
        splits={[split({ user: user({ id: 'u1' }), amount: 1500 })]}
      />,
    );
    expect(
      screen.getByText((_, node) => normalize(node?.textContent ?? '') === normalize(formatMoney(1500, 'KWD'))),
    ).toBeInTheDocument();
  });

  it('renders nothing (no crash) when splits is empty — defensive, never reached per the AC-guaranteed contract', () => {
    const { container } = render(
      <ExpenseSplitChart currency="USD" totalAmount={0} splits={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('deleted-expense splits render normally — the component has no deletedAt awareness, it just renders whatever splits it is given', () => {
    render(
      <ExpenseSplitChart
        currency="USD"
        totalAmount={1000}
        splits={[split({ user: user({ id: 'u1', name: 'Alex Kim' }), amount: 1000 })]}
      />,
    );
    expect(screen.getByText('Alex Kim')).toBeInTheDocument();
    expect(screen.getByText(formatMoney(1000, 'USD'))).toBeInTheDocument();
  });
});
