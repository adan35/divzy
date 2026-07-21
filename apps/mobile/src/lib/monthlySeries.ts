/** The two toggle-able per-month series on the analytics screen (spec-WI-019). */
export type MonthlySeries = 'you' | 'total';

/** The subset of an `AnalyticsSummaryDto['byMonth']` entry this helper needs. */
export interface MonthlySeriesEntry {
  amount: number;
  totalActivity: number;
}

/**
 * Selects which of `byMonth`'s two zero-filled series a given toggle state
 * renders — `amount` ("your spend") when `series === 'you'`, `totalActivity`
 * ("total activity") otherwise. Both series share the identical calendar-month
 * grid (ADR-011), so this is a pure display-axis switch with no missing-month
 * handling required (spec-WI-019 § Mobile UI).
 */
export function monthlySeriesValue(month: MonthlySeriesEntry, series: MonthlySeries): number {
  return series === 'you' ? month.amount : month.totalActivity;
}
