// Build-stage TDD coverage for spec-WI-068 §8.2 as applied to
// `ExpenseSplitChart`: 2px gaps between stacked segments and an 8px rounded
// swatch (the existing amount rows, largest-remainder percents, "You"
// labeling etc. stay covered by expense-split-chart.wi039-splits.test.tsx —
// this file only locks in the new chrome).
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ExpenseSplitDto, PublicUserDto } from '@divzy/shared';
import { ExpenseSplitChart } from './expense-split-chart';

function user(overrides: Partial<PublicUserDto> = {}): PublicUserDto {
  return { id: 'u1', name: 'Alex Kim', avatarColor: '#123456', ...overrides };
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

describe('ExpenseSplitChart — WI-068 chrome', () => {
  it('the stacked bar has a 2px gap between segments (spec §8.2 "stacked segments get a 2px surface gap")', () => {
    render(
      <ExpenseSplitChart
        currency="USD"
        totalAmount={2000}
        splits={[
          split({ user: user({ id: 'u1' }), amount: 1000 }),
          split({ user: user({ id: 'u2', name: 'Sam Lee' }), amount: 1000 }),
        ]}
      />,
    );
    const bar = screen.getByRole('img', { name: 'Expense split breakdown' });
    expect(bar.className).toContain('gap-0.5');
  });

  it('per-participant swatches are 8px rounded (h-2 w-2), not the old 10px size', () => {
    const { container } = render(
      <ExpenseSplitChart
        currency="USD"
        totalAmount={1000}
        splits={[split({ user: user({ id: 'u1' }), amount: 1000 })]}
      />,
    );
    const swatch = container.querySelector('li span[aria-hidden="true"]') as HTMLElement;
    expect(swatch).not.toBeNull();
    const classes = swatch.className.split(/\s+/);
    expect(classes).toContain('h-2');
    expect(classes).toContain('w-2');
    expect(classes).not.toContain('h-2.5');
    expect(classes).not.toContain('w-2.5');
  });
});
