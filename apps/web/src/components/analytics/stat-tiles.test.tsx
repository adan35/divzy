// Build-stage TDD coverage for `stat-tiles.tsx` — previously untested despite
// `SpendDelta` containing real business logic (sign/color rules per
// STYLE.md: spending LESS vs. the previous period is `pos` green with a down
// arrow; spending MORE is neutral secondary ink, never red — "spending more
// isn't an error"). No implementation change was needed here for WI-068 (the
// component already consumes only token utility classes), so this suite is a
// pure lock-in of existing, previously-uncovered logic — it was green from
// creation (no red-first step for these cases), which is expected per the
// build summary's exclusions note.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SpendDelta, StatTile } from './stat-tiles';

describe('StatTile', () => {
  it('renders the label, value and sub line', () => {
    render(<StatTile label="Your spend" value="$40.00" sub="vs last period" />);
    expect(screen.getByText('Your spend')).toBeInTheDocument();
    expect(screen.getByText('$40.00')).toBeInTheDocument();
    expect(screen.getByText('vs last period')).toBeInTheDocument();
  });

  it('omits the sub line entirely when not provided', () => {
    const { container } = render(<StatTile label="Your spend" value="$40.00" />);
    // Only label + value paragraphs — no third <p>.
    expect(container.querySelectorAll('p')).toHaveLength(2);
  });
});

describe('SpendDelta', () => {
  it('spending less than the previous period: pos-green with a down arrow and the percent drop', () => {
    render(<SpendDelta current={80} previous={100} />);
    const el = screen.getByText(/20% vs last period/);
    expect(el.className).toContain('text-pos');
  });

  it('spending more than the previous period: neutral ink-2, never red — "spending more isn\'t an error"', () => {
    render(<SpendDelta current={150} previous={100} />);
    const el = screen.getByText('+50% vs last period');
    expect(el.className).toContain('text-ink-2');
    expect(el.className).not.toContain('text-neg');
    expect(el.className).not.toContain('text-danger');
  });

  it('exactly the same as the previous period', () => {
    render(<SpendDelta current={100} previous={100} />);
    expect(screen.getByText('same as last period')).toBeInTheDocument();
  });

  it('no spend in the previous period but spend in the current one', () => {
    render(<SpendDelta current={50} previous={0} />);
    expect(screen.getByText('no spend in the previous period')).toBeInTheDocument();
  });

  it('nothing in either period', () => {
    render(<SpendDelta current={0} previous={0} />);
    expect(screen.getByText('nothing in either period')).toBeInTheDocument();
  });

  it('a negative previous value is treated the same as zero (defensive)', () => {
    render(<SpendDelta current={50} previous={-10} />);
    expect(screen.getByText('no spend in the previous period')).toBeInTheDocument();
  });
});
