// WI-052 — POST /groups/:groupId/leave and DELETE /groups/:groupId/members/:userId
// 409 OUTSTANDING_BALANCE now names the specific counterparty and amount
// (buildOutstandingBalanceMessage, spec-WI-052 D1-D4). Written directly from
// story-WI-052.md's Gherkin scenarios, not from the implementation. Mirrors
// the top-level vi.fn()/vi.mock('../src/lib/prisma', ...)/buildApp()/
// app.inject(...) convention established by wi046-delete-group.test.ts and
// wi027-unarchive.test.ts (both routes live in the same groups.ts file).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { formatMoney } from '@divzy/shared';

const groupMemberFindFirstMock = vi.fn();
// Serves three distinct call shapes in groups.ts, all routed through this one
// mock (matching this file's mocking convention, not discriminated further
// unless a specific test needs to): (1) deactivateMembership's tx-scoped
// "remaining members" lookup (needs `role`), (2) removeMemberFlow's final
// recipient-id lookup (needs `userId`), (3) buildOutstandingBalanceMessage's
// debtor/creditor name lookup (needs `userId` + `user.{name}`). Individual
// tests override with a precise implementation when the message content is
// under test.
const groupMemberFindManyMock = vi.fn();
const groupMemberUpdateMock = vi.fn();
const groupFindUniqueMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();

const txMock = {
  groupMember: {
    update: (...args: unknown[]) => groupMemberUpdateMock(...args),
    findMany: (...args: unknown[]) => groupMemberFindManyMock(...args),
  },
};

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    groupMember: {
      findFirst: (...args: unknown[]) => groupMemberFindFirstMock(...args),
      findMany: (...args: unknown[]) => groupMemberFindManyMock(...args),
      update: (...args: unknown[]) => groupMemberUpdateMock(...args),
    },
    group: { findUnique: (...args: unknown[]) => groupFindUniqueMock(...args) },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: { findMany: (...args: unknown[]) => settlementFindManyMock(...args) },
    $transaction: (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock),
  },
}));

const recordActivityMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/lib/activity', () => ({
  recordActivity: (...args: unknown[]) => recordActivityMock(...args),
}));

import { buildApp } from '../src/app';

let app: FastifyInstance;

const GROUP_ID = 'group_0000001';
const ME_ID = 'user_me000001';
const ADMIN_ID = 'user_admin001';
const BEA_ID = 'user_bea000001';
const ALEX_ID = 'user_alex00001';
const CHRIS_ID = 'user_chris0001';
const DANA_ID = 'user_dana00001';

function user(id: string, name: string) {
  return { id, name, avatarColor: '#111', avatarUrl: null };
}

/** publicUserSelect-shaped rows for buildOutstandingBalanceMessage's name lookup. */
function memberNameRows(entries: Array<[string, string]>) {
  return entries.map(([id, name]) => ({ userId: id, user: user(id, name) }));
}

/** A single-payer expense: `payerId` paid `amount`, `debtorId` owes the full amount. */
function expense(currency: string, payerId: string, debtorId: string, amount: number) {
  return {
    currency,
    payers: [{ userId: payerId, amount }],
    splits: [
      { userId: debtorId, amount },
      { userId: payerId, amount: 0 },
    ],
  };
}

/** The caller's own active-membership row (assertActiveMember/assertAdmin gate). */
function actorMembership(role: 'ADMIN' | 'MEMBER' = 'MEMBER') {
  return { id: 'gm_actor', groupId: GROUP_ID, userId: ME_ID, role, leftAt: null };
}

/** The target member's row, as returned by removeMemberFlow's own findFirst+include lookup. */
function targetRow(userId: string, name: string) {
  return {
    id: `gm_${userId}`,
    groupId: GROUP_ID,
    userId,
    leftAt: null,
    user: user(userId, name),
    group: { name: 'Roomies' },
  };
}

beforeEach(async () => {
  groupMemberFindFirstMock.mockReset();
  groupMemberFindManyMock.mockReset();
  groupMemberUpdateMock.mockReset();
  groupFindUniqueMock.mockReset();
  expenseFindManyMock.mockReset();
  settlementFindManyMock.mockReset();
  settlementFindManyMock.mockResolvedValue([]);
  // Default: harmless for both the tx-scoped "remaining members after leave"
  // check (has role: ADMIN, so no LAST_ADMIN promotion write happens) and the
  // final recipient-id lookup (has userId). Tests targeting message content
  // override this with a precise implementation.
  groupMemberFindManyMock.mockResolvedValue([
    { id: 'gm_admin', userId: ADMIN_ID, role: 'ADMIN', user: user(ADMIN_ID, 'Admin') },
  ]);
  recordActivityMock.mockClear();
  app = await buildApp();
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('POST /api/v1/groups/:groupId/leave — outstanding balance message (story-WI-052)', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/groups/${GROUP_ID}/leave` });
    expect(res.statusCode).toBe(401);
  });

  it('gate condition unchanged: no 409 when net is zero in every currency', async () => {
    // Two calls to groupMember.findFirst happen for self-leave: the actor's
    // own active-membership check (no `include`), then the target-row lookup
    // (has `include`) inside removeMemberFlow — both must resolve to a live
    // membership for a settled leave to succeed.
    groupMemberFindFirstMock.mockImplementation(async (args: { include?: unknown }) =>
      args.include ? targetRow(ME_ID, 'Me') : actorMembership('MEMBER'),
    );
    expenseFindManyMock.mockResolvedValue([]); // fully settled — no expenses, no settlements

    const token = app.jwt.sign({ sub: ME_ID });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/leave`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
  });

  it('self-leave, single counterparty, one currency: 409 names the debtor first, then the creditor, with formatMoney amount', async () => {
    groupMemberFindFirstMock.mockImplementation(async (args: { include?: unknown }) =>
      args.include ? targetRow(ME_ID, 'Me') : actorMembership('MEMBER'),
    );
    // I owe Bea 4250 minor units (USD) — I paid nothing, Bea paid, I'm the split.
    expenseFindManyMock.mockResolvedValue([expense('USD', BEA_ID, ME_ID, 4250)]);
    groupMemberFindManyMock.mockResolvedValue(memberNameRows([[ME_ID, 'Me'], [BEA_ID, 'Bea']]));

    const token = app.jwt.sign({ sub: ME_ID });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/leave`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('OUTSTANDING_BALANCE');
    const message = res.json().message as string;
    expect(message).toBe(
      `Me still owes Bea ${formatMoney(4250, 'USD')} in this group — settle up first`,
    );
    expect(message.startsWith('Me')).toBe(true); // starts with a person's name, not "This member"
    expect(message).not.toContain('This member');
  });

  it('direction of the debt is reflected correctly when the leaving member is owed money instead', async () => {
    groupMemberFindFirstMock.mockImplementation(async (args: { include?: unknown }) =>
      args.include ? targetRow(ME_ID, 'Me') : actorMembership('MEMBER'),
    );
    // Bea owes me 4250 — I paid, Bea's split is the full amount.
    expenseFindManyMock.mockResolvedValue([expense('USD', ME_ID, BEA_ID, 4250)]);
    groupMemberFindManyMock.mockResolvedValue(memberNameRows([[ME_ID, 'Me'], [BEA_ID, 'Bea']]));

    const token = app.jwt.sign({ sub: ME_ID });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/leave`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
    const message = res.json().message as string;
    // Bea is the debtor, "Me" the creditor — never asserts the wrong direction.
    expect(message).toBe(
      `Bea still owes Me ${formatMoney(4250, 'USD')} in this group — settle up first`,
    );
  });

  it('multiple counterparties: names the largest, discloses the rest by count, never silently drops them', async () => {
    groupMemberFindFirstMock.mockImplementation(async (args: { include?: unknown }) =>
      args.include ? targetRow(ME_ID, 'Me') : actorMembership('MEMBER'),
    );
    expenseFindManyMock.mockResolvedValue([
      expense('USD', ALEX_ID, ME_ID, 500),
      expense('USD', BEA_ID, ME_ID, 4200),
      expense('USD', CHRIS_ID, ME_ID, 100),
    ]);
    groupMemberFindManyMock.mockResolvedValue(
      memberNameRows([
        [ME_ID, 'Me'],
        [ALEX_ID, 'Alex'],
        [BEA_ID, 'Bea'],
        [CHRIS_ID, 'Chris'],
      ]),
    );

    const token = app.jwt.sign({ sub: ME_ID });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/leave`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
    const message = res.json().message as string;
    expect(message).toContain(`Bea ${formatMoney(4200, 'USD')}`); // largest named
    expect(message).toContain('(and 2 other outstanding balances in this group)');
    expect(message).not.toContain('Alex');
    expect(message).not.toContain('Chris');
  });

  it('multiple currencies: selects "largest" by native minor-unit amount, never cross-currency converted', async () => {
    groupMemberFindFirstMock.mockImplementation(async (args: { include?: unknown }) =>
      args.include ? targetRow(ME_ID, 'Me') : actorMembership('MEMBER'),
    );
    // 10000 JPY with Alex vs 5000 (i.e. $50.00) USD with Bea — 10000 > 5000
    // as raw minor-unit amounts, so Alex's JPY entry must win, even though
    // $50.00 USD would be the larger real-world value if ever converted
    // (which this feature must never do — ARCH invariant 5).
    expenseFindManyMock.mockResolvedValue([
      expense('JPY', ALEX_ID, ME_ID, 10000),
      expense('USD', BEA_ID, ME_ID, 5000),
    ]);
    groupMemberFindManyMock.mockResolvedValue(
      memberNameRows([[ME_ID, 'Me'], [ALEX_ID, 'Alex'], [BEA_ID, 'Bea']]),
    );

    const token = app.jwt.sign({ sub: ME_ID });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/leave`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
    const message = res.json().message as string;
    expect(message).toContain(`Alex ${formatMoney(10000, 'JPY')}`);
    expect(message).toContain('(and 1 other outstanding balance in this group)');
    expect(message).not.toContain('Bea');
  });

  it('amount formatting uses the shared formatMoney helper, never raw minor units or a bare currency code', async () => {
    groupMemberFindFirstMock.mockImplementation(async (args: { include?: unknown }) =>
      args.include ? targetRow(ME_ID, 'Me') : actorMembership('MEMBER'),
    );
    expenseFindManyMock.mockResolvedValue([expense('USD', BEA_ID, ME_ID, 4250)]);
    groupMemberFindManyMock.mockResolvedValue(memberNameRows([[ME_ID, 'Me'], [BEA_ID, 'Bea']]));

    const token = app.jwt.sign({ sub: ME_ID });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/leave`,
      headers: { authorization: `Bearer ${token}` },
    });

    const message = res.json().message as string;
    expect(message).toContain('$42.50');
    expect(message).not.toContain('4250');
    expect(message).not.toMatch(/\bUSD\b/);
  });
});

describe('DELETE /api/v1/groups/:groupId/members/:userId — admin removal (story-WI-052)', () => {
  it('names the target member and counterparty specifically — never the admin actor', async () => {
    // Admin removes Chris; actor-role check (no include) always answers as
    // the calling admin; the target-row lookup (include) answers as Chris.
    groupMemberFindFirstMock.mockImplementation(async (args: { include?: unknown }) =>
      args.include ? targetRow(CHRIS_ID, 'Chris') : actorMembership('ADMIN'),
    );
    // Chris owes Dana 1200 minor units in the group's currency.
    expenseFindManyMock.mockResolvedValue([expense('USD', DANA_ID, CHRIS_ID, 1200)]);
    groupMemberFindManyMock.mockResolvedValue(
      memberNameRows([
        [CHRIS_ID, 'Chris'],
        [DANA_ID, 'Dana'],
        [ADMIN_ID, 'AdminUser'],
      ]),
    );

    const token = app.jwt.sign({ sub: ADMIN_ID });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/groups/${GROUP_ID}/members/${CHRIS_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('OUTSTANDING_BALANCE');
    const message = res.json().message as string;
    expect(message).toBe(
      `Chris still owes Dana ${formatMoney(1200, 'USD')} in this group — settle up first`,
    );
    expect(message).not.toContain('AdminUser'); // the admin actor is never named as a party
  });

  it('non-admin actor removing someone else still 403s before the balance gate ever runs (regression: auth unchanged)', async () => {
    groupMemberFindFirstMock.mockImplementation(async (args: { include?: unknown }) =>
      args.include ? targetRow(CHRIS_ID, 'Chris') : actorMembership('MEMBER'),
    );

    const token = app.jwt.sign({ sub: ME_ID });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/groups/${GROUP_ID}/members/${CHRIS_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
    expect(expenseFindManyMock).not.toHaveBeenCalled(); // never reached the ledger/gate
  });
});
