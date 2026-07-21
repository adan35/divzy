// WI-012 (Test stage regression check, test-settlements) — investigates the risk the
// backend dev flagged in build-WI-012.md ("Not run / flagged for the next stage"):
// does a `suggestSettlements` (min-cash-flow, net-derived) transfer's (from, to, amount)
// triple always correspond to an actual `computePairwiseBalances` (as-incurred, bilateral)
// entry for that same pair? If not, WI-012's new `assertWithinOutstanding` bound — which
// looks up the request's exact (fromUserId, toUserId, currency) in the *pairwise* ledger —
// can reject a settlement that is a correct, already-suggested, safely-settleable transfer.
//
// This is written directly against the real `@divzy/shared` engine (no mocking of
// `computeNets`/`computePairwiseBalances`/`suggestSettlements`) so the constructed
// scenario is provably a genuine suggestion, not a fabricated request shape. Only
// Prisma is mocked, following the established harness pattern in
// `settlements.balance-bound.test.ts`.
//
// Scenario (3-member group "Trip" — ME, ANA, SAM):
//   Expense 1: ME pays $100, split so ANA owes ME $100 (pairwise: ANA -> ME 10000).
//   Expense 2: ANA pays $100, split so SAM owes ANA $100 (pairwise: SAM -> ANA 10000).
//   Nets: ME +10000, ANA 0 (paid 10000, owed 10000), SAM -10000.
//   suggestSettlements(nets) -> a single transfer SAM -> ME, amount 10000 (the whole
//   point of min-cash-flow simplification: avoid two transfers, SAM never has to pay
//   ANA and ANA never has to pay ME, when net positions allow collapsing to one hop).
//   computePairwiseBalances has NO entry at all for the SAM/ME pair — SAM and ME never
//   shared a direct expense or settlement; the debt is chain-mediated through ANA.
//
// Per charter's Definition of Done, "Suggestions, applied in full, settle every member
// to 0 ... never exceed n-1 transfers" is a standing invariant this domain must hold.
// "Applying a suggestion" necessarily means POSTing it through /settlements — if that
// POST now 400s, the invariant is broken by this work item for any 3+-member group with
// a debt chain (a common, not edge-case, shape), and the group's own "Record payment"
// one-tap button (`balances-view.tsx`) also becomes unusable for that suggestion (its
// client-side gate reads the same pairwise-only lookup on `useGroupBalances().pairwise`).
//
// EXPECTED (per the story/spec's design intent and the DoD invariant): 201 — the
// suggestion is a valid, real, safely-settleable transfer and should be accepted.
// If this test fails with the bound's 400 NO_OUTSTANDING_BALANCE, that is the defect:
// see defect-WI-012.md.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { computeNets, suggestSettlements } from '@divzy/shared';

const groupMemberFindManyMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const settlementCreateMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    groupMember: { findMany: (...args: unknown[]) => groupMemberFindManyMock(...args) },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: {
      findMany: (...args: unknown[]) => settlementFindManyMock(...args),
      create: (...args: unknown[]) => settlementCreateMock(...args),
    },
  },
}));

vi.mock('../src/lib/activity', () => ({ recordActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/lib/social', () => ({ ensureFriendshipsAmong: vi.fn().mockResolvedValue(undefined) }));

import { buildApp } from '../src/app';

let app: FastifyInstance;
let token: string;

const ME = 'user_me_0001'; // zId requires >= 8 chars
const ANA = 'user_ana_0001';
const SAM = 'user_sam_0001';
const GROUP = 'grp_trip_0001';

/** payerId paid `amount`; owerId's split is the full amount (a simple 1:1 debt), self-split 0. */
function expense(currency: string, amount: number, payerId: string, owerId: string) {
  return {
    currency,
    payers: [{ userId: payerId, amount }],
    splits: [
      { userId: owerId, amount },
      { userId: payerId, amount: 0 },
    ],
  };
}

beforeEach(async () => {
  for (const m of [groupMemberFindManyMock, expenseFindManyMock, settlementFindManyMock, settlementCreateMock]) {
    m.mockReset();
  }
  groupMemberFindManyMock.mockResolvedValue([{ userId: ME }, { userId: ANA }, { userId: SAM }]);
  settlementCreateMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 's1',
    ...data,
    date: new Date(data.date as string),
    createdAt: new Date('2026-07-15T00:00:00.000Z'),
    deletedAt: null,
    fromUser: { id: data.fromUserId, name: 'From', avatarColor: '#111' },
    toUser: { id: data.toUserId, name: 'To', avatarColor: '#222' },
    createdBy: { id: ME, name: 'Me', avatarColor: '#111' },
  }));
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: ME });
});

afterEach(async () => {
  await app.close();
});

describe('WI-012 regression risk — suggestSettlements vs. computePairwiseBalances bound', () => {
  it('a chain-derived suggestion (SAM -> ME) has NO direct pairwise entry, even though it is a valid settle-up suggestion', () => {
    const expenses = [expense('USD', 10000, ME, ANA), expense('USD', 10000, ANA, SAM)];
    const nets = computeNets(expenses, []);
    const suggestions = suggestSettlements(nets);

    expect(suggestions).toEqual([{ fromUserId: SAM, toUserId: ME, amount: 10000, currency: 'USD' }]);
  });

  it('POSTing the group\'s own suggested settlement is accepted (DoD: suggestions must always be safely settleable)', async () => {
    const expenseRows = [expense('USD', 10000, ME, ANA), expense('USD', 10000, ANA, SAM)];
    expenseFindManyMock.mockResolvedValue(expenseRows);
    settlementFindManyMock.mockResolvedValue([]);

    // Derive the suggestion from the real engine, exactly as GET /groups/:id/balances
    // would (same loadGroupLedger-shaped rows), then submit it as the client's
    // "Record payment" one-tap action would.
    const nets = computeNets(expenseRows, []);
    const [suggestion] = suggestSettlements(nets);
    expect(suggestion).toBeDefined();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/settlements',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        groupId: GROUP,
        fromUserId: suggestion!.fromUserId,
        toUserId: suggestion!.toUserId,
        amount: suggestion!.amount,
        currency: suggestion!.currency,
        method: 'CASH',
        date: new Date('2026-07-15T00:00:00.000Z').toISOString(),
      },
    });

    // At the time this test was written (test-settlements, WI-012 Test stage), the
    // route rejects with 400 NO_OUTSTANDING_BALANCE here — documented as the defect
    // in defect-WI-012.md. Asserting the *desired* 201 outcome per the DoD invariant
    // means this test is expected to fail (red) until Build addresses the defect.
    expect(res.statusCode).toBe(201);
    expect(settlementCreateMock).toHaveBeenCalled();
  });
});
