// Test-stage independent verification of ADR-011 / spec-WI-013's "Key
// decision" section — written directly from the ADR's own worked
// counterexample and story-WI-013's AC ("each row has its own 'Record
// payment' action ... exactly as the simplified suggestions already work
// today"), NOT copied from Build's own
// `settlements.balance-bound.test.ts` fixture (different member names/roles,
// a 4th uninvolved member, and an explicit non-group-scope-unchanged case
// Build's ADR-011 block didn't include). Per this domain's
// symmetric-fixture-blind-spot lesson, every accept/reject pair below drives
// netCeiling and bilateral to different magnitudes so the test can actually
// distinguish `max(netCeiling, bilateral)` from a single-operand
// implementation, not just "some bound exists".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const userFindUniqueMock = vi.fn();
const groupMemberFindManyMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const settlementCreateMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    groupMember: { findMany: (...args: unknown[]) => groupMemberFindManyMock(...args) },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: {
      findMany: (...args: unknown[]) => settlementFindManyMock(...args),
      create: (...args: unknown[]) => settlementCreateMock(...args),
    },
  },
}));

vi.mock('../src/lib/activity', () => ({ recordActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/lib/social', () => ({
  ensureFriendshipsAmong: vi.fn().mockResolvedValue(undefined),
}));

import { buildApp } from '../src/app';

let app: FastifyInstance;

const ME = 'user_me_001'; // zId requires >= 8 chars
const DEV = 'user_dev_001';
const SAM = 'user_sam_001';
const PAT = 'user_pat_001'; // uninvolved 4th member — never referenced by any settlement request
const GROUP = 'group_roomies_1';

function freshSettlement(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 's1',
    groupId: GROUP,
    fromUserId: ME,
    toUserId: DEV,
    amount: 100,
    currency: 'USD',
    method: 'CASH',
    note: null,
    date: new Date('2026-07-16T00:00:00.000Z'),
    createdById: ME,
    deletedAt: null,
    createdAt: new Date('2026-07-16T00:00:00.000Z'),
    fromUser: { id: ME, name: 'Me', avatarColor: '#111' },
    toUser: { id: DEV, name: 'Dev', avatarColor: '#222' },
    createdBy: { id: ME, name: 'Me', avatarColor: '#111' },
    ...overrides,
  };
}

/** payerId paid `amount`; owerId's split is the full amount (a simple 1:1 debt). */
function expense(
  currency: string,
  amount: number,
  payerId: string,
  owerId: string,
  groupId: string | null,
) {
  return {
    groupId,
    currency,
    payers: [{ userId: payerId, amount }],
    splits: [
      { userId: owerId, amount },
      { userId: payerId, amount: 0 },
    ],
  };
}

function post(token: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/settlements',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      currency: 'USD',
      method: 'CASH',
      date: new Date('2026-07-16T00:00:00.000Z').toISOString(),
      ...body,
    },
  });
}

// Chain fixture (own construction, per this file's own reasoning — not a
// re-derivation of Build's ANA/THIRD names):
//   Expense A: DEV pays 300, ME owes DEV 300 -> pairwise ME->DEV 300.
//   Expense B: ME pays 300, SAM owes ME 300  -> pairwise SAM->ME 300.
// Combined nets: ME = 0 (−300 + 300), DEV = +300, SAM = −300 (zero-sum).
// netCeiling(ME->DEV)  = netME(0) not < 0            -> 0.
// bilateral(ME->DEV)   = 300 (the real, incurred debt) -> max(0, 300) = 300.
// netCeiling(SAM->DEV) = min(-netSAM, netDEV) = min(300, 300) -> 300.
// bilateral(SAM->DEV)  = 0 (no direct expense between SAM and DEV)   -> max(300, 0) = 300.
function chainExpenses() {
  return [expense('USD', 30000, DEV, ME, GROUP), expense('USD', 30000, ME, SAM, GROUP)];
}

function threeMembers() {
  groupMemberFindManyMock.mockResolvedValue([
    { userId: ME },
    { userId: DEV },
    { userId: SAM },
    { userId: PAT },
  ]);
}

beforeEach(async () => {
  for (const m of [
    userFindUniqueMock,
    groupMemberFindManyMock,
    expenseFindManyMock,
    settlementFindManyMock,
    settlementCreateMock,
  ]) {
    m.mockReset();
  }
  settlementCreateMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    freshSettlement(data),
  );
  settlementFindManyMock.mockResolvedValue([]);
  app = await buildApp();
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('POST /api/v1/settlements — ADR-011 independent verification (WI-013 "each row has its own Record payment action")', () => {
  it('accepts the exact bilateral debt (300) that a netCeiling-only bound would wrongly reject (netCeiling=0)', async () => {
    threeMembers();
    expenseFindManyMock.mockResolvedValue(chainExpenses());
    const token = app.jwt.sign({ sub: ME });

    const res = await post(token, { groupId: GROUP, fromUserId: ME, toUserId: DEV, amount: 30000 });

    expect(res.statusCode).toBe(201);
    expect(settlementCreateMock).toHaveBeenCalledTimes(1);
  });

  it('rejects one unit over the bilateral debt, naming the correct 300.00 bound (not a stale 0.00 or an unrelated operand)', async () => {
    threeMembers();
    expenseFindManyMock.mockResolvedValue(chainExpenses());
    const token = app.jwt.sign({ sub: ME });

    const res = await post(token, { groupId: GROUP, fromUserId: ME, toUserId: DEV, amount: 30001 });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('EXCEEDS_BALANCE');
    // Negative assertion: the message must name the real widened bound
    // (300.00) exactly, never the old netCeiling-only value ($0.00) — this
    // is what actually catches a single-operand (netCeiling-only or
    // bilateral-only) regression rather than merely proving *some*
    // rejection occurs. ("300.00" trivially substring-contains "0.00", so
    // the negative check must target the distinguishing "$0.00" form.)
    expect(body.message).toBe('Only $300.00 is outstanding');
    expect(body.message).not.toContain('$0.00');
    expect(settlementCreateMock).not.toHaveBeenCalled();
  });

  it('accepts a chain-derived transfer with NO bilateral entry (SAM->DEV) via netCeiling alone — the union is a superset, not bilateral-only', async () => {
    threeMembers();
    expenseFindManyMock.mockResolvedValue(chainExpenses());
    const token = app.jwt.sign({ sub: SAM });

    const res = await post(token, { groupId: GROUP, fromUserId: SAM, toUserId: DEV, amount: 30000 });

    expect(res.statusCode).toBe(201);
  });

  it('still rejects a genuinely settled/unrelated pair (PAT, who has no expenses at all) with NO_OUTSTANDING_BALANCE', async () => {
    threeMembers();
    expenseFindManyMock.mockResolvedValue(chainExpenses());
    const token = app.jwt.sign({ sub: PAT });

    const res = await post(token, { groupId: GROUP, fromUserId: PAT, toUserId: DEV, amount: 100 });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('NO_OUTSTANDING_BALANCE');
    expect(settlementCreateMock).not.toHaveBeenCalled();
  });

  it('non-group (friend) scope is unaffected by ADR-011 — still bilateral-only, still rejects over-bilateral', async () => {
    userFindUniqueMock.mockResolvedValue({ id: DEV });
    expenseFindManyMock.mockResolvedValue([expense('USD', 5000, DEV, ME, null)]);
    const token = app.jwt.sign({ sub: ME });

    const accept = await post(token, { fromUserId: ME, toUserId: DEV, amount: 5000 });
    expect(accept.statusCode).toBe(201);

    settlementCreateMock.mockClear();
    const reject = await post(token, { fromUserId: ME, toUserId: DEV, amount: 5001 });
    expect(reject.statusCode).toBe(400);
    expect(reject.json().code).toBe('EXCEEDS_BALANCE');
    expect(settlementCreateMock).not.toHaveBeenCalled();
  });
});
