import { describe, expect, it } from 'vitest';
import {
  pulseSparklineRange,
  shouldRenderSparkline,
  sparklineAreaPath,
  sparklineLinePath,
  sparklinePathLength,
  sparklinePoints,
} from './pulseSparkline';

// Written from spec-WI-068 §6 mobile ("react-native-svg Path + gradient
// Defs; points from a new pure pulseSparkline.ts helper — unit-testable
// math") + the dataviz "<4 points -> stat only" floor cited in spec §0 —
// BEFORE `pulseSparkline` existed.

describe('shouldRenderSparkline', () => {
  it('is false below the dataviz 4-point floor', () => {
    expect(shouldRenderSparkline([])).toBe(false);
    expect(shouldRenderSparkline([1, 2, 3])).toBe(false);
  });

  it('is true at and above 4 points', () => {
    expect(shouldRenderSparkline([1, 2, 3, 4])).toBe(true);
    expect(shouldRenderSparkline([0, 0, 0, 0, 0, 0])).toBe(true);
  });
});

describe('sparklinePoints', () => {
  it('returns no points for an empty series', () => {
    expect(sparklinePoints([], 100, 40)).toEqual([]);
  });

  it('centers a single point', () => {
    expect(sparklinePoints([500], 100, 40)).toEqual([{ x: 50, y: 20 }]);
  });

  it('spaces points evenly across the width, first at x=0 and last at x=width', () => {
    const points = sparklinePoints([0, 10, 20, 30, 40, 50], 100, 40);
    expect(points).toHaveLength(6);
    expect(points[0]!.x).toBe(0);
    expect(points[5]!.x).toBe(100);
    expect(points[2]!.x).toBeCloseTo(40, 5);
  });

  it('maps the minimum value to the bottom (y = height) and the maximum to the top (y = 0)', () => {
    const points = sparklinePoints([0, 10, 20, 30, 40, 50], 100, 40);
    expect(points[0]!.y).toBe(40); // amount 0 -> bottom
    expect(points[5]!.y).toBe(0); // amount 50 (max) -> top
  });

  it('a flat (all-equal, non-zero) series renders as a flat mid-line — never divides by zero', () => {
    const points = sparklinePoints([25, 25, 25, 25], 100, 40);
    for (const p of points) expect(p.y).toBe(20);
  });

  it('a flat all-zero series (no spend yet, still >= 4 buckets) also renders as a flat mid-line', () => {
    const points = sparklinePoints([0, 0, 0, 0], 100, 40);
    for (const p of points) expect(p.y).toBe(20);
  });
});

describe('sparklineLinePath', () => {
  it('is empty for no points', () => {
    expect(sparklineLinePath([])).toBe('');
  });

  it('builds an SVG path starting with M and continuing with L per point', () => {
    const path = sparklineLinePath([
      { x: 0, y: 40 },
      { x: 50, y: 20 },
      { x: 100, y: 0 },
    ]);
    expect(path).toBe('M 0 40 L 50 20 L 100 0');
  });
});

describe('sparklineAreaPath', () => {
  it('is empty for no points', () => {
    expect(sparklineAreaPath([], 40)).toBe('');
  });

  it('closes the line path down to the baseline under the last and first points, then Z', () => {
    const points = [
      { x: 0, y: 40 },
      { x: 100, y: 0 },
    ];
    expect(sparklineAreaPath(points, 40)).toBe('M 0 40 L 100 0 L 100 40 L 0 40 Z');
  });
});

describe('sparklinePathLength', () => {
  it('is 0 for fewer than 2 points', () => {
    expect(sparklinePathLength([])).toBe(0);
    expect(sparklinePathLength([{ x: 5, y: 5 }])).toBe(0);
  });

  it('sums the Euclidean distance between consecutive points (used to size the draw-in stroke-dash animation)', () => {
    // A 3-4-5 right triangle leg, then a 5-unit horizontal leg — exact integers.
    const length = sparklinePathLength([
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 8, y: 4 },
    ]);
    expect(length).toBe(10); // 5 + 5
  });
});

describe('pulseSparklineRange', () => {
  it('spans the UTC start of the month 5 calendar months back as `from`, and `now` as `to` (6 zero-filled monthly buckets, spec §6)', () => {
    const now = new Date('2026-07-19T12:34:56.000Z');
    expect(pulseSparklineRange(now)).toEqual({
      from: '2026-02-01T00:00:00.000Z',
      to: now.toISOString(),
    });
  });

  it('rolls back across a year boundary', () => {
    const now = new Date('2026-01-15T00:00:00.000Z');
    expect(pulseSparklineRange(now)).toEqual({
      from: '2025-08-01T00:00:00.000Z',
      to: now.toISOString(),
    });
  });

  it('defaults to the current time when no `now` is passed', () => {
    const before = Date.now();
    const { to } = pulseSparklineRange();
    const after = Date.now();
    const toMs = new Date(to).getTime();
    expect(toMs).toBeGreaterThanOrEqual(before);
    expect(toMs).toBeLessThanOrEqual(after);
  });
});
