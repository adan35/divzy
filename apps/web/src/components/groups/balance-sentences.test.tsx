import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BalanceSentences } from './balance-sentences';

// story-WI-001's Gherkin ACs, exercised end-to-end through the real
// formatMoney/rendering path (not just the pure collapsedBalanceEntries
// selection already covered in src/lib/balance-display.test.ts).

describe('BalanceSentences (Groups list card)', () => {
  it('collapses a multi-currency balance to one converted figure: "You owe £65.30"', () => {
    render(
      <BalanceSentences
        yourBalanceConverted={{ currency: 'GBP', amount: -6530 }}
        yourBalances={[]}
        usedFallbackRates={false}
      />,
    );
    expect(screen.getByText('You owe £65.30')).toBeInTheDocument();
    expect(screen.queryByText(/\$50\.00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/€30\.00/)).not.toBeInTheDocument();
  });

  it('shows "You\'re all settled up" when there is nothing converted and no leftovers', () => {
    render(
      <BalanceSentences yourBalanceConverted={null} yourBalances={[]} usedFallbackRates={false} />,
    );
    expect(screen.getByText(/all settled up/)).toBeInTheDocument();
  });

  it('degrades gracefully: an unconvertible currency renders as its own native line, nothing dropped', () => {
    render(
      <BalanceSentences
        yourBalanceConverted={null}
        yourBalances={[{ currency: 'XYZ', amount: -1000 }]}
        usedFallbackRates={false}
      />,
    );
    expect(screen.getByText(/XYZ|10\.00/)).toBeInTheDocument();
  });

  it('shows the fallback-rates disclaimer only when usedFallbackRates is true', () => {
    const { rerender } = render(
      <BalanceSentences
        yourBalanceConverted={{ currency: 'GBP', amount: -6530 }}
        yourBalances={[]}
        usedFallbackRates={true}
      />,
    );
    expect(screen.getByText(/offline rates/i)).toBeInTheDocument();

    rerender(
      <BalanceSentences
        yourBalanceConverted={{ currency: 'GBP', amount: -6530 }}
        yourBalances={[]}
        usedFallbackRates={false}
      />,
    );
    expect(screen.queryByText(/offline rates/i)).not.toBeInTheDocument();
  });
});
