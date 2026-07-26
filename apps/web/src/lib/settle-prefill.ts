import type { CurrencyAmount, FriendBalanceBucket, FriendDto, PublicUserDto } from '@divzy/shared';
import type { SettleUpPrefill } from '@/components/settle/settle-dialog';
import { friendHasNothingOutstanding } from '@/lib/balance-display';

/** Minimal current-user shape this helper needs (id + default currency). */
export interface SettleActor {
  id: string;
  defaultCurrency: string;
}

export interface FriendSettleIntent {
  /** True when the friend has a real zero balance across every currency —
   *  callers must NOT open the dialog (mirror friend-detail's disabled gate). */
  disabled: boolean;
  /** Prefill for SettleUpDialog; undefined when disabled or no actor. */
  prefill: SettleUpPrefill | undefined;
}

/**
 * WI-050: the friend-detail page's settle-up prefill/gate logic
 * (originally inline at friends/[friendId]/page.tsx:110-147), extracted
 * verbatim so a second surface (the dashboard Friends-row opener) can reuse
 * it instead of duplicating it — see spec-WI-050 §2.
 *
 * WI-012: a real zero balance (native leftovers empty AND the converted
 * total is zero/absent) disables the trigger outright instead of opening
 * the dialog with a misleading amount:0 prefill — the converted figure is
 * read only as a boolean "is anything outstanding" check here, never to
 * size a settlement (charter ARCH invariant 5; see friendHasNothingOutstanding).
 *
 * Prefill the settle dialog: exact direction + amount when there's exactly
 * one outstanding NATIVE currency; otherwise just preselect the two of you.
 * Per spec-WI-001's `GET /friends` addendum (extending ADR-007 by analogy),
 * this must keep sourcing from the native, unconverted balance — never
 * `balancesConverted` — so a displayed converted figure never diverges from
 * the amount actually recorded in a Settlement row.
 *
 * spec-WI-050 (REOPENED, 2026-07-18): direction/amount are sourced from
 * `friend.balancesNative` — the full signed native per-currency breakdown —
 * never from `friend.balances` (narrowed post-WI-001 to unconvertible
 * leftovers only, `[]` in the common single-convertible-currency case) and
 * never from `balancesConverted`. Reading the narrowed `balances` field here
 * silently hardcoded `from=me,to=friend` whenever it was empty, i.e. in the
 * majority case — the exact reopened bug. The ambiguous fallback below now
 * fires only when there isn't exactly one non-zero `balancesNative` entry,
 * not merely because `balances` was empty.
 */
export function friendSettleIntent(
  friend: FriendDto,
  me: SettleActor | null | undefined,
): FriendSettleIntent {
  const nothingOutstanding = friendHasNothingOutstanding(friend.balancesConverted, friend.balances);

  const nonZero = friend.balancesNative.filter((b) => b.amount !== 0);
  let prefill: SettleUpPrefill | undefined;
  if (me && !nothingOutstanding) {
    const only = nonZero.length === 1 ? nonZero[0] : undefined;
    if (only && only.amount > 0) {
      prefill = {
        fromUserId: friend.user.id,
        toUserId: me.id,
        amount: only.amount,
        currency: only.currency,
      };
    } else if (only && only.amount < 0) {
      prefill = {
        fromUserId: me.id,
        toUserId: friend.user.id,
        amount: -only.amount,
        currency: only.currency,
      };
    } else {
      prefill = {
        fromUserId: me.id,
        toUserId: friend.user.id,
        amount: 0,
        currency: me.defaultCurrency,
      };
    }
  }

  return { disabled: nothingOutstanding, prefill };
}

/** WI-084: one-tap settle-up intent for a single displayed bucket line. */
export interface BucketSettleIntent {
  /** Omitted for the direct (null-group) bucket. */
  groupId?: string;
  prefill: SettleUpPrefill;
}

/**
 * WI-084: derive a `SettleUpDialog` prefill from a displayed bucket line.
 *
 * The `line` is one entry from `collapsedBalanceEntries(bucket.balancesConverted,
 * bucket.balances)` — the exact amount/currency the user tapped. Direction follows
 * the viewer-signed convention: positive = counterparty owes viewer, negative =
 * viewer owes counterparty. The returned `groupId` is set for group buckets and
 * omitted for the direct bucket, scoping the settlement correctly.
 */
export function bucketSettleIntent(
  bucket: FriendBalanceBucket,
  line: CurrencyAmount,
  friend: FriendDto,
  me: SettleActor,
): BucketSettleIntent {
  const counterpartyId = friend.user.id;
  const amount = Math.abs(line.amount);
  const prefill: SettleUpPrefill =
    line.amount > 0
      ? {
          fromUserId: counterpartyId,
          toUserId: me.id,
          amount,
          currency: line.currency,
        }
      : {
          fromUserId: me.id,
          toUserId: counterpartyId,
          amount,
          currency: line.currency,
        };
  return {
    groupId: bucket.group?.id,
    prefill,
  };
}

/**
 * WI-084: derive a `SettleUpDialog` prefill from a displayed group-panel line.
 *
 * `line` is a caller-relative `CurrencyAmount` (positive = member owes viewer).
 */
export function groupMemberSettleIntent(
  member: PublicUserDto,
  line: CurrencyAmount,
  me: SettleActor,
): SettleUpPrefill {
  const amount = Math.abs(line.amount);
  return line.amount > 0
    ? {
        fromUserId: member.id,
        toUserId: me.id,
        amount,
        currency: line.currency,
      }
    : {
        fromUserId: me.id,
        toUserId: member.id,
        amount,
        currency: line.currency,
      };
}
