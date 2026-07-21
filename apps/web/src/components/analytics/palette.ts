'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

/**
 * Categorical chart palette from docs/STYLE.md §Charts — FIXED order, never
 * cycled; slots follow the entity, not its rank. More than 8 categories fold
 * into "Other" (muted cool gray). These exact hex values are the WI-068
 * validator-proven slot orders (dataviz `validate_palette.js`, run 2026-07-19
 * against the new `#ffffff` / `#11161e` surfaces — ALL PASS; the previous
 * order failed the adjacent-slot ΔE floor at slots 7-8). Chart marks only;
 * all text/UI chrome still uses the CSS token utilities.
 *
 * Consumption pattern (spec §8.2):
 * - SINGLE-series marks (trend bars, spend snapshot, group charts, Pulse
 *   sparkline) consume `CHART_SERIES` = `var(--chart-1)` — never
 *   `var(--brand)` (brand is darkened for action contrast; chart-1 keeps the
 *   validated series blue) and never `palette[0]`.
 * - MULTI-series/categorical marks take `useChartTheme().palette` slots in
 *   fixed order.
 * - Gridlines consume `CHART_GRID` = `var(--chart-grid)`; axis text wears
 *   `ink-3`, never a series color.
 */
export const CHART_PALETTE_LIGHT = [
  '#2a78d6',
  '#008300',
  '#e87ba4',
  '#eda100',
  '#1baf7a',
  '#eb6834',
  '#4a3aa7',
  '#e34948',
] as const;

export const CHART_PALETTE_DARK = [
  '#3987e5',
  '#008300',
  '#d55181',
  '#c98500',
  '#199e70',
  '#d95926',
  '#9085e9',
  '#e66767',
] as const;

/** "Other" bucket color (muted cool gray, same in both themes — WI-068). */
export const CHART_OTHER_COLOR = '#7e8a9c';

/**
 * Single-series mark color — resolves per theme via the CSS token.
 * SVG attributes (Recharts stroke/fill) accept `var()` directly.
 */
export const CHART_SERIES = 'var(--chart-1)';

/** Hairline chart gridline color — resolves per theme via the CSS token. */
export const CHART_GRID = 'var(--chart-grid)';

/**
 * Raw per-theme grid hex (matches the `--chart-grid` token values in
 * globals.css) — kept for consumers that cannot resolve CSS variables.
 * Prefer `CHART_GRID` in components.
 */
export const CHART_GRID_LIGHT = '#e6eaf1';
export const CHART_GRID_DARK = '#232b36';

export interface ChartTheme {
  palette: readonly string[];
  grid: string;
}

/**
 * Theme-aware chart colors. Uses the light palette until mounted so server
 * and first client render agree (charts fill in with data afterwards).
 * `grid` is the theme-following CSS variable — safe in SVG in both modes.
 */
export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = mounted && resolvedTheme === 'dark';
  return {
    palette: dark ? CHART_PALETTE_DARK : CHART_PALETTE_LIGHT,
    grid: CHART_GRID,
  };
}
