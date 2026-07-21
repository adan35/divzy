// Build-stage TDD coverage for `breakdown-rows.tsx` — previously untested.
// Covers both the pre-existing `foldRows` business logic (STYLE.md: >8
// categories fold into "Other") and the WI-068 §8.1/§9.1 presentational
// changes (6px rounded bars — the "relief rule" of always-visible labels +
// values was already true and stays so; the value now renders through the
// shared MoneyText component per AC-4a).
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { formatMoney } from '@divzy/shared';
import { BreakdownRows, foldRows, type BreakdownRowDatum } from './breakdown-rows';
import { CHART_PALETTE_LIGHT, CHART_OTHER_COLOR } from './palette';

function row(overrides: Partial<BreakdownRowDatum> = {}): BreakdownRowDatum {
  return { key: 'food', label: 'Food & drink', emoji: '🍔', amount: 1000, ...overrides };
}

describe('foldRows', () => {
  it('returns rows unchanged when at or under the max', () => {
    const rows = [row({ key: 'a' }), row({ key: 'b' })];
    expect(foldRows(rows, 8)).toEqual(rows);
  });

  it('folds everything past max-1 into a single "Other" bucket, summing the rest', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ key: `c${i}`, amount: (i + 1) * 100 }));
    const folded = foldRows(rows, 8);
    expect(folded).toHaveLength(8);
    expect(folded[7]).toMatchObject({ key: '__other__', label: 'Other' });
    // Rows 8,9,10 (indices 7,8,9; amounts 800,900,1000) fold into Other.
    expect(folded[7]!.amount).toBe(800 + 900 + 1000);
  });

  it('respects a custom max', () => {
    const rows = [row({ key: 'a' }), row({ key: 'b' }), row({ key: 'c' })];
    const folded = foldRows(rows, 2);
    expect(folded).toHaveLength(2);
    expect(folded[1]).toMatchObject({ key: '__other__' });
  });
});

describe('BreakdownRows', () => {
  it('shows the empty message when there are no rows', () => {
    render(<BreakdownRows rows={[]} currency="USD" palette={CHART_PALETTE_LIGHT} />);
    expect(screen.getByText('Nothing in this range.')).toBeInTheDocument();
  });

  it('renders each row\'s label, emoji and money value — labels/values always visible (§8.1 relief rule)', () => {
    render(
      <BreakdownRows
        rows={[row({ key: 'food', label: 'Food & drink', amount: 2000 })]}
        currency="USD"
        palette={CHART_PALETTE_LIGHT}
      />,
    );
    expect(screen.getByText('Food & drink')).toBeInTheDocument();
    expect(screen.getByText(formatMoney(2000, 'USD'))).toBeInTheDocument();
  });

  it('renders the value through the shared MoneyText component (AC-4a), not a bare formatted string', () => {
    render(
      <BreakdownRows
        rows={[row({ key: 'food', amount: 4321 })]}
        currency="USD"
        palette={CHART_PALETTE_LIGHT}
      />,
    );
    const valueEl = screen.getByText(formatMoney(4321, 'USD'));
    expect(valueEl.tagName).toBe('SPAN');
    expect(valueEl.className).toContain('tabular-nums');
  });

  it('uses 6px-tall rounded bars (spec §9.1 "6px rounded bars"), not the old 8px height', () => {
    const { container } = render(
      <BreakdownRows rows={[row()]} currency="USD" palette={CHART_PALETTE_LIGHT} />,
    );
    const bar = container.querySelector('li span[aria-hidden="true"] > span') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.className).toContain('h-1.5');
    expect(bar.className).not.toContain('h-2 ');
    expect(bar.className.split(/\s+/)).not.toContain('h-2');
  });

  it('the "Other" bucket always renders in CHART_OTHER_COLOR regardless of its rank/index', () => {
    const rows: BreakdownRowDatum[] = [
      row({ key: 'a', amount: 500 }),
      { key: '__other__', label: 'Other', amount: 100 },
    ];
    const { container } = render(
      <BreakdownRows rows={rows} currency="USD" palette={CHART_PALETTE_LIGHT} />,
    );
    const bars = container.querySelectorAll('li span[aria-hidden="true"] > span');
    const otherBar = bars[1] as HTMLElement;
    expect(otherBar.style.backgroundColor).toBe(hexToRgb(CHART_OTHER_COLOR));
  });
});

/** jsdom normalizes inline `background-color` hex to `rgb(...)` — match its format. */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgb(${r}, ${g}, ${b})`;
}
