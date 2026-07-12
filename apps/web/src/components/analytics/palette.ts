'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

/**
 * Categorical chart palette from docs/STYLE.md §Charts — FIXED order, never
 * cycled. More than 8 categories fold into "Other" (muted gray).
 * These exact hex values are specified by the design system for chart marks
 * only; all text/UI chrome still uses the CSS token utilities.
 */
export const CHART_PALETTE_LIGHT = [
  '#2a78d6',
  '#1baf7a',
  '#eda100',
  '#008300',
  '#4a3aa7',
  '#e34948',
  '#e87ba4',
  '#eb6834',
] as const;

export const CHART_PALETTE_DARK = [
  '#3987e5',
  '#199e70',
  '#c98500',
  '#008300',
  '#9085e9',
  '#e66767',
  '#d55181',
  '#d95926',
] as const;

/** "Other" bucket color (muted gray, same in both themes). */
export const CHART_OTHER_COLOR = '#898781';

/** Hairline chart grid per STYLE.md. */
export const CHART_GRID_LIGHT = '#e1e0d9';
export const CHART_GRID_DARK = '#2c2c2a';

export interface ChartTheme {
  palette: readonly string[];
  grid: string;
}

/**
 * Theme-aware chart colors. Uses the light palette until mounted so server
 * and first client render agree (charts fill in with data afterwards).
 */
export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = mounted && resolvedTheme === 'dark';
  return {
    palette: dark ? CHART_PALETTE_DARK : CHART_PALETTE_LIGHT,
    grid: dark ? CHART_GRID_DARK : CHART_GRID_LIGHT,
  };
}
