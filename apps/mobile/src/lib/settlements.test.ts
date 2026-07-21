import { describe, expect, it } from 'vitest';
import {
  beforeAfterComparison,
  canRecordSuggestion,
  canDeleteSettlement,
  canRestoreSettlement,
  findDirectionalDebt,
  friendDirectionalDebts,
  friendHasNothingOutstanding,
  friendSettleParams,
  isProofPdf,
  isSettlementParty,
  netReachableAmount,
  resolveSettleParties,
  settleCounterpartyId,
  settlementMethodLabel,
  settlementPartyLine,
  withProofUrl,
} from './settlements';

// WI-004 — "Don't let me try to record payments that aren't mine"
// Mirrors POST /settlements' server-side check (settlements.ts:71-73) so the
// mobile Balances tab's "Record" action is disabled, never hidden, for
// suggestions the current user isn't a party to (ADR-004).
describe('canRecordSuggestion (WI-004)', () => {
  it('is actionable when the current user is the payer (fromUserId)', () => {
    expect(canRecordSuggestion('u1', 'u1', 'u2')).toBe(true);
  });

  it('is actionable when the current user is the recipient (toUserId)', () => {
    expect(canRecordSuggestion('u1', 'u2', 'u1')).toBe(true);
  });

  it('is not actionable when the current user is neither party', () => {
    expect(canRecordSuggestion('u1', 'u2', 'u3')).toBe(false);
  });

  it('is actionable for a self-transfer edge case (both fields equal the viewer)', () => {
    // Not a real production case (server rejects fromUserId === toUserId),
    // but the gate must not throw or misbehave if it ever renders.
    expect(canRecordSuggestion('u1', 'u1', 'u1')).toBe(true);
  });
});

// WI-012 — "Bound 'Record a payment' to the real outstanding balance"
// Mirrors the server's directional lookup (settlements.ts's new
// NO_OUTSTANDING_BALANCE / EXCEEDS_BALANCE bound, spec-WI-012 "Validation
// rule") purely as a client-side affordance for the mobile settle screen
// (apps/mobile/app/settle.tsx). The server remains the sole enforcement
// authority in every case below.
describe('findDirectionalDebt (WI-012)', () => {
  const pairwise = [
    { currency: 'PKR', fromUserId: 'ana', toUserId: 'me', amount: 500 },
    { currency: 'USD', fromUserId: 'sam', toUserId: 'me', amount: 3500 },
  ];

  it('finds the exact currency + direction match', () => {
    expect(findDirectionalDebt(pairwise, 'ana', 'me', 'PKR')).toEqual(pairwise[0]);
  });

  it('returns undefined when the balance is zero (no entry at all)', () => {
    expect(findDirectionalDebt([], 'ana', 'me', 'PKR')).toBeUndefined();
  });

  it('returns undefined when the direction is swapped (wrong-direction reject)', () => {
    expect(findDirectionalDebt(pairwise, 'me', 'ana', 'PKR')).toBeUndefined();
  });

  it('returns undefined when the currency differs, even with real debt in another currency', () => {
    // Worked example N2 — a converted-display figure must never substitute
    // for a missing native per-currency entry.
    expect(findDirectionalDebt(pairwise, 'sam', 'me', 'EUR')).toBeUndefined();
  });
});

describe('friendHasNothingOutstanding (WI-012)', () => {
  it('is true when both native leftovers and the converted figure are empty/zero', () => {
    expect(friendHasNothingOutstanding({ balances: [], balancesConverted: null })).toBe(true);
  });

  it('is true when balancesConverted is present but its amount is exactly zero', () => {
    expect(
      friendHasNothingOutstanding({ balances: [], balancesConverted: { currency: 'USD', amount: 0 } }),
    ).toBe(true);
  });

  it('is false when a native leftover currency exists, even with no converted figure', () => {
    expect(
      friendHasNothingOutstanding({
        balances: [{ currency: 'XYZ', amount: 500 }],
        balancesConverted: null,
      }),
    ).toBe(false);
  });

  it('is false when the converted figure is non-zero', () => {
    expect(
      friendHasNothingOutstanding({ balances: [], balancesConverted: { currency: 'USD', amount: 4000 } }),
    ).toBe(false);
  });

  it('is false (safe default — never blocks) when the friend is not yet resolved', () => {
    expect(friendHasNothingOutstanding(undefined)).toBe(false);
  });
});

describe('friendDirectionalDebts (WI-012)', () => {
  it('direction-normalizes a positive native leftover (friend owes viewer)', () => {
    expect(friendDirectionalDebts([{ currency: 'XYZ', amount: 500 }], 'me', 'sam')).toEqual([
      { currency: 'XYZ', fromUserId: 'sam', toUserId: 'me', amount: 500 },
    ]);
  });

  it('direction-normalizes a negative native leftover (viewer owes friend)', () => {
    expect(friendDirectionalDebts([{ currency: 'XYZ', amount: -500 }], 'me', 'sam')).toEqual([
      { currency: 'XYZ', fromUserId: 'me', toUserId: 'sam', amount: 500 },
    ]);
  });

  it('drops zero-amount entries', () => {
    expect(friendDirectionalDebts([{ currency: 'XYZ', amount: 0 }], 'me', 'sam')).toEqual([]);
  });

  it('handles multiple leftover currencies', () => {
    expect(
      friendDirectionalDebts(
        [
          { currency: 'XYZ', amount: 500 },
          { currency: 'ABC', amount: -200 },
        ],
        'me',
        'sam',
      ),
    ).toEqual([
      { currency: 'XYZ', fromUserId: 'sam', toUserId: 'me', amount: 500 },
      { currency: 'ABC', fromUserId: 'me', toUserId: 'sam', amount: 200 },
    ]);
  });
});

// spec-WI-050 (REOPENED) — friend-detail Settle Up prefill direction, fixed
// to read `balancesNative` (the full signed native breakdown) instead of the
// WI-001-narrowed `balances` leftover field. Both directions are asserted
// explicitly so a fix that merely flips the old hardcode still fails one of
// them (per spec-WI-050 "Required regression tests").
describe('friendSettleParams (WI-050)', () => {
  it('friend owes viewer (positive native balance) -> from=friend, to=me, amount/currency set', () => {
    expect(friendSettleParams([{ currency: 'PKR', amount: 80000 }], 'sam', 'me')).toEqual({
      friendId: 'sam',
      fromUserId: 'sam',
      toUserId: 'me',
      amount: '80000',
      currency: 'PKR',
    });
  });

  it('viewer owes friend (negative native balance) -> from=me, to=friend, amount/currency set', () => {
    expect(friendSettleParams([{ currency: 'USD', amount: -4000 }], 'sam', 'me')).toEqual({
      friendId: 'sam',
      fromUserId: 'me',
      toUserId: 'sam',
      amount: '4000',
      currency: 'USD',
    });
  });

  it('ambiguous fallback: 2+ non-zero native currencies -> safe default, no amount/currency', () => {
    const params = friendSettleParams(
      [
        { currency: 'EUR', amount: 500 },
        { currency: 'GBP', amount: -300 },
      ],
      'sam',
      'me',
    );
    expect(params).toEqual({ friendId: 'sam', fromUserId: 'me', toUserId: 'sam' });
    expect(params.amount).toBeUndefined();
    expect(params.currency).toBeUndefined();
  });

  it('settled (empty native balances) -> safe default, no amount/currency', () => {
    expect(friendSettleParams([], 'sam', 'me')).toEqual({
      friendId: 'sam',
      fromUserId: 'me',
      toUserId: 'sam',
    });
  });

  it('a present-but-fully-zeroed native balances array hits the same safe default as an empty array', () => {
    expect(friendSettleParams([{ currency: 'USD', amount: 0 }], 'sam', 'me')).toEqual({
      friendId: 'sam',
      fromUserId: 'me',
      toUserId: 'sam',
    });
  });

  it('regression: reading the WI-001-narrowed `balances` field (usually []) must NOT be what callers pass — this only documents the fix is in the caller, not here (see friend/[id].tsx)', () => {
    // A friend with balances: [] (narrowed leftovers, common case) but a
    // real native debt would, pre-fix, hit the "no primary" branch and
    // hardcode from=me,to=friend even when the friend owes the viewer. This
    // function is agnostic to which array it's given — passing balancesNative
    // (not balances) is the fix, verified structurally here: a non-empty
    // native array with exactly one entry always yields a definite direction.
    const nativeOnly = friendSettleParams([{ currency: 'PKR', amount: 80000 }], 'sam', 'me');
    expect(nativeOnly.fromUserId).toBe('sam'); // friend owes viewer, not hardcoded to 'me'
  });
});

// WI-012 Revision 2 (cycle 1) — group-scoped bound widened from a bilateral
// pairwise lookup to a net-position reachability ceiling
// (defect-WI-012.md; ADR-010). Mirrors the server's
// `settleable = netP < 0 && netR > 0 ? Math.min(-netP, netR) : 0` rule and
// the web client's parallel fix, over `GroupBalancesDto.members[].balances`
// (native per-currency nets — never `convertedNet`, ARCH invariant 5).
describe('netReachableAmount (WI-012 Revision 2)', () => {
  it('is the reachable ceiling when the payer is a net debtor and the recipient a net creditor', () => {
    const members = [
      { user: { id: 'sam' }, balances: [{ currency: 'USD', amount: -800 }] },
      { user: { id: 'me' }, balances: [{ currency: 'USD', amount: 1200 }] },
    ];
    expect(netReachableAmount(members, 'sam', 'me', 'USD')).toBe(800);
  });

  it('is zero when neither party has a net position in this group/currency', () => {
    const members = [
      { user: { id: 'sam' }, balances: [] },
      { user: { id: 'me' }, balances: [] },
    ];
    expect(netReachableAmount(members, 'sam', 'me', 'USD')).toBe(0);
  });

  it('is zero when the payer is not even a member of the group (no relationship)', () => {
    const members = [{ user: { id: 'me' }, balances: [{ currency: 'USD', amount: 1200 }] }];
    expect(netReachableAmount(members, 'sam', 'me', 'USD')).toBe(0);
  });

  it('is zero when the "payer" is actually a net creditor (wrong direction)', () => {
    const members = [
      { user: { id: 'sam' }, balances: [{ currency: 'USD', amount: 500 }] },
      { user: { id: 'me' }, balances: [{ currency: 'USD', amount: -500 }] },
    ];
    expect(netReachableAmount(members, 'sam', 'me', 'USD')).toBe(0);
  });

  it('is zero when the currency requested has no net entry for either party', () => {
    const members = [
      { user: { id: 'sam' }, balances: [{ currency: 'USD', amount: -800 }] },
      { user: { id: 'me' }, balances: [{ currency: 'USD', amount: 1200 }] },
    ];
    expect(netReachableAmount(members, 'sam', 'me', 'EUR')).toBe(0);
  });

  it('allows a chain-mediated suggestion with no bilateral relationship (defect-WI-012 repro: SAM/ANA/ME)', () => {
    // Trip: ME +10000, ANA 0, SAM -10000 (USD) — SAM and ME never shared a
    // direct expense/settlement (the debt is chain-mediated through ANA), so
    // a bilateral `computePairwiseBalances`/`findDirectionalDebt` lookup has
    // no SAM->ME entry at all. The net-reachability ceiling must still allow
    // the full suggested transfer.
    const members = [
      { user: { id: 'me' }, balances: [{ currency: 'USD', amount: 10000 }] },
      { user: { id: 'ana' }, balances: [{ currency: 'USD', amount: 0 }] },
      { user: { id: 'sam' }, balances: [{ currency: 'USD', amount: -10000 }] },
    ];
    expect(netReachableAmount(members, 'sam', 'me', 'USD')).toBe(10000);
  });

  it('caps at the smaller magnitude — a genuine overpayment in net terms is not reachable', () => {
    // Payer only owes 300 overall; recipient is owed 1000 overall by the
    // group as a whole. The ceiling must be the payer's own debt magnitude
    // (300), not the recipient's larger claim — anything above 300 would
    // flip the payer's net into creditor territory, which is exactly the
    // "overpayment silently corrupts the ledger" case the bound exists to
    // prevent (ADR-010 "tight, and correctly rejects excess").
    const members = [
      { user: { id: 'sam' }, balances: [{ currency: 'USD', amount: -300 }] },
      { user: { id: 'me' }, balances: [{ currency: 'USD', amount: 1000 }] },
    ];
    const settleable = netReachableAmount(members, 'sam', 'me', 'USD');
    expect(settleable).toBe(300);
    expect(700).toBeGreaterThan(settleable); // amount > settleable -> EXCEEDS_BALANCE at the call site
  });
});

// ADR-011 (WI-013) — the group-scoped bound widens from the bare net
// ceiling to max(netCeiling, bilateralPairwiseOwed), so a genuinely-owed
// pairwise debt in a chain isn't wrongly clamped to zero by the net ceiling.
// Worked counterexample straight from ADR-011: A owes B 100 bilaterally, but
// A's own net is 0 (A also has an unrelated +100 from C), so the old net
// ceiling alone would clamp A -> B to 0.
describe('netReachableAmount — ADR-011 union with bilateral pairwise (WI-013)', () => {
  const members = [
    { user: { id: 'a' }, balances: [{ currency: 'USD', amount: 0 }] },
    { user: { id: 'b' }, balances: [{ currency: 'USD', amount: 100 }] },
    { user: { id: 'c' }, balances: [{ currency: 'USD', amount: -100 }] },
  ];
  const pairwise = [
    { currency: 'USD', fromUserId: 'a', toUserId: 'b', amount: 100 },
    { currency: 'USD', fromUserId: 'c', toUserId: 'a', amount: 100 },
  ];

  it('is 0 for A->B with the net ceiling alone (pre-ADR-011 behavior, no pairwise arg)', () => {
    expect(netReachableAmount(members, 'a', 'b', 'USD')).toBe(0);
  });

  it('widens to the bilateral amount when the net ceiling is tighter (accepts the real A->B 100 debt)', () => {
    expect(netReachableAmount(members, 'a', 'b', 'USD', pairwise)).toBe(100);
  });

  it('still rejects an amount beyond both the net ceiling and the bilateral debt (A->B 101)', () => {
    const ceiling = netReachableAmount(members, 'a', 'b', 'USD', pairwise);
    expect(101).toBeGreaterThan(ceiling);
  });

  it('still rejects a settled pair (no bilateral entry, no net reachability)', () => {
    expect(netReachableAmount(members, 'b', 'c', 'USD', pairwise)).toBe(0);
  });

  it('takes the net ceiling when it is the larger of the two (chain-mediated suggestion, no bilateral entry at all)', () => {
    const chainMembers = [
      { user: { id: 'me' }, balances: [{ currency: 'USD', amount: 10000 }] },
      { user: { id: 'ana' }, balances: [{ currency: 'USD', amount: 0 }] },
      { user: { id: 'sam' }, balances: [{ currency: 'USD', amount: -10000 }] },
    ];
    // No sam->me pairwise row at all (chain-mediated through ana) — must
    // still fall back to the net ceiling exactly like WI-012 Revision 2.
    expect(netReachableAmount(chainMembers, 'sam', 'me', 'USD', [])).toBe(10000);
  });

  it('defaults the pairwise param to empty so pre-ADR-011 call sites are unaffected', () => {
    expect(netReachableAmount(members, 'a', 'b', 'USD')).toBe(
      netReachableAmount(members, 'a', 'b', 'USD', []),
    );
  });
});

// WI-013 — before/after payment-count comparison ("N payments -> M payments"),
// always visible near the toggle regardless of toggle position, except when
// the group is fully settled (no misleading badge either way).
describe('beforeAfterComparison (WI-013)', () => {
  it('returns before/after counts when there is a real reduction (chain simplification)', () => {
    expect(beforeAfterComparison(2, 1)).toEqual({ before: 2, after: 1 });
  });

  it('returns null (no badge) when the group is fully settled (0 -> 0)', () => {
    expect(beforeAfterComparison(0, 0)).toBeNull();
  });

  it('returns equal counts when the group is already minimal (1 -> 1) — never implies a false saving', () => {
    expect(beforeAfterComparison(1, 1)).toEqual({ before: 1, after: 1 });
  });

  it('returns equal counts for any already-minimal N -> N, not just 1 -> 1', () => {
    expect(beforeAfterComparison(3, 3)).toEqual({ before: 3, after: 3 });
  });

  it('is a currency-agnostic payment count, not a money amount — large counts pass through unmodified', () => {
    expect(beforeAfterComparison(7, 4)).toEqual({ before: 7, after: 4 });
  });
});

// WI-024 / ADR-021 — resolve Settle Up's party state as pure derived values
// every render instead of a write-once "fill blanks once async data
// arrives" effect (`settle.tsx:247-257`, deleted). The old effect read
// `fromUserId`/`toUserId` through a stale closure omitted from its deps: on
// mobile that manifested as WI-021's mid-interaction overwrite (a user's
// "To" selection getting clobbered when late-arriving candidate data caused
// the effect to re-fire). `resolveSettleParties` makes both the "fill a
// still-blank party once data arrives" and "never overwrite an explicit
// user choice" behaviors fall out of one render-time computation, with no
// effect and no stale window.
describe('resolveSettleParties (WI-024 / ADR-021)', () => {
  const candidates = [{ id: 'me' }, { id: 'sam' }, { id: 'ana' }];

  it('resolves from -> meId and to -> first other candidate when nothing is prefilled or overridden', () => {
    expect(resolveSettleParties('', '', 'me', undefined, undefined, candidates)).toEqual({
      resolvedFrom: 'me',
      resolvedTo: 'sam',
    });
  });

  it('prefers prefillFrom/prefillTo (route params) over meId/candidates when there is no override', () => {
    expect(resolveSettleParties('', '', 'me', 'sam', 'ana', candidates)).toEqual({
      resolvedFrom: 'sam',
      resolvedTo: 'ana',
    });
  });

  it('an explicit override always wins over the derived default, even with prefill present', () => {
    expect(resolveSettleParties('ana', 'sam', 'me', 'sam', 'ana', candidates)).toEqual({
      resolvedFrom: 'ana',
      resolvedTo: 'sam',
    });
  });

  it('picks a default "to" that differs from the resolved "from" (never resolves both parties to the same person)', () => {
    expect(resolveSettleParties('sam', '', 'me', undefined, undefined, candidates)).toEqual({
      resolvedFrom: 'sam',
      resolvedTo: 'me',
    });
  });

  it('resolves to blanks when no candidates have loaded yet (async data not yet arrived)', () => {
    expect(resolveSettleParties('', '', 'me', undefined, undefined, [])).toEqual({
      resolvedFrom: 'me',
      resolvedTo: '',
    });
  });

  it('WI-021 repro: a user-selected "to" survives once late-arriving candidate data resolves', () => {
    // Before data arrives: candidates is empty, user has already picked 'sam' as an override.
    const before = resolveSettleParties('', 'sam', 'me', undefined, undefined, []);
    expect(before.resolvedTo).toBe('sam');
    // Candidate data resolves on a later render; the override must still win,
    // never be clobbered by the newly-available default.
    const after = resolveSettleParties('', 'sam', 'me', undefined, undefined, candidates);
    expect(after.resolvedTo).toBe('sam');
  });

  it('falls back to an empty resolvedFrom when there is no override, no prefill, and no meId', () => {
    expect(resolveSettleParties('', '', undefined, undefined, undefined, candidates)).toEqual({
      resolvedFrom: '',
      resolvedTo: 'me',
    });
  });
});

describe('settleCounterpartyId (WI-012)', () => {
  it("returns the recipient when the viewer is the payer ('from')", () => {
    expect(settleCounterpartyId('me', 'sam', 'me')).toBe('sam');
  });

  it("returns the payer when the viewer is the recipient ('to')", () => {
    expect(settleCounterpartyId('sam', 'me', 'me')).toBe('sam');
  });

  it('returns null when neither party is resolved yet', () => {
    expect(settleCounterpartyId('', '', 'me')).toBeNull();
  });

  it('returns null when the viewer is not involved at all', () => {
    expect(settleCounterpartyId('sam', 'ana', 'me')).toBeNull();
  });
});

// WI-023 — "Payment-proof attachment on a settlement"
// Pure helpers backing the mobile attach/view affordance (spec-WI-023 §5, §6):
// `withProofUrl` decides whether the create payload carries the field at all
// (AC: "creating with no attachment is unchanged" — the key must be entirely
// absent, not merely `undefined`, mirroring the existing `note` pattern in
// settle.tsx); `isProofPdf` mirrors ReceiptPicker's image-vs-PDF affordance
// gate (spec §5: "image mimetypes render inline/thumbnail, application/pdf
// renders as a labeled link").
describe('withProofUrl (WI-023)', () => {
  it('adds proofUrl when a non-empty url is provided', () => {
    expect(withProofUrl({ amount: 100 }, '/uploads/receipts/abc.jpg')).toEqual({
      amount: 100,
      proofUrl: '/uploads/receipts/abc.jpg',
    });
  });

  it('omits the proofUrl key entirely when null', () => {
    const result = withProofUrl({ amount: 100 }, null);
    expect(result).toEqual({ amount: 100 });
    expect('proofUrl' in result).toBe(false);
  });

  it('omits the proofUrl key entirely when an empty string', () => {
    const result = withProofUrl({ amount: 100 }, '');
    expect('proofUrl' in result).toBe(false);
  });
});

describe('isProofPdf (WI-023)', () => {
  it('is true for a URL ending in .pdf', () => {
    expect(isProofPdf('/uploads/receipts/proof.pdf')).toBe(true);
  });

  it('is true for a URL ending in .pdf with a query string', () => {
    expect(isProofPdf('/uploads/receipts/proof.pdf?v=2')).toBe(true);
  });

  it('is true regardless of case', () => {
    expect(isProofPdf('/uploads/receipts/PROOF.PDF')).toBe(true);
  });

  it('is false for image URLs', () => {
    expect(isProofPdf('/uploads/receipts/proof.jpg')).toBe(false);
    expect(isProofPdf('/uploads/receipts/proof.png')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WI-039b / WI-054b — settlement detail: delete/restore gating, party line,
// method label. Mirrors the web SettlementDetailDialog's client-side
// delete/restore gates (spec-WI-054b §4.2: "group settlement -> isParty ||
// isAdmin; direct settlement -> isParty only") and the field rendering
// helpers (`method` label mapping, "who paid whom" line with the existing
// "You" substitution convention already used by expense/[id].tsx's nameOf).
// `canDeleteSettlement` (only when active) and `canRestoreSettlement` (only
// when deleted) are structural inverses of each other — never both true for
// the same settlement (spec §4.3 naming invariant).
// ---------------------------------------------------------------------------

function makeGate(overrides: Partial<Parameters<typeof canDeleteSettlement>[0]> = {}) {
  return {
    from: { id: 'ana' },
    to: { id: 'sam' },
    createdBy: { id: 'sam' },
    groupId: null as string | null,
    deletedAt: null as string | null,
    ...overrides,
  };
}

describe('isSettlementParty (WI-039b)', () => {
  it('is true for the payer (from)', () => {
    expect(isSettlementParty(makeGate(), 'ana')).toBe(true);
  });

  it('is true for the recipient (to)', () => {
    expect(isSettlementParty(makeGate(), 'sam')).toBe(true);
  });

  it('is true for the creator, even when not payer or recipient', () => {
    expect(isSettlementParty(makeGate({ createdBy: { id: 'priya' } }), 'priya')).toBe(true);
  });

  it('is false for a bystander', () => {
    expect(isSettlementParty(makeGate(), 'jordan')).toBe(false);
  });
});

describe('canDeleteSettlement (WI-054b)', () => {
  it('direct settlement: a party may delete', () => {
    expect(canDeleteSettlement(makeGate({ groupId: null }), 'ana', false)).toBe(true);
  });

  it('direct settlement: a non-party may not delete, even if "isGroupAdmin" is somehow true', () => {
    // A direct settlement has no admin concept at all (spec §4 "never both
    // misapplied") — the admin flag must not leak into the direct branch.
    expect(canDeleteSettlement(makeGate({ groupId: null }), 'jordan', true)).toBe(false);
  });

  it('group settlement: a party may delete even when not an admin', () => {
    expect(canDeleteSettlement(makeGate({ groupId: 'g1' }), 'ana', false)).toBe(true);
  });

  it('group settlement: an active admin who is not a party may delete', () => {
    expect(canDeleteSettlement(makeGate({ groupId: 'g1' }), 'priya', true)).toBe(true);
  });

  it('group settlement: a non-admin, non-party member may not delete', () => {
    expect(canDeleteSettlement(makeGate({ groupId: 'g1' }), 'jordan', false)).toBe(false);
  });

  it('is false once the settlement is already deleted, even for a party', () => {
    expect(canDeleteSettlement(makeGate({ deletedAt: '2026-07-17T00:00:00.000Z' }), 'ana', false)).toBe(
      false,
    );
  });

  it('is false once already deleted, even for an active group admin', () => {
    expect(
      canDeleteSettlement(
        makeGate({ groupId: 'g1', deletedAt: '2026-07-17T00:00:00.000Z' }),
        'priya',
        true,
      ),
    ).toBe(false);
  });
});

describe('canRestoreSettlement (WI-054b — structural inverse of canDeleteSettlement)', () => {
  it('is false for an active (not deleted) direct settlement, even for a party', () => {
    expect(canRestoreSettlement(makeGate({ groupId: null, deletedAt: null }), 'ana', false)).toBe(
      false,
    );
  });

  it('is false for an active group settlement, even for an admin', () => {
    expect(canRestoreSettlement(makeGate({ groupId: 'g1', deletedAt: null }), 'priya', true)).toBe(
      false,
    );
  });

  it('direct settlement, deleted: a party may restore', () => {
    expect(
      canRestoreSettlement(
        makeGate({ groupId: null, deletedAt: '2026-07-17T00:00:00.000Z' }),
        'ana',
        false,
      ),
    ).toBe(true);
  });

  it('direct settlement, deleted: a non-party may not restore, even if "isGroupAdmin" is somehow true', () => {
    expect(
      canRestoreSettlement(
        makeGate({ groupId: null, deletedAt: '2026-07-17T00:00:00.000Z' }),
        'jordan',
        true,
      ),
    ).toBe(false);
  });

  it('group settlement, deleted: a party may restore even when not an admin', () => {
    expect(
      canRestoreSettlement(
        makeGate({ groupId: 'g1', deletedAt: '2026-07-17T00:00:00.000Z' }),
        'ana',
        false,
      ),
    ).toBe(true);
  });

  it('group settlement, deleted: an active admin who is not a party may restore', () => {
    expect(
      canRestoreSettlement(
        makeGate({ groupId: 'g1', deletedAt: '2026-07-17T00:00:00.000Z' }),
        'priya',
        true,
      ),
    ).toBe(true);
  });

  it('group settlement, deleted: a non-admin, non-party member may not restore', () => {
    expect(
      canRestoreSettlement(
        makeGate({ groupId: 'g1', deletedAt: '2026-07-17T00:00:00.000Z' }),
        'jordan',
        false,
      ),
    ).toBe(false);
  });

  it('is never true at the same time as canDeleteSettlement for the same settlement (naming invariant, spec §4.3)', () => {
    const active = makeGate({ groupId: 'g1', deletedAt: null });
    const deleted = makeGate({ groupId: 'g1', deletedAt: '2026-07-17T00:00:00.000Z' });
    for (const meId of ['ana', 'sam', 'priya', 'jordan']) {
      for (const isAdmin of [true, false]) {
        expect(canDeleteSettlement(active, meId, isAdmin) && canRestoreSettlement(active, meId, isAdmin)).toBe(
          false,
        );
        expect(
          canDeleteSettlement(deleted, meId, isAdmin) && canRestoreSettlement(deleted, meId, isAdmin),
        ).toBe(false);
      }
    }
  });
});

describe('settlementMethodLabel (WI-039b)', () => {
  it.each([
    ['CASH', 'Cash'],
    ['BANK_TRANSFER', 'Bank transfer'],
    ['UPI', 'UPI'],
    ['PAYPAL', 'PayPal'],
    ['VENMO', 'Venmo'],
    ['OTHER', 'Other'],
  ])('maps %s to %s', (method, label) => {
    expect(settlementMethodLabel(method)).toBe(label);
  });

  it('falls back to "Other" for an unrecognized method', () => {
    expect(settlementMethodLabel('SOMETHING_NEW')).toBe('Other');
  });
});

describe('settlementPartyLine (WI-039b)', () => {
  const settlement = { from: { id: 'ana', name: 'Ana' }, to: { id: 'sam', name: 'Sam' } };

  it('renders both real names when the viewer is neither party', () => {
    expect(settlementPartyLine(settlement, 'priya')).toBe('Ana paid Sam');
  });

  it('substitutes "You" for the payer when the viewer paid', () => {
    expect(settlementPartyLine(settlement, 'ana')).toBe('You paid Sam');
  });

  it('substitutes "You" for the recipient when the viewer received', () => {
    expect(settlementPartyLine(settlement, 'sam')).toBe('Ana paid You');
  });

  it('renders both real names when the viewer id is not yet known', () => {
    expect(settlementPartyLine(settlement, undefined)).toBe('Ana paid Sam');
  });
});
