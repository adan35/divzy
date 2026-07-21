// WI-068 S2 (Web money moments) — spec §6 sparkline spec: 6-month spend
// trend, honestly labeled "Your spend · last 6 months" (byMonth is a spend
// series, never a fabricated historical *balance* series). Point-math is
// extracted pure per the verify note (no Recharts/DOM needed to test it);
// the dataviz "Trend Over Time: <4 points -> stat only" floor is a fallback,
// not a crash.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { AnalyticsSummaryDto } from '@divzy/shared';
import {
  buildSparklinePoints,
  hasEnoughPointsForLine,
  sparklineDomain,
  PulseSparkline,
} from './pulse-sparkline';

type Bucket = AnalyticsSummaryDto['byMonth'][number];

function bucket(month: string, amount: number): Bucket {
  return { month, amount, totalActivity: amount };
}

const SIX_MONTHS: Bucket[] = [
  bucket('2026-02', 1000),
  bucket('2026-03', 2000),
  bucket('2026-04', 1500),
  bucket('2026-05', 3000),
  bucket('2026-06', 2500),
  bucket('2026-07', 4000),
];

describe('buildSparklinePoints (pure point-math)', () => {
  it('maps each valid "YYYY-MM" bucket to a short month label, preserving amount and order', () => {
    const points = buildSparklinePoints(SIX_MONTHS);
    expect(points).toHaveLength(6);
    expect(points[0]).toEqual({ month: '2026-02', label: 'Feb', amount: 1000 });
    expect(points[5]).toEqual({ month: '2026-07', label: 'Jul', amount: 4000 });
  });

  it('drops unparseable month strings rather than crashing', () => {
    const points = buildSparklinePoints([bucket('not-a-month', 500), bucket('2026-07', 4000)]);
    expect(points).toEqual([{ month: '2026-07', label: 'Jul', amount: 4000 }]);
  });

  it('returns an empty array for an empty series', () => {
    expect(buildSparklinePoints([])).toEqual([]);
  });
});

describe('hasEnoughPointsForLine (dataviz floor: <4 points -> stat only)', () => {
  it('is false below 4 points', () => {
    expect(hasEnoughPointsForLine(buildSparklinePoints(SIX_MONTHS.slice(0, 3)))).toBe(false);
    expect(hasEnoughPointsForLine([])).toBe(false);
  });

  it('is true at exactly 4 points and above', () => {
    expect(hasEnoughPointsForLine(buildSparklinePoints(SIX_MONTHS.slice(0, 4)))).toBe(true);
    expect(hasEnoughPointsForLine(buildSparklinePoints(SIX_MONTHS))).toBe(true);
  });
});

describe('sparklineDomain (y-axis headroom so the area never clips)', () => {
  it('adds ~15% headroom above the max and always floors at 0', () => {
    const points = buildSparklinePoints(SIX_MONTHS);
    expect(sparklineDomain(points)).toEqual([0, Math.ceil(4000 * 1.15)]);
  });

  it('returns a non-degenerate domain when every amount is zero', () => {
    const points = buildSparklinePoints([bucket('2026-06', 0), bucket('2026-07', 0)]);
    expect(sparklineDomain(points)).toEqual([0, 1]);
  });
});

describe('PulseSparkline component', () => {
  afterEach(() => cleanup());

  it('renders the honestly-labeled caption and an img-role chart region with 6 months of data', () => {
    render(<PulseSparkline byMonth={SIX_MONTHS} currency="USD" reducedMotion={false} />);
    expect(screen.getByText('Your spend · last 6 months')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Your spend · last 6 months' })).toBeInTheDocument();
  });

  it('falls back to a stat-only message (no chart) when fewer than 4 points are available', () => {
    render(
      <PulseSparkline
        byMonth={SIX_MONTHS.slice(0, 2)}
        currency="USD"
        reducedMotion={false}
      />,
    );
    expect(screen.queryByRole('img', { name: 'Your spend · last 6 months' })).not.toBeInTheDocument();
    expect(screen.getByText(/not enough history yet/i)).toBeInTheDocument();
  });

  it('renders without throwing under reduced motion (draw-in animation skipped)', () => {
    expect(() =>
      render(<PulseSparkline byMonth={SIX_MONTHS} currency="USD" reducedMotion />),
    ).not.toThrow();
  });
});
