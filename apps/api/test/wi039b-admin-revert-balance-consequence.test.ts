// WI-039b (settlements slice) — "An admin's revert correctly drops the
// settlement from all balance math" (story-WI-039b.md, Feature "DELETE
// /settlements/:settlementId — additive group-admin revert authz", final
// scenario). The spec/build docs justify this AC by a static code read
// (loadGroupLedger's unchanged `deletedAt: null` filter applies identically
// regardless of actor) rather than a runtime test — this file closes that
// gap with a real end-to-end drive: a non-party, active group ADMIN
// (Priya) calls the real DELETE route, then the real
// GET /groups/:groupId/balances route is re-driven against one shared
// in-memory store (same "module-level prisma mock + real route handlers"
// technique as wi046-1-cross-domain-deleted-group.test.ts), proving the
// reverted settlement stops contributing to nets — not merely asserting the
// query's `where` shape in isolation like wi039b-settlement-detail-admin-
// delete.test.ts already does for the DELETE call itself.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// zId requires >= 8 chars.
const GROUP_ID = 'group_goa_01';
const ANA = 'user_ana_001'; // paid the expense; owed nothing; receives the settlement
const SAM = 'user_sam_001'; // owes Ana from the expense; pays the settlement
const PRIYA = 'user_priya01'; // active ADMIN, not a party to the settlement
const SETTLEMENT_ID = 'settlement_01';

const userPublic = (id: string, name: string) => ({
  id,
  name,
  avatarColor: '#111111',
  avatarUrl: null,
});

interface MemberRow {
  groupId: string;
  userId: string;
  role: 'ADMIN' | 'MEMBER';
  leftAt: Date | null;
  joinedAt: Date;
  user: { id: string; name: string; avatarColor: string; avatarUrl: null };
}

let memberRows: MemberRow[];
let settlementRow: {
  id: string;
  groupId: string | null;
  fromUserId: string;
  toUserId: string;
  amount: number;
  currency: string;
  method: string;
  note: string | null;
  proofUrl: string | null;
  date: Date;
  createdById: string;
  deletedAt: Date | null;
  createdAt: Date;
  fromUser: ReturnType<typeof userPublic>;
  toUser: ReturnType<typeof userPublic>;
  createdBy: ReturnType<typeof userPublic>;
  group: { id: string; name: string; emoji: string } | null;
};

function resetStore() {
  memberRows = [
    {
      groupId: GROUP_ID,
      userId: ANA,
      role: 'MEMBER',
      leftAt: null,
      joinedAt: new Date('2026-01-01T00:00:00.000Z'),
      user: userPublic(ANA, 'Ana'),
    },
    {
      groupId: GROUP_ID,
      userId: SAM,
      role: 'MEMBER',
      leftAt: null,
      joinedAt: new Date('2026-01-01T00:00:00.000Z'),
      user: userPublic(SAM, 'Sam'),
    },
    {
      groupId: GROUP_ID,
      userId: PRIYA,
      role: 'ADMIN',
      leftAt: null,
      joinedAt: new Date('2026-01-01T00:00:00.000Z'),
      user: userPublic(PRIYA, 'Priya'),
    },
  ];
  settlementRow = {
    id: SETTLEMENT_ID,
    groupId: GROUP_ID,
    fromUserId: SAM, // Sam pays down Sam's debt to Ana
    toUserId: ANA,
    amount: 5000,
    currency: 'USD',
    method: 'CASH',
    note: null,
    proofUrl: null,
    date: new Date('2026-07-10T00:00:00.000Z'),
    createdById: SAM,
    deletedAt: null,
    createdAt: new Date('2026-07-10T00:00:00.000Z'),
    fromUser: userPublic(SAM, 'Sam'),
    toUser: userPublic(ANA, 'Ana'),
    createdBy: userPublic(SAM, 'Sam'),
    group: { id: GROUP_ID, name: 'Goa Trip', emoji: '🌴' },
  };
}

const userFindUniqueMock = vi.fn();
const groupMemberFindFirstMock = vi.fn();
const groupMemberFindManyMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const settlementFindFirstMock = vi.fn();
const settlementUpdateMock = vi.fn();
const exchangeRateCacheFindUniqueMock = vi.fn();
const exchangeRateCacheUpsertMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    groupMember: {
      findFirst: (...args: unknown[]) => groupMemberFindFirstMock(...args),
      findMany: (...args: unknown[]) => groupMemberFindManyMock(...args),
    },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: {
      findMany: (...args: unknown[]) => settlementFindManyMock(...args),
      findFirst: (...args: unknown[]) => settlementFindFirstMock(...args),
      update: (...args: unknown[]) => settlementUpdateMock(...args),
    },
    exchangeRateCache: {
      findUnique: (...args: unknown[]) => exchangeRateCacheFindUniqueMock(...args),
      upsert: (...args: unknown[]) => exchangeRateCacheUpsertMock(...args),
    },
  },
}));

vi.mock('../src/lib/activity', () => ({ recordActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/lib/social', () => ({ ensureFriendshipsAmong: vi.fn().mockResolvedValue(undefined) }));

import { buildApp } from '../src/app';

let app: FastifyInstance;
let priyaToken: string;

beforeEach(async () => {
  resetStore();
  vi.clearAllMocks();

  userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'USD' });
  // Fresh USD-base cache row — viewer currency equals the ledger's own
  // currency (USD) throughout, so every conversion is a same-currency
  // identity and the assertions below stay in native, unconverted amounts.
  exchangeRateCacheFindUniqueMock.mockResolvedValue({
    id: 'cache_wi039b',
    base: 'USD',
    rates: { USD: 1 },
    fetchedAt: new Date(),
  });

  // -- GET /groups/:groupId/balances' own membership check + member list --
  groupMemberFindFirstMock.mockImplementation(
    async ({ where }: { where: { groupId: string; userId: string; leftAt?: null } }) => {
      const row = memberRows.find((r) => r.groupId === where.groupId && r.userId === where.userId);
      if (!row) return null;
      if (where.leftAt === null && row.leftAt !== null) return null;
      return { id: `${row.groupId}_${row.userId}`, role: row.role };
    },
  );

  groupMemberFindManyMock.mockImplementation(async (args: Record<string, unknown>) => {
    const where = args.where as { groupId?: string; userId?: { in: string[] }; leftAt?: null };
    if (args.include) {
      // The balances route's own full member list — ALL memberships (no leftAt filter).
      return memberRows
        .filter((r) => r.groupId === where.groupId)
        .map((r) => ({
          userId: r.userId,
          role: r.role,
          leftAt: r.leftAt,
          joinedAt: r.joinedAt,
          user: r.user,
        }));
    }
    if (where.userId) {
      // loadDirectSettlementPool's sharedGroupCountOf membership rows.
      return memberRows
        .filter((r) => where.userId!.in.includes(r.userId))
        .map((r) => ({ userId: r.userId, groupId: r.groupId }));
    }
    // DELETE route's recordActivity recipientIds (`{ groupId, leftAt: null }`).
    return memberRows
      .filter((r) => r.groupId === where.groupId && r.leftAt === null)
      .map((r) => ({ userId: r.userId }));
  });

  // -- Ledger loads (loadGroupLedger + loadDirectSettlementPool) -----------
  expenseFindManyMock.mockResolvedValue([
    {
      currency: 'USD',
      payers: [{ userId: ANA, amount: 5000 }],
      splits: [
        { userId: SAM, amount: 5000 },
        { userId: ANA, amount: 0 },
      ],
    },
  ]);

  settlementFindManyMock.mockImplementation(async (args: Record<string, unknown>) => {
    const where = args.where as { groupId: string | null };
    if (where.groupId === null) return []; // loadDirectSettlementPool: no direct pool here
    if (settlementRow.groupId === where.groupId && settlementRow.deletedAt === null) {
      return [
        {
          currency: settlementRow.currency,
          fromUserId: settlementRow.fromUserId,
          toUserId: settlementRow.toUserId,
          amount: settlementRow.amount,
        },
      ];
    }
    return [];
  });

  // -- DELETE route's own lookup + mutation ---------------------------------
  settlementFindFirstMock.mockImplementation(async () =>
    settlementRow.deletedAt === null ? { ...settlementRow } : null,
  );
  settlementUpdateMock.mockImplementation(
    async ({ data }: { data: { deletedAt: Date } }) => {
      settlementRow = { ...settlementRow, deletedAt: data.deletedAt };
      return { ...settlementRow };
    },
  );

  app = await buildApp();
  await app.ready();
  priyaToken = app.jwt.sign({ sub: PRIYA });
});

afterEach(async () => {
  await app.close();
});

async function getGroupBalances() {
  return app.inject({
    method: 'GET',
    url: `/api/v1/groups/${GROUP_ID}/balances`,
    headers: { authorization: `Bearer ${priyaToken}` },
  });
}

async function adminDeleteSettlement() {
  return app.inject({
    method: 'DELETE',
    url: `/api/v1/settlements/${SETTLEMENT_ID}`,
    headers: { authorization: `Bearer ${priyaToken}` },
  });
}

function balancesFor(body: { members: Array<{ user: { id: string }; balances: unknown[] }> }, userId: string) {
  return body.members.find((m) => m.user.id === userId)?.balances;
}

describe('WI-039b — an admin revert correctly drops the settlement from all balance math', () => {
  it('baseline: with the settlement live, Ana and Sam are fully settled (net zero, empty balances)', async () => {
    const res = await getGroupBalances();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(balancesFor(body, ANA)).toEqual([]);
    expect(balancesFor(body, SAM)).toEqual([]);
  });

  it('Priya (active admin, non-party) can revert the settlement (204)', async () => {
    const res = await adminDeleteSettlement();
    expect(res.statusCode).toBe(204);
    expect(settlementRow.deletedAt).not.toBeNull();
  });

  it('after Priya reverts it, GET /groups/:groupId/balances no longer folds it into either party\'s net — identical to a party-initiated delete', async () => {
    const del = await adminDeleteSettlement();
    expect(del.statusCode).toBe(204);

    const res = await getGroupBalances();
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // The underlying expense (Sam owes Ana 5000 USD) is unaffected and, with
    // the settlement gone, is fully exposed again — exactly the pre-
    // settlement balance, proving the reverted settlement contributes
    // nothing to the net.
    expect(balancesFor(body, ANA)).toEqual([{ currency: 'USD', amount: 5000 }]);
    expect(balancesFor(body, SAM)).toEqual([{ currency: 'USD', amount: -5000 }]);

    // Also holds for the pairwise view and the settle-up suggestion the
    // engine would now (re-)generate — not just the per-member net.
    expect(body.pairwise).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: 'USD',
          amount: 5000,
          from: expect.objectContaining({ id: SAM }),
          to: expect.objectContaining({ id: ANA }),
        }),
      ]),
    );
  });

  it('reverting again (already-deleted) still 404s — the admin path does not create a double-delete/negative-balance risk', async () => {
    const first = await adminDeleteSettlement();
    expect(first.statusCode).toBe(204);

    const second = await adminDeleteSettlement();
    expect(second.statusCode).toBe(404);

    // Idempotent: balances after the (rejected) second delete attempt are
    // unchanged from after the first.
    const res = await getGroupBalances();
    const body = res.json();
    expect(balancesFor(body, ANA)).toEqual([{ currency: 'USD', amount: 5000 }]);
    expect(balancesFor(body, SAM)).toEqual([{ currency: 'USD', amount: -5000 }]);
  });
});
