import type { CurrencyAmount, FriendBalanceBucket } from '@divzy/shared';
import { collapsedBalanceEntries } from './convertedBalance';
import { balanceSentence } from './format';

/**
 * WI-079 (mobile slice) — pure derivation of the FriendRow per-group
 * breakdown rows from `FriendDto.balancesByGroup` (spec-WI-079 §5 D6–D12,
 * §6.3). Extracted per the repo's WI-062/WI-074 precedent: mobile has no RN
 * component-test harness, so every derivable decision (affordance gating,
 * direct-bucket copy, overflow, direction phrasing, per-bucket fallback
 * flag) lives here where vitest can pin it; FriendRow stays a thin renderer
 * of these rows. Buckets arrive magnitude-sorted from the backend (the DTO
 * owns ordering) — this module never re-sorts.
 */

/** D10 — overflow threshold: more than this many buckets truncates. */
export const BREAKDOWN_OVERFLOW_THRESHOLD = 5;
/** D10 — when truncated, exactly this many magnitude-first buckets render. */
export const BREAKDOWN_OVERFLOW_VISIBLE = 4;

/** One renderable bucket line in the expanded breakdown panel. */
export interface GroupBreakdownRow {
  /** Stable key: the group id, or 'direct' for the non-group bucket (D1). */
  key: string;
  /** `{emoji} {name}` for group buckets; exactly "Direct expenses" (D8). */
  label: string;
  /** True for the non-group/direct bucket (D8 secondary styling). */
  direct: boolean;
  /** Per-bucket render entries via collapsedBalanceEntries (D12). */
  entries: CurrencyAmount[];
  /** Direction sentence for the primary entry (D7), mobile convention. */
  caption: string | null;
  /** Per-bucket fallback flag (D4/D9) — never the friend-level blanket. */
  usedFallbackRates: boolean;
}

/**
 * D11 — the expand affordance is governed by bucket presence/count, NEVER by
 * the friend's overall settled state: suppressed iff there is at most one
 * bucket (a single bucket would duplicate the collapsed row; zero buckets
 * render nothing new). A cross-bucket-cancel friend (zero collapsed net, ≥2
 * nonzero buckets) keeps the affordance.
 */
export function breakdownExpandable(buckets: readonly FriendBalanceBucket[]): boolean {
  return buckets.length > 1;
}

/** D8 — direct bucket copy is exactly "Direct expenses", no emoji. */
export function bucketLabel(bucket: FriendBalanceBucket): string {
  return bucket.group ? `${bucket.group.emoji} ${bucket.group.name}` : 'Direct expenses';
}

export function bucketKey(bucket: FriendBalanceBucket): string {
  return bucket.group?.id ?? 'direct';
}

/**
 * D7 — per-line direction phrasing, mobile's existing sentence convention
 * (`balanceSentence`, the same helper the collapsed FriendRow subtitle uses),
 * with the collapsed row's own "+N more" tail for multi-currency buckets.
 */
export function breakdownCaption(
  friendName: string,
  entries: readonly CurrencyAmount[],
): string | null {
  const primary = entries[0];
  if (!primary) return null;
  const sentence = balanceSentence(friendName, primary.amount, primary.currency);
  return entries.length > 1 ? `${sentence} · +${entries.length - 1} more` : sentence;
}

/** Derives one renderable row from a bucket (D8/D9/D12 + D7 caption). */
export function breakdownRow(
  friendName: string,
  bucket: FriendBalanceBucket,
): GroupBreakdownRow {
  const entries = collapsedBalanceEntries(bucket.balancesConverted, bucket.balances);
  return {
    key: bucketKey(bucket),
    label: bucketLabel(bucket),
    direct: bucket.group === null,
    entries,
    caption: breakdownCaption(friendName, entries),
    usedFallbackRates: bucket.usedFallbackRates,
  };
}

/**
 * D10 — the visible rows for the expanded panel. When the bucket count
 * exceeds the threshold and the in-expansion "+N more groups" toggle is off,
 * only the first BREAKDOWN_OVERFLOW_VISIBLE (already magnitude-sorted)
 * buckets render and `hiddenCount` feeds the toggle line.
 */
export function visibleBreakdownRows(
  friendName: string,
  buckets: readonly FriendBalanceBucket[],
  showAll: boolean,
): { rows: GroupBreakdownRow[]; hiddenCount: number } {
  const truncate = buckets.length > BREAKDOWN_OVERFLOW_THRESHOLD && !showAll;
  const visible = truncate ? buckets.slice(0, BREAKDOWN_OVERFLOW_VISIBLE) : buckets;
  return {
    rows: visible.map((b) => breakdownRow(friendName, b)),
    hiddenCount: truncate ? buckets.length - BREAKDOWN_OVERFLOW_VISIBLE : 0,
  };
}
