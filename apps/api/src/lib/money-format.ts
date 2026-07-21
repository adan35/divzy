import { getCurrency, toMajorUnits } from '@divzy/shared';

// ---------------------------------------------------------------------------
// Shared currency-decimal formatting for the group export formats. Extracted
// from csv.ts (WI-018 / ADR-014 binding condition #1) so `csv.ts`
// (`buildGroupCsv`) and `pdf.ts` (`buildGroupPdf`) derive amounts from one
// source of integer-minor-unit -> currency-correct-decimal logic and can
// never drift apart.
// ---------------------------------------------------------------------------

/** Minor units → fixed decimal string with the currency's decimals ("12.50", "1200"). */
export function decimalString(minor: number, currency: string): string {
  const { decimals } = getCurrency(currency);
  return toMajorUnits(minor, currency).toFixed(decimals);
}
