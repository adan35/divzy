'use client';

import { useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { format } from 'date-fns';
import { formatMoney, type AnalyticsSummaryDto } from '@divzy/shared';

export interface SparklinePoint {
  month: string;
  label: string;
  amount: number;
}

/** "2026-03" (or any ISO-ish month string) -> a Date at that month's start. */
function monthToDate(month: string): Date | null {
  const match = /^(\d{4})-(\d{2})/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return new Date(year, monthIndex, 1);
}

/** Pure point-math: unparseable buckets are dropped, never crash the chart. */
export function buildSparklinePoints(byMonth: AnalyticsSummaryDto['byMonth']): SparklinePoint[] {
  const points: SparklinePoint[] = [];
  for (const m of byMonth) {
    const date = monthToDate(m.month);
    if (!date) continue;
    points.push({ month: m.month, label: format(date, 'MMM'), amount: m.amount });
  }
  return points;
}

/** dataviz "Trend Over Time" floor: fewer than 4 points renders a stat only, never a sparse/misleading line. */
export function hasEnoughPointsForLine(points: readonly SparklinePoint[]): boolean {
  return points.length >= 4;
}

/** Y-axis domain with ~15% headroom so the area/line never visually clips at the plot's top edge. */
export function sparklineDomain(points: readonly SparklinePoint[]): [number, number] {
  const max = points.reduce((acc, p) => Math.max(acc, p.amount), 0);
  return max === 0 ? [0, 1] : [0, Math.ceil(max * 1.15)];
}

const CAPTION = 'Your spend · last 6 months';

interface TooltipPayloadEntry {
  value?: number | string;
  payload?: SparklinePoint;
}

function SparklineTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  currency: string;
}) {
  const entry = payload?.[0];
  const value = entry?.value;
  if (!active || typeof value !== 'number') return null;
  return (
    <div className="rounded-xl border border-hairline bg-elevated px-3 py-2 shadow-pop dark:shadow-top-edge">
      <p className="text-xs text-ink-3">{entry?.payload?.label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums text-ink">
        {formatMoney(value, currency)}
      </p>
    </div>
  );
}

export interface PulseSparklineProps {
  byMonth: AnalyticsSummaryDto['byMonth'];
  currency: string;
  /** Skips the stroke-dashoffset draw-in when true (story AC-6f/AC-8). */
  reducedMotion: boolean;
  className?: string;
}

/**
 * Divzy Pulse's 6-month spend-trend sparkline (spec §6): honestly labeled as
 * a *spend* series (the API has no historical *balance* series and none is
 * fabricated). Area fill + 2px `--chart-1` stroke, dot only on the last
 * point, hover tooltip. Renders a stat-only fallback below the dataviz
 * "Trend Over Time" 4-point floor rather than a sparse/misleading line.
 */
export function PulseSparkline({ byMonth, currency, reducedMotion, className }: PulseSparklineProps) {
  const points = useMemo(() => buildSparklinePoints(byMonth), [byMonth]);
  const enoughPoints = hasEnoughPointsForLine(points);
  const domain = useMemo(() => sparklineDomain(points), [points]);
  const last = points[points.length - 1];

  return (
    <div className={className}>
      <p className="text-[11px] text-ink-3">{CAPTION}</p>
      {!enoughPoints ? (
        <div className="mt-2 flex h-[100px] flex-col items-center justify-center gap-1 text-center">
          <p className="text-sm font-medium text-ink">
            {last ? formatMoney(last.amount, currency) : '—'}
          </p>
          <p className="text-xs text-ink-3">Not enough history yet</p>
        </div>
      ) : (
        <div
          className="mt-2 h-[100px] w-full"
          role="img"
          aria-label={CAPTION}
          data-reduced-motion={reducedMotion || undefined}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 6, right: 2, bottom: 0, left: 2 }}>
              <defs>
                <linearGradient id="pulse-sparkline-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={domain} />
              <Tooltip
                cursor={{ stroke: 'var(--hairline-strong)', strokeWidth: 1 }}
                content={<SparklineTooltip currency={currency} />}
              />
              <Area
                type="monotone"
                dataKey="amount"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fill="url(#pulse-sparkline-fill)"
                isAnimationActive={!reducedMotion}
                animationDuration={500}
                animationBegin={reducedMotion ? 0 : 150}
                dot={(props: { cx?: number; cy?: number; index?: number }) =>
                  props.index === points.length - 1 ? (
                    <circle
                      key="last-point"
                      cx={props.cx}
                      cy={props.cy}
                      r={3}
                      fill="var(--chart-1)"
                      stroke="none"
                    />
                  ) : (
                    // Recharts requires an element back for every point; render nothing for the rest.
                    <g key={`dot-${props.index}`} />
                  )
                }
                activeDot={{ r: 4, fill: 'var(--chart-1)', stroke: 'var(--surface)', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
