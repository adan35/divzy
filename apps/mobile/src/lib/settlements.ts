import { SETTLEMENT_METHODS } from '@divzy/shared';

/**
 * Client-side mirror of POST /settlements' authorization check
 * (apps/api/src/routes/settlements.ts:71-73 — `userId !== fromUserId &&
 * userId !== toUserId` → 403 FORBIDDEN). Purely an affordance gate: the
 * server-side check is the unchanged source of truth (spec-WI-004,
 * ADR-004 — disable, not hide).
 */
export function canRecordSuggestion(
  currentUserId: string,
  fromUserId: string,
  toUserId: string,
): boolean {
  return currentUserId === fromUserId || currentUserId === toUserId;
}

// ---------------------------------------------------------------------------
// WI-012 — bound "Record a payment" to the real outstanding balance.
//
// Client-side mirror of POST /settlements' new balance bound
// (spec-WI-012 "Validation rule" — NO_OUTSTANDING_BALANCE / EXCEEDS_BALANCE).
// Purely an affordance gate for the shared mobile settle screen
// (apps/mobile/app/settle.tsx): the server re-derives and enforces the real
// per-currency directional debt regardless of what the client computes here
// (charter ARCH invariant 5 — never read a converted figure to size a
// settlement; these helpers only ever consume native amount/currency).
// ---------------------------------------------------------------------------

export interface DirectionalDebt {
  currency: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
}

/**
 * Direction-aware lookup, identical shape to the server's
 * `computePairwiseBalances(...).find(...)` (spec-WI-012). A miss covers all
 * three reject shapes the server also collapses into one branch: zero
 * balance, wrong direction, and wrong/converted currency.
 */
export function findDirectionalDebt(
  debts: readonly DirectionalDebt[],
  fromUserId: string,
  toUserId: string,
  currency: string,
): DirectionalDebt | undefined {
  return debts.find(
    (d) => d.currency === currency && d.fromUserId === fromUserId && d.toUserId === toUserId,
  );
}

/**
 * Zero-balance disable for non-group entry points (friend detail, dashboard
 * quick action) — spec-WI-012 "Client design · Non-group entry points".
 * Reads `balancesConverted` only as a boolean "is anything outstanding at
 * all", never to size a settlement, so it stays invariant-5 compliant.
 * Returns false (never blocks) when the friend isn't resolved yet.
 */
export function friendHasNothingOutstanding(
  friend:
    | { balances: { currency: string; amount: number }[]; balancesConverted: { currency: string; amount: number } | null }
    | undefined
    | null,
): boolean {
  if (!friend) return false;
  return friend.balances.length === 0 && (!friend.balancesConverted || friend.balancesConverted.amount === 0);
}

/**
 * Direction-normalizes a friend's native leftover balances (`FriendDto.balances`)
 * into `DirectionalDebt` rows so the non-group over-amount clamp can reuse
 * `findDirectionalDebt` exactly like the group-scoped case (spec-WI-012:
 * "clamp pre-submit against it exactly like the group case"). Only
 * meaningful when the caller has confirmed there is exactly one leftover
 * currency — with more than one, which direction/currency the user intends
 * is ambiguous and the caller should fall back to block-at-submit instead.
 */
export function friendDirectionalDebts(
  balances: { currency: string; amount: number }[],
  meId: string,
  counterpartyId: string,
): DirectionalDebt[] {
  return balances
    .filter((b) => b.amount !== 0)
    .map((b) =>
      b.amount > 0
        ? { currency: b.currency, fromUserId: counterpartyId, toUserId: meId, amount: b.amount }
        : { currency: b.currency, fromUserId: meId, toUserId: counterpartyId, amount: -b.amount },
    );
}

/**
 * WI-012 Revision 2 (cycle 1) — net-position reachability ceiling for
 * group-scoped settlements (defect-WI-012.md; ADR-010). Replaces the
 * bilateral `findDirectionalDebt(data.pairwise, ...)` lookup for the
 * group-scoped branch: a min-cash-flow `suggestSettlements` transfer in a
 * 3+-member debt chain can name a pair with no bilateral pairwise entry at
 * all (e.g. SAM -> ME when the debt is chain-mediated through ANA), so the
 * bound must instead mirror the server's net-based ceiling, sourced from
 * `GroupBalancesDto.members[].balances` (native per-currency nets — never
 * `convertedNet`, ARCH invariant 5).
 *
 * `settleable = netP < 0 && netR > 0 ? Math.min(-netP, netR) : 0` — the
 * exact, tight maximum any valid settle-up set can route payer -> recipient
 * (balanced-transportation reachability, ADR-010): every min-cash-flow
 * suggestion passes, partial payments of a suggestion pass, and a true
 * over-payment (beyond either party's own net magnitude) still yields 0/a
 * lower ceiling than the requested amount.
 *
 * ADR-011 (WI-013) — widens the bound to `max(netCeiling, bilateral)`. In a
 * debt chain the net ceiling can be *tighter* than a genuinely-owed bilateral
 * debt (a real pairwise `A owes B 100` where A's own net happens to be 0
 * because of an unrelated debt elsewhere), so once WI-013 makes `pairwise`
 * rows individually settleable, the net-only ceiling would wrongly reject a
 * debt the UI itself shows the user as owing. `pairwise` defaults to `[]` so
 * every pre-ADR-011 call site (net ceiling only) is unaffected. This remains
 * a superset of ADR-010's net ceiling — see ADR-011 "Why this is a superset".
 */
export function netReachableAmount(
  members: readonly { user: { id: string }; balances: readonly { currency: string; amount: number }[] }[],
  fromUserId: string,
  toUserId: string,
  currency: string,
  pairwise: readonly DirectionalDebt[] = [],
): number {
  const netP =
    members.find((m) => m.user.id === fromUserId)?.balances.find((b) => b.currency === currency)?.amount ?? 0;
  const netR =
    members.find((m) => m.user.id === toUserId)?.balances.find((b) => b.currency === currency)?.amount ?? 0;
  const netCeiling = netP < 0 && netR > 0 ? Math.min(-netP, netR) : 0;
  const bilateral = findDirectionalDebt(pairwise, fromUserId, toUserId, currency)?.amount ?? 0;
  return Math.max(netCeiling, bilateral);
}

// ---------------------------------------------------------------------------
// WI-024 / ADR-021 — resolve Settle Up party state as pure derived values.
//
// Replaces the "fill blanks once async data arrives" effect
// (settle.tsx:247-257, deleted) that read `fromUserId`/`toUserId` through a
// stale closure omitted from its dependency array — the same defect class as
// the web dialog's (settle-dialog.tsx:236-244). On mobile this surfaced as
// WI-021's mid-interaction overwrite: late-arriving candidate data could
// re-fire the effect against a stale snapshot and clobber a user's explicit
// "To" selection. Computing the resolved parties fresh on every render, from
// current override state + current candidate/prefill data, makes both "fill
// a still-blank party once data is available" and "never overwrite an
// explicit choice" fall out of one expression — there is no effect left to
// skip a needed fill or to overwrite a user's pick.
// ---------------------------------------------------------------------------

/**
 * `override` is the user's explicit choice (empty string means "not
 * overridden yet"); `default*` is derived from route-param prefill / the
 * signed-in user / first-available candidate. An override always wins.
 */
export function resolveSettleParties(
  fromOverride: string,
  toOverride: string,
  meId: string | undefined,
  prefillFrom: string | undefined,
  prefillTo: string | undefined,
  candidates: readonly { id: string }[],
): { resolvedFrom: string; resolvedTo: string } {
  const defaultFrom = prefillFrom ?? meId ?? '';
  const resolvedFrom = fromOverride || defaultFrom;
  const defaultTo =
    prefillTo ?? candidates.find((c) => c.id !== (resolvedFrom || meId))?.id ?? '';
  const resolvedTo = toOverride || defaultTo;
  return { resolvedFrom, resolvedTo };
}

/**
 * The "other" party in a from/to pair the viewer is always one side of
 * (`meInvolved` is already enforced elsewhere in settle.tsx). Null while
 * either party is unresolved, or — defensively — if the viewer isn't
 * actually a party.
 */
export function settleCounterpartyId(
  fromUserId: string,
  toUserId: string,
  meId: string,
): string | null {
  if (!fromUserId || !toUserId) return null;
  if (fromUserId === meId) return toUserId;
  if (toUserId === meId) return fromUserId;
  return null;
}

// ---------------------------------------------------------------------------
// WI-013 — "Simplify debts" toggle + before/after payment-count comparison.
// ---------------------------------------------------------------------------

/**
 * "`before` payments -> `after` payments" (spec-WI-013 "Before/after
 * comparison") from `data.pairwise.length` -> `data.suggestions.length`,
 * always visible near the toggle regardless of toggle position — except when
 * the group is fully settled (`0 -> 0`), where `null` means render no badge
 * at all, matching the "All settled up" empty state instead of a misleading
 * "0 payments -> 0 payments". When already minimal (`before === after`) the
 * equal counts are still returned — never implies a saving that doesn't
 * exist. Purely a payment *count*, currency-agnostic by construction since
 * both source arrays already flatten across currencies (never a summed money
 * amount, never currency-mixed).
 */
export function beforeAfterComparison(
  pairwiseCount: number,
  suggestionsCount: number,
): { before: number; after: number } | null {
  if (pairwiseCount === 0 && suggestionsCount === 0) return null;
  return { before: pairwiseCount, after: suggestionsCount };
}

// ---------------------------------------------------------------------------
// WI-023 — payment-proof attachment on a settlement (spec-WI-023, ADR-020).
//
// NOTE (backend dependency gap, flagged at Build): as of this build,
// `proofUrl` has not yet landed on `CreateSettlementInput`/`SettlementDto` in
// `@divzy/shared` (checked: absent from packages/shared/src/schemas.ts,
// types.ts and apps/api/prisma/schema.prisma). Per spec §4.1/§4.3 that field
// is expected to land as an optional/nullable string identical in shape to
// `Expense.receiptUrl`. `withProofUrl` is typed structurally (no import of
// the shared type) so it compiles today and needs no change once the
// backend PR merges.
// ---------------------------------------------------------------------------

/**
 * Include `proofUrl` in a settlement create payload only when a non-empty
 * value is present — the key must be entirely absent otherwise, mirroring
 * `note`'s existing `...(note.trim() ? { note: ... } : {})` pattern in
 * settle.tsx, so "creating with no attachment" is byte-for-byte unchanged
 * (spec-WI-023 AC).
 */
export function withProofUrl<T extends Record<string, unknown>>(
  payload: T,
  proofUrl: string | null,
): T & { proofUrl?: string } {
  return proofUrl ? { ...payload, proofUrl } : payload;
}

/**
 * Image vs. PDF affordance gate for viewing an attached proof (spec-WI-023
 * §5: "image mimetypes render inline/thumbnail, application/pdf renders as a
 * labeled link") — mirrors `ReceiptPicker`'s local `isPdf` check
 * (apps/mobile/src/components/expense-editor/ReceiptPicker.tsx).
 */
export function isProofPdf(url: string): boolean {
  return /\.pdf(\?.*)?$/i.test(url);
}

// ---------------------------------------------------------------------------
// WI-039b / WI-054b — settlement detail: delete + restore gating, "who paid
// whom" line, method label. Mirrors the web SettlementDetailDialog's
// client-side delete/restore gates (spec-WI-054b §4.2): group settlement ->
// isParty || isAdmin; direct settlement -> isParty only, with no admin
// concept at all (an admin flag must never leak into the direct branch).
// `canDeleteSettlement` is hidden once `deletedAt` is set (nothing left to
// delete); `canRestoreSettlement` is its structural inverse — hidden until
// `deletedAt` is set, then the same party/admin gate. Exactly one of the
// two is ever true for a given
// settlement + viewer (spec §4.3 naming invariant). Purely a UX affordance —
// the additive group-admin DELETE/RESTORE authz (settlements.ts, spec §2.1)
// is the actual enforcement boundary regardless of what this hides.
// ---------------------------------------------------------------------------

export interface SettlementActionGate {
  from: { id: string };
  to: { id: string };
  createdBy: { id: string };
  groupId: string | null;
  deletedAt: string | null;
}

/** Payer, recipient, or creator — the unchanged party rule (both direct and group). */
export function isSettlementParty(
  settlement: Pick<SettlementActionGate, 'from' | 'to' | 'createdBy'>,
  meId: string,
): boolean {
  return (
    meId === settlement.from.id || meId === settlement.to.id || meId === settlement.createdBy.id
  );
}

export function canDeleteSettlement(
  settlement: SettlementActionGate,
  meId: string,
  isGroupAdmin: boolean,
): boolean {
  if (settlement.deletedAt) return false;
  const isParty = isSettlementParty(settlement, meId);
  return settlement.groupId ? isParty || isGroupAdmin : isParty;
}

/**
 * Structural inverse of `canDeleteSettlement`: only offered once
 * `deletedAt` is set, gated by the same party/admin rule (spec-WI-054b
 * §4.2 "return false unless deletedAt is set, then the same
 * groupId ? isParty||isGroupAdmin : isParty gate").
 */
export function canRestoreSettlement(
  settlement: SettlementActionGate,
  meId: string,
  isGroupAdmin: boolean,
): boolean {
  if (!settlement.deletedAt) return false;
  const isParty = isSettlementParty(settlement, meId);
  return settlement.groupId ? isParty || isGroupAdmin : isParty;
}

/** `SettlementMethod` -> human label, mirroring web's `settlements-section.tsx` methodLabel. */
export function settlementMethodLabel(method: string): string {
  return SETTLEMENT_METHODS.find((m) => m.key === method)?.label ?? 'Other';
}

// ---------------------------------------------------------------------------
// WI-050 (REOPENED) — friend-detail Settle Up prefill direction.
//
// Extracted from `friend/[id].tsx`'s `FriendHeader.openSettle` closure
// (spec-WI-050 §4.2/§9 task 3, "optional but recommended" — aligning mobile
// to web's `settle-prefill.ts` exactly-one-native-currency guard so a 2+
// ambiguous case falls back to preselect instead of picking an arbitrary
// first currency) so this decision is importable/testable per the
// [[feedback_gating-logic-extraction]] precedent (WI-004/WI-012).
//
// Root cause this fixes: the caller must pass `FriendDto.balancesNative`
// (the full signed native per-currency breakdown), never `FriendDto.balances`
// (WI-001-narrowed to unconvertible leftovers only, `[]` in the common
// single-convertible-currency case). Reading the narrowed field made the
// "no exactly-one match" fallback fire in the majority case, hardcoding
// `from=me, to=friend` even when the friend was the one who owed the viewer.
// This function itself is agnostic to which field is passed in — the fix is
// the caller passing `balancesNative` (see friend/[id].tsx).
// ---------------------------------------------------------------------------

export interface FriendSettleParams extends Record<string, string> {
  friendId: string;
  fromUserId: string;
  toUserId: string;
}

/**
 * Direction + amount/currency prefill for the friend-detail "Settle up"
 * button. Mirrors web's `friendSettleIntent` (`settle-prefill.ts`): exactly
 * one non-zero native currency picks a definite direction/amount; zero or
 * 2+ non-zero natives (settled, or genuinely ambiguous multi-currency) fall
 * back to the safe default — preselect the two parties, no amount/currency
 * params at all (mobile's existing convention; unlike web, which defaults
 * amount to 0 in its fallback branch).
 */
export function friendSettleParams(
  balancesNative: { currency: string; amount: number }[],
  friendId: string,
  meId: string,
): FriendSettleParams {
  const nonZero = balancesNative.filter((b) => b.amount !== 0);
  const only = nonZero.length === 1 ? nonZero[0] : undefined;
  if (only) {
    const amount = String(Math.abs(only.amount));
    const currency = only.currency;
    return only.amount > 0
      ? { friendId, fromUserId: friendId, toUserId: meId, amount, currency }
      : { friendId, fromUserId: meId, toUserId: friendId, amount, currency };
  }
  return { friendId, fromUserId: meId, toUserId: friendId };
}

/**
 * "Who paid whom" line (spec-WI-039b §4's field list), with the same "You"
 * substitution convention `expense/[id].tsx`'s `nameOf` already uses.
 */
export function settlementPartyLine(
  settlement: { from: { id: string; name: string }; to: { id: string; name: string } },
  meId: string | undefined,
): string {
  const fromName = meId && settlement.from.id === meId ? 'You' : settlement.from.name;
  const toName = meId && settlement.to.id === meId ? 'You' : settlement.to.name;
  return `${fromName} paid ${toName}`;
}
