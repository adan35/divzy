// WI-012 — bound POST /settlements to the real per-currency directional
// outstanding balance. Written directly from spec-WI-012.md's "Validation
// rule" + "Ledger scope" sections and story-WI-012's Gherkin AC (TDD: these
// scenarios were run red against the pre-fix route — no bound check, every
// case here returned 201 — before `assertWithinOutstanding` was added to
// settlements.ts).
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
vi.mock('../src/lib/social', () => ({ ensureFriendshipsAmong: vi.fn().mockResolvedValue(undefined) }));

import { buildApp } from '../src/app';

let app: FastifyInstance;
let token: string;

const ME = 'user_me_001'; // zId requires >= 8 chars
const ANA = 'user_ana_001';

function freshSettlement(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 's1',
    groupId: null,
    fromUserId: ME,
    toUserId: ANA,
    amount: 100,
    currency: 'USD',
    method: 'CASH',
    note: null,
    date: new Date('2026-07-15T00:00:00.000Z'),
    createdById: ME,
    deletedAt: null,
    createdAt: new Date('2026-07-15T00:00:00.000Z'),
    fromUser: { id: ME, name: 'Me', avatarColor: '#111' },
    toUser: { id: ANA, name: 'Ana', avatarColor: '#222' },
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
  groupId: string | null = null,
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

function postSettlement(body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/settlements',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      fromUserId: ME,
      toUserId: ANA,
      amount: 100,
      currency: 'USD',
      method: 'CASH',
      date: new Date('2026-07-15T00:00:00.000Z').toISOString(),
      ...body,
    },
  });
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
  userFindUniqueMock.mockResolvedValue({ id: ANA }); // counterpart exists, non-group path
  settlementCreateMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    freshSettlement(data),
  );
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: ME });
});

afterEach(async () => {
  await app.close();
});

describe('POST /api/v1/settlements — WI-012 balance bound (non-group)', () => {
  it('rejects a settlement when the pair has zero outstanding balance', async () => {
    expenseFindManyMock.mockResolvedValue([]);
    settlementFindManyMock.mockResolvedValue([]);

    const res = await postSettlement({ fromUserId: ANA, toUserId: ME, amount: 100, currency: 'USD' });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('NO_OUTSTANDING_BALANCE');
    expect(res.json().message).not.toContain('in this group');
    expect(settlementCreateMock).not.toHaveBeenCalled();
  });

  it('exceeds-balance: rejects when amount > the real directional debt', async () => {
    // ANA paid, ME owes ANA 3500 -> pairwise { from: ME, to: ANA, amount: 3500 }.
    expenseFindManyMock.mockResolvedValue([expense('USD', 3500, ANA, ME)]);
    settlementFindManyMock.mockResolvedValue([]);

    const res = await postSettlement({ fromUserId: ME, toUserId: ANA, amount: 4000, currency: 'USD' });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('EXCEEDS_BALANCE');
    expect(res.json().message).toContain('35.00');
    expect(settlementCreateMock).not.toHaveBeenCalled();
  });

  it('exact-boundary accept: amount === real outstanding debt is a full payoff, allowed', async () => {
    expenseFindManyMock.mockResolvedValue([expense('USD', 3500, ANA, ME)]);
    settlementFindManyMock.mockResolvedValue([]);

    const res = await postSettlement({ fromUserId: ME, toUserId: ANA, amount: 3500, currency: 'USD' });

    expect(res.statusCode).toBe(201);
    expect(settlementCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 3500, currency: 'USD' }) }),
    );
  });

  it('Worked example N1: non-group bound aggregates across contexts (group expense + direct expense)', async () => {
    // ANA owes ME USD 20 via a group expense + USD 15 via a direct expense = USD 35 combined,
    // matching what GET /balance already aggregates for the pair.
    expenseFindManyMock.mockResolvedValue([
      expense('USD', 2000, ME, ANA, 'grp_roomies'),
      expense('USD', 1500, ME, ANA, null),
    ]);
    settlementFindManyMock.mockResolvedValue([]);

    const res = await postSettlement({ fromUserId: ANA, toUserId: ME, amount: 3500, currency: 'USD' });

    expect(res.statusCode).toBe(201);
  });

  it('Worked example N2 (ARCH invariant 5): per-currency reject even though a converted figure would cover it', async () => {
    // The only real debt is USD 50000 (ANA owes ME). A EUR settlement request
    // must reject NO_OUTSTANDING_BALANCE without ever reading a converted figure —
    // no rates/conversion mock is even wired up in this test, proving it's unused.
    expenseFindManyMock.mockResolvedValue([expense('USD', 50000, ME, ANA)]);
    settlementFindManyMock.mockResolvedValue([]);

    const res = await postSettlement({ fromUserId: ANA, toUserId: ME, amount: 40000, currency: 'EUR' });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('NO_OUTSTANDING_BALANCE');
    expect(settlementCreateMock).not.toHaveBeenCalled();
  });

  it('wrong-direction reject: creditor named as payer', async () => {
    // ANA owes ME 5000 (ME paid, ANA's split). Request names ME as payer — wrong direction.
    expenseFindManyMock.mockResolvedValue([expense('USD', 5000, ME, ANA)]);
    settlementFindManyMock.mockResolvedValue([]);

    const res = await postSettlement({ fromUserId: ME, toUserId: ANA, amount: 1000, currency: 'USD' });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('NO_OUTSTANDING_BALANCE');
  });

  it('soft-deleted rows are excluded from the bound (deletedAt: null filter enforced in the query)', async () => {
    expenseFindManyMock.mockResolvedValue([]);
    settlementFindManyMock.mockResolvedValue([]);

    const res = await postSettlement({ fromUserId: ANA, toUserId: ME, amount: 100, currency: 'USD' });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('NO_OUTSTANDING_BALANCE');
    expect(expenseFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
    expect(settlementFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });
});

describe('POST /api/v1/settlements — WI-012 balance bound (group-scoped)', () => {
  const GROUP = 'grp_trip001';

  function mockGroupMembers() {
    groupMemberFindManyMock.mockResolvedValue([{ userId: ME }, { userId: ANA }]);
  }

  it('rejects a settlement when the group has zero outstanding balance', async () => {
    mockGroupMembers();
    expenseFindManyMock.mockResolvedValue([]);
    settlementFindManyMock.mockResolvedValue([]);

    const res = await postSettlement({
      groupId: GROUP,
      fromUserId: ANA,
      toUserId: ME,
      amount: 100,
      currency: 'USD',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('NO_OUTSTANDING_BALANCE');
    expect(res.json().message).toContain('in this group');
  });

  it('exceeds-balance: rejects when amount exceeds that group\'s own debt', async () => {
    mockGroupMembers();
    expenseFindManyMock.mockResolvedValue([expense('PKR', 50000, ME, ANA, GROUP)]); // ANA owes ME 500.00 PKR
    settlementFindManyMock.mockResolvedValue([]);

    const res = await postSettlement({
      groupId: GROUP,
      fromUserId: ANA,
      toUserId: ME,
      amount: 60000,
      currency: 'PKR',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('EXCEEDS_BALANCE');
    expect(settlementCreateMock).not.toHaveBeenCalled();
  });

  it('exact-boundary accept: amount === group debt (group-scoped)', async () => {
    mockGroupMembers();
    expenseFindManyMock.mockResolvedValue([expense('PKR', 50000, ME, ANA, GROUP)]);
    settlementFindManyMock.mockResolvedValue([]);

    const res = await postSettlement({
      groupId: GROUP,
      fromUserId: ANA,
      toUserId: ME,
      amount: 50000,
      currency: 'PKR',
    });

    expect(res.statusCode).toBe(201);
  });

  it("Worked example G1: group bound uses ONLY the target group's own ledger, not the pair's other shared group", async () => {
    mockGroupMembers();
    // The route loads Trip's own ledger only (loadGroupLedger(GROUP)) — Home's
    // separate PKR 300 debt is never queried for this groupId-scoped request,
    // so the mock only needs to reflect Trip's PKR 500.
    expenseFindManyMock.mockResolvedValue([expense('PKR', 50000, ME, ANA, GROUP)]); // Trip: ANA owes ME 500.00
    settlementFindManyMock.mockResolvedValue([]);

    const over = await postSettlement({
      groupId: GROUP,
      fromUserId: ANA,
      toUserId: ME,
      amount: 80000,
      currency: 'PKR',
    });
    expect(over.statusCode).toBe(400);
    expect(over.json().code).toBe('EXCEEDS_BALANCE');

    const exact = await postSettlement({
      groupId: GROUP,
      fromUserId: ANA,
      toUserId: ME,
      amount: 50000,
      currency: 'PKR',
    });
    expect(exact.statusCode).toBe(201);

    expect(expenseFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ groupId: GROUP }) }),
    );
  });

  it('soft-deleted rows excluded from the group bound (deletedAt: null filter enforced in the query)', async () => {
    mockGroupMembers();
    expenseFindManyMock.mockResolvedValue([]);
    settlementFindManyMock.mockResolvedValue([]);

    const res = await postSettlement({
      groupId: GROUP,
      fromUserId: ANA,
      toUserId: ME,
      amount: 100,
      currency: 'USD',
    });

    expect(res.statusCode).toBe(400);
    expect(expenseFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ groupId: GROUP, deletedAt: null }) }),
    );
    expect(settlementFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ groupId: GROUP, deletedAt: null }) }),
    );
  });

  // Revision 2 (cycle 1, ADR-010) — group scope moved from bilateral pairwise
  // lookup to net-position reachability (defect-WI-012.md). The chain-accept
  // case itself is already covered end-to-end by
  // wi012-suggestion-bilateral-mismatch.test.ts; these three add the
  // remaining net-reachability edges (over-ceiling reject + wrong-side
  // reject) as permanent route-level coverage in the main bound suite.
  describe('net-position reachability (3-member chain)', () => {
    const SAM = 'user_sam_001';

    function mockThreeMembers() {
      groupMemberFindManyMock.mockResolvedValue([{ userId: ME }, { userId: ANA }, { userId: SAM }]);
    }

    // Chain: ANA owes ME 10000, SAM owes ANA 10000 -> nets ME +10000, ANA 0, SAM -10000.
    // suggestSettlements collapses this to a single SAM -> ME transfer with no
    // bilateral SAM/ME entry at all.
    function chainExpenses() {
      return [expense('USD', 10000, ME, ANA, GROUP), expense('USD', 10000, ANA, SAM, GROUP)];
    }

    it('accepts a chain-derived transfer that has no bilateral pairwise entry (net-reachable)', async () => {
      mockThreeMembers();
      expenseFindManyMock.mockResolvedValue(chainExpenses());
      settlementFindManyMock.mockResolvedValue([]);

      const res = await postSettlement({
        groupId: GROUP,
        fromUserId: SAM,
        toUserId: ME,
        amount: 10000,
        currency: 'USD',
      });

      expect(res.statusCode).toBe(201);
    });

    it('accepts a partial payment of a net-reachable chain transfer', async () => {
      mockThreeMembers();
      expenseFindManyMock.mockResolvedValue(chainExpenses());
      settlementFindManyMock.mockResolvedValue([]);

      const res = await postSettlement({
        groupId: GROUP,
        fromUserId: SAM,
        toUserId: ME,
        amount: 6000,
        currency: 'USD',
      });

      expect(res.statusCode).toBe(201);
    });

    it('rejects a chain-derived transfer exceeding min(-netP, netR) with EXCEEDS_BALANCE naming the ceiling', async () => {
      mockThreeMembers();
      expenseFindManyMock.mockResolvedValue(chainExpenses());
      settlementFindManyMock.mockResolvedValue([]);

      const res = await postSettlement({
        groupId: GROUP,
        fromUserId: SAM,
        toUserId: ME,
        amount: 10001,
        currency: 'USD',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('EXCEEDS_BALANCE');
      expect(res.json().message).toContain('100.00');
      expect(settlementCreateMock).not.toHaveBeenCalled();
    });

    it('rejects when the named payer is actually a net creditor (wrong side) with NO_OUTSTANDING_BALANCE', async () => {
      mockThreeMembers();
      expenseFindManyMock.mockResolvedValue(chainExpenses());
      settlementFindManyMock.mockResolvedValue([]);

      // ME nets +10000 (creditor) — naming ME as the payer to SAM is the wrong side.
      const res = await postSettlement({
        groupId: GROUP,
        fromUserId: ME,
        toUserId: SAM,
        amount: 100,
        currency: 'USD',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('NO_OUTSTANDING_BALANCE');
      expect(settlementCreateMock).not.toHaveBeenCalled();
    });
  });
});

// ADR-011 (WI-013) — the group-scoped bound widens from netCeiling alone to
// max(netCeiling, bilateral). Worked counterexample from the ADR: netCeiling
// can be *tighter* than a genuinely-owed bilateral debt in a 3-member chain,
// wrongly rejecting a debt the UI shows as owed. Written directly against the
// real @divzy/shared engine (only Prisma mocked), reusing this file's
// `expense()`/`postSettlement()` helpers — TDD: run red against the
// pre-ADR-011 route (netCeiling-only), where the first two cases below fail.
describe('POST /api/v1/settlements — ADR-011 (WI-013): group bound = max(netCeiling, bilateral)', () => {
  const GROUP = 'grp_trip001';
  const THIRD = 'user_cee_001';

  function mockThreeMembers() {
    groupMemberFindManyMock.mockResolvedValue([{ userId: ME }, { userId: ANA }, { userId: THIRD }]);
  }

  // Expense 1: ANA pays 100, ME owes ANA 100 -> pairwise ME->ANA 100.
  // Expense 2: ME pays 100, THIRD owes ME 100 -> pairwise THIRD->ME 100.
  // Combined nets: ME = 0, ANA = +100, THIRD = -100 (zero-sum).
  // netCeiling(ME->ANA) = (netME<0 && netANA>0) ? ... : 0 -- netME is 0, not <0, so 0.
  // bilateral(ME->ANA) = 100 -- the real, incurred debt. max(0, 100) = 100.
  function chainExpenses() {
    return [expense('USD', 10000, ANA, ME, GROUP), expense('USD', 10000, ME, THIRD, GROUP)];
  }

  it('accepts the exact bilateral debt even though netCeiling alone would reject it (ADR-011 chain counterexample)', async () => {
    mockThreeMembers();
    expenseFindManyMock.mockResolvedValue(chainExpenses());
    settlementFindManyMock.mockResolvedValue([]);

    const res = await postSettlement({
      groupId: GROUP,
      fromUserId: ME,
      toUserId: ANA,
      amount: 10000,
      currency: 'USD',
    });

    expect(res.statusCode).toBe(201);
  });

  it('still rejects one unit over the bilateral debt with EXCEEDS_BALANCE', async () => {
    mockThreeMembers();
    expenseFindManyMock.mockResolvedValue(chainExpenses());
    settlementFindManyMock.mockResolvedValue([]);

    const res = await postSettlement({
      groupId: GROUP,
      fromUserId: ME,
      toUserId: ANA,
      amount: 10001,
      currency: 'USD',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('EXCEEDS_BALANCE');
    expect(res.json().message).toContain('100.00');
    expect(settlementCreateMock).not.toHaveBeenCalled();
  });

  it('rejects a genuinely settled pair (no bilateral debt, wrong net direction) with NO_OUTSTANDING_BALANCE', async () => {
    mockThreeMembers();
    expenseFindManyMock.mockResolvedValue(chainExpenses());
    settlementFindManyMock.mockResolvedValue([]);

    // ANA and THIRD share no bilateral pairwise entry, and ANA's net (+100) is not
    // negative, so netCeiling(ANA->THIRD) = 0 and bilateral(ANA->THIRD) = 0 -> max = 0.
    // Caller must be a party (ANA or THIRD), not the default ME.
    token = app.jwt.sign({ sub: ANA });
    const res = await postSettlement({
      groupId: GROUP,
      fromUserId: ANA,
      toUserId: THIRD,
      amount: 100,
      currency: 'USD',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('NO_OUTSTANDING_BALANCE');
    expect(settlementCreateMock).not.toHaveBeenCalled();
  });

  it('a chain-derived transfer with no bilateral entry still accepts via netCeiling (superset, not a replacement)', async () => {
    mockThreeMembers();
    expenseFindManyMock.mockResolvedValue(chainExpenses());
    settlementFindManyMock.mockResolvedValue([]);

    // THIRD -> ANA has no bilateral entry (chain-mediated through ME), but is
    // net-reachable: netCeiling = min(-netTHIRD, netANA) = min(100, 100) = 100.
    // Caller must be a party (THIRD or ANA), not the default ME.
    token = app.jwt.sign({ sub: THIRD });
    const res = await postSettlement({
      groupId: GROUP,
      fromUserId: THIRD,
      toUserId: ANA,
      amount: 10000,
      currency: 'USD',
    });

    expect(res.statusCode).toBe(201);
  });
});
