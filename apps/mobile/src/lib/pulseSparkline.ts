import { startOfMonth, subMonths } from 'date-fns';

/**
 * spec-WI-068 §6 mobile — pure math backing `PulseHero`'s hand-rolled
 * react-native-svg sparkline ("Your spend · last 6 months"). No `@/theme`
 * import (same pure-module convention as `pulseInsight.ts`/`theme/tokens.ts`)
 * so this stays importable under vitest's plain-Node environment.
 */

export interface SparklinePoint {
  x: number;
  y: number;
}

/**
 * dataviz "<4 points -> stat only" floor (spec §0 grounding table, "chart
 * domain: Trend Over Time"). `byMonth` is always 6 zero-filled buckets in
 * practice, but the check stays defensive.
 */
export function shouldRenderSparkline(amounts: readonly number[]): boolean {
  return amounts.length >= 4;
}

/**
 * Evenly spaces `amounts` across [0, width], mapping the series' own
 * min..max range onto [height, 0] (SVG y grows downward, so the minimum
 * value sits at the bottom and the maximum at the top). A flat series
 * (every value equal, including all-zero) never divides by zero — it
 * renders as a flat line through the vertical middle.
 */
export function sparklinePoints(
  amounts: readonly number[],
  width: number,
  height: number,
): SparklinePoint[] {
  if (amounts.length === 0) return [];
  if (amounts.length === 1) return [{ x: width / 2, y: height / 2 }];

  const max = Math.max(...amounts);
  const min = Math.min(...amounts);
  const range = max - min;
  const stepX = width / (amounts.length - 1);

  return amounts.map((amount, index) => ({
    x: index * stepX,
    y: range === 0 ? height / 2 : height - ((amount - min) / range) * height,
  }));
}

/** "M x0 y0 L x1 y1 …" — the stroke path for the `<Path>` line. */
export function sparklineLinePath(points: readonly SparklinePoint[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

/**
 * The line path closed down to the baseline (`height`) under the last then
 * first point, back to the start — the fill shape for the gradient area
 * under the `<Path>` line (spec §6: "gradient Defs").
 */
export function sparklineAreaPath(points: readonly SparklinePoint[], height: number): string {
  if (points.length === 0) return '';
  const last = points[points.length - 1]!;
  const first = points[0]!;
  return `${sparklineLinePath(points)} L ${last.x} ${height} L ${first.x} ${height} Z`;
}

/**
 * Total on-screen length of the polyline (sum of Euclidean distances between
 * consecutive points) — sizes the `strokeDasharray`/`strokeDashoffset` pair
 * that drives the reanimated draw-in animation (spec §6 choreography: "the
 * sparkline draws in"). 0 for fewer than 2 points (nothing to draw between).
 */
export function sparklinePathLength(points: readonly SparklinePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i]!.x - points[i - 1]!.x;
    const dy = points[i]!.y - points[i - 1]!.y;
    total += Math.hypot(dx, dy);
  }
  return total;
}

/**
 * `from` = UTC start of the month 5 calendar months before `now`'s month;
 * `to` = `now` (ISO instant). Matches the server's `monthGrid(from, to)` to
 * yield exactly the 6 zero-filled monthly buckets the Pulse sparkline
 * renders (spec §6: "Your spend · last 6 months"). Mirrors
 * `spendSnapshotRange`'s convention (`lib/spendSnapshot.ts`, WI-036) with a
 * 5-month-back window instead of 2.
 */
export function pulseSparklineRange(now: Date = new Date()): { from: string; to: string } {
  const from = startOfMonth(subMonths(now, 5));
  return { from: from.toISOString(), to: now.toISOString() };
}
