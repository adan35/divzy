import { describe, expect, it } from 'vitest';

/**
 * Test-stage regression coverage for story-WI-010/spec-WI-010's mobile "T4":
 * apps/mobile/src/components/groups/GroupBalancesTab.tsx's `transfers` list
 * (current HEAD lines ~63-71) and `recordTransfer` handler (~79-90),
 * verified byte-for-byte against the real file before writing this test:
 *
 *   const transfers: TransferRow[] = (simplifyDebts ? data.suggestions : data.pairwise).map(
 *     (t, index) => ({
 *       key: `${t.currency}-${t.from.id}-${t.to.id}-${index}`,
 *       from: t.from,
 *       to: t.to,
 *       amount: t.amount,
 *       currency: t.currency,
 *     }),
 *   );
 *   ...
 *   const recordTransfer = (t: TransferRow) => {
 *     router.push({
 *       pathname: '/settle',
 *       params: {
 *         groupId,
 *         fromUserId: t.from.id,
 *         toUserId: t.to.id,
 *         amount: String(t.amount),
 *         currency: t.currency,
 *       },
 *     });
 *   };
 *
 * Why this test mirrors the logic instead of importing it (documented, not
 * silently worked around) — same rationale as the sibling
 * `wi010-friendSettlePrefill.test.ts` in this directory:
 *   1. `recordTransfer` is a closure local to the exported component
 *      function, not itself a module-level export there's no way to import.
 *   2. `GroupBalancesTab.tsx` lives under `src/` and IS matched by
 *      vitest.config.ts's `include: ['src/**\/*.test.{ts,tsx}']`, but
 *      apps/mobile has no React Native component-test harness. Confirmed
 *      empirically for this build (not assumed from the vitest.config.ts
 *      comment alone): a throwaway probe test importing this exact module
 *      failed at parse time under the current vitest+node setup ("Expected
 *      'from', got 'typeOf'" — Flow syntax deep in react-native's own
 *      dependency tree that rollup/esbuild can't parse without a
 *      babel-jest/RN preset this repo doesn't have). The same gap is already
 *      flagged, for this same component, in `settlements.blackbox.test.ts`'s
 *      docstring for WI-004 ("apps/mobile has no React Native component-test
 *      harness ... exercises the public function `canRecordSuggestion` ...
 *      not the rendered row/button itself").
 *
 * `buildTransferRows`/`buildRecordTransferParams` below are a byte-for-byte
 * transcription of the source above, not an independent reimplementation of
 * intent. Known, flagged weakness versus an import-based test: if
 * `GroupBalancesTab.tsx` ever changes this mapping without this mirror being
 * updated in lockstep, this test stops being a meaningful regression check.
 * See `.company/domains/settlements/reviews/build-WI-010.md`'s "Mobile
 * additions" section for the residual-gap note recorded alongside this
 * caveat, and a suggested follow-up (extract to an importable pure function,
 * mirroring how `canRecordSuggestion` was already extracted into
 * `settlements.ts` for WI-004) left for architect/ba to decide on, not
 * decided unilaterally here since spec-WI-010's recorded design decision is
 * "no product-code change is required."
 */

interface PartyRef {
  id: string;
}

interface SuggestionLike {
  from: PartyRef;
  to: PartyRef;
  amount: number;
  currency: string;
}

interface TransferRow {
  key: string;
  from: PartyRef;
  to: PartyRef;
  amount: number;
  currency: string;
}

function buildTransferRows(
  simplifyDebts: boolean,
  suggestions: SuggestionLike[],
  pairwise: SuggestionLike[],
): TransferRow[] {
  return (simplifyDebts ? suggestions : pairwise).map((t, index) => ({
    key: `${t.currency}-${t.from.id}-${t.to.id}-${index}`,
    from: t.from,
    to: t.to,
    amount: t.amount,
    currency: t.currency,
  }));
}

function buildRecordTransferParams(groupId: string, t: TransferRow): Record<string, string> {
  return {
    groupId,
    fromUserId: t.from.id,
    toUserId: t.to.id,
    amount: String(t.amount),
    currency: t.currency,
  };
}

describe('WI-010 (mobile) · GroupBalancesTab.tsx "Record" direction, never swapped (T4)', () => {
  const anaToBob: SuggestionLike = {
    from: { id: 'ana' },
    to: { id: 'bob' },
    amount: 50000,
    currency: 'PKR',
  };

  it('T4a: simplifyDebts ON (suggestions/minimal-transfer-set list) — Record pushes fromUserId/toUserId straight from the suggestion, unswapped', () => {
    const rows = buildTransferRows(true, [anaToBob], []);
    expect(rows).toHaveLength(1);
    const params = buildRecordTransferParams('grp1', rows[0]);
    expect(params).toEqual({
      groupId: 'grp1',
      fromUserId: 'ana',
      toUserId: 'bob',
      amount: '50000',
      currency: 'PKR',
    });
  });

  it('T4b: simplifyDebts OFF (pairwise exact-debts list) — same unswapped direction contract', () => {
    const rows = buildTransferRows(false, [], [anaToBob]);
    expect(rows).toHaveLength(1);
    const params = buildRecordTransferParams('grp1', rows[0]);
    expect(params).toEqual({
      groupId: 'grp1',
      fromUserId: 'ana',
      toUserId: 'bob',
      amount: '50000',
      currency: 'PKR',
    });
  });

  it('T4c: simplifyDebts ON reads only from the suggestions list, never falls back to pairwise', () => {
    const decoy: SuggestionLike = { from: { id: 'carl' }, to: { id: 'dana' }, amount: 999, currency: 'USD' };
    const rows = buildTransferRows(true, [anaToBob], [decoy]);
    expect(rows.map((r) => r.key)).toEqual(['PKR-ana-bob-0']);
  });

  it('T4d: simplifyDebts OFF reads only from the pairwise list, never falls back to suggestions', () => {
    const decoy: SuggestionLike = { from: { id: 'carl' }, to: { id: 'dana' }, amount: 999, currency: 'USD' };
    const rows = buildTransferRows(false, [decoy], [anaToBob]);
    expect(rows.map((r) => r.key)).toEqual(['PKR-ana-bob-0']);
  });
});
