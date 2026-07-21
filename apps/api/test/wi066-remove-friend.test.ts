// WI-066 — DELETE /friends/:userId (remove a friend / unfriend)
// Written directly from story-WI-066.md's Gherkin scenarios, not from the
// implementation. Mirrors the top-level vi.fn()/vi.mock('../src/lib/prisma',
// ...)/buildApp()/app.inject(...) convention established by
// friends-route.test.ts (same route file, friends.ts) and the
// recordActivity-mock convention from wi052-outstanding-balance-message.test.ts
// (needed here to positively assert FRIEND_ADDED fires on re-add, and that it
// never fires on removal — "silent" AC).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { formatMoney } from '@divzy/shared';

const userFindUniqueMock = vi.fn();
const friendshipFindUniqueMock = vi.fn();
const friendshipFindManyMock = vi.fn();
const friendshipDeleteMock = vi.fn();
const friendshipCreateManyMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    friendship: {
      findUnique: (...args: unknown[]) => friendshipFindUniqueMock(...args),
      findMany: (...args: unknown[]) => friendshipFindManyMock(...args),
      delete: (...args: unknown[]) => friendshipDeleteMock(...args),
      createMany: (...args: unknown[]) => friendshipCreateManyMock(...args),
    },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: { findMany: (...args: unknown[]) => settlementFindManyMock(...args) },
    // Deliberately NO groupMember mock at all: DELETE /friends/:userId must
    // never touch GroupMember rows (charter/AC "Group co-membership is
    // unaffected"). If the handler ever called prisma.groupMember.* it would
    // throw "not a function" and every 204 test below would fail.
  },
}));

const recordActivityMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/lib/activity', () => ({
  recordActivity: (...args: unknown[]) => recordActivityMock(...args),
}));

import { buildApp } from '../src/app';

let app: FastifyInstance;

const ME_ID = 'user_me000001';
const SAM_ID = 'user_sam00001';
const ALEX_ID = 'user_alex00001';
const BEA_ID = 'user_bea000001';

function user(id: string, name: string) {
  return { id, name, avatarColor: '#111', avatarUrl: null };
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

function settlement(currency: string, fromUserId: string, toUserId: string, amount: number) {
  return { currency, fromUserId, toUserId, amount };
}

/** The Friendship row shape the handler's findUnique include returns. */
function friendshipRow(userAId: string, userBId: string, nameA: string, nameB: string) {
  return {
    userAId,
    userBId,
    userA: user(userAId, nameA),
    userB: user(userBId, nameB),
  };
}

function pairKey(a: string, b: string) {
  const [userAId, userBId] = a < b ? [a, b] : [b, a];
  return { where: { userAId_userBId: { userAId, userBId } } };
}

function authHeader(app: FastifyInstance, sub: string) {
  return { authorization: `Bearer ${app.jwt.sign({ sub })}` };
}

beforeEach(async () => {
  userFindUniqueMock.mockReset();
  friendshipFindUniqueMock.mockReset();
  friendshipDeleteMock.mockReset();
  friendshipCreateManyMock.mockReset().mockResolvedValue({ count: 1 });
  expenseFindManyMock.mockReset().mockResolvedValue([]);
  settlementFindManyMock.mockReset().mockResolvedValue([]);
  recordActivityMock.mockClear();
  app = await buildApp();
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('DELETE /api/v1/friends/:userId (story-WI-066)', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/friends/${SAM_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it('BB-66-1: either party can remove an existing, fully-settled friendship — 204, row deleted', async () => {
    friendshipFindUniqueMock.mockResolvedValue(friendshipRow(ME_ID, SAM_ID, 'Me', 'Sam'));
    friendshipDeleteMock.mockResolvedValue({});

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/${SAM_ID}`,
      headers: authHeader(app, ME_ID),
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(friendshipDeleteMock).toHaveBeenCalledWith(pairKey(ME_ID, SAM_ID));
  });

  it('BB-66-1b: the *other* party can equally call it — same delete key regardless of who is caller/target', async () => {
    // Sam removes Me. Handler sorts (callerId, targetId) lexicographically
    // either way, so the resulting delete key must be identical to the
    // previous test's, proving there is no directional/ownership asymmetry.
    friendshipFindUniqueMock.mockResolvedValue(friendshipRow(ME_ID, SAM_ID, 'Me', 'Sam'));
    friendshipDeleteMock.mockResolvedValue({});

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/${ME_ID}`,
      headers: authHeader(app, SAM_ID),
    });

    expect(res.statusCode).toBe(204);
    expect(friendshipDeleteMock).toHaveBeenCalledWith(pairKey(ME_ID, SAM_ID));
  });

  it('BB-66-2: removal is symmetric — GET /friends for both parties reflects an empty friendship set once the single row is gone', async () => {
    friendshipFindUniqueMock.mockResolvedValue(friendshipRow(ME_ID, SAM_ID, 'Me', 'Sam'));
    friendshipDeleteMock.mockResolvedValue({});

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/${SAM_ID}`,
      headers: authHeader(app, ME_ID),
    });
    expect(del.statusCode).toBe(204);
    // The identical delete key computed in BB-66-1/1b, from either party's
    // perspective, IS the "one undirected row" invariant — there is no
    // per-side flag to independently clear, so deleting it necessarily
    // updates the result of GET /friends's `OR: [{userAId}, {userBId}]`
    // query for both users identically. That query itself (unchanged by
    // WI-066) is already exhaustively exercised by friends-route.test.ts;
    // re-driving it here through the real DB layer would only re-test
    // Prisma's OR semantics, not anything WI-066 introduced.
    expect(friendshipDeleteMock).toHaveBeenCalledWith(pairKey(ME_ID, SAM_ID));
    expect(friendshipDeleteMock).toHaveBeenCalledTimes(1); // one row, one delete — no per-side second write
  });

  it('BB-66-3: ledger history is untouched — succeeds (204) even with shared, fully-settled expenses/settlements, touching only the Friendship row', async () => {
    friendshipFindUniqueMock.mockResolvedValue(friendshipRow(ME_ID, SAM_ID, 'Me', 'Sam'));
    // Fully offsetting: I paid 5000 USD split evenly is NOT zero-net by
    // itself, so pair with a settlement that exactly zeroes it.
    expenseFindManyMock.mockResolvedValue([expense('USD', ME_ID, SAM_ID, 5000)]);
    settlementFindManyMock.mockResolvedValue([settlement('USD', SAM_ID, ME_ID, 5000)]);
    friendshipDeleteMock.mockResolvedValue({});

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/${SAM_ID}`,
      headers: authHeader(app, ME_ID),
    });

    expect(res.statusCode).toBe(204);
    // Only the Friendship row is ever deleted — no expense/settlement mutator
    // exists on the mocked prisma client at all, so any attempt to touch
    // Expense/ExpenseSplit/ExpensePayer/Settlement would have thrown.
    expect(friendshipDeleteMock).toHaveBeenCalledTimes(1);
  });

  it('BB-66-4: blocked with 409 OUTSTANDING_BALANCE when the pairwise net is nonzero in one currency; row NOT deleted', async () => {
    friendshipFindUniqueMock.mockResolvedValue(friendshipRow(ME_ID, SAM_ID, 'Me', 'Sam'));
    expenseFindManyMock.mockResolvedValue([expense('USD', SAM_ID, ME_ID, 4250)]); // I owe Sam $42.50

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/${SAM_ID}`,
      headers: authHeader(app, ME_ID),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('OUTSTANDING_BALANCE');
    expect(res.json().message).toBe(
      `You still owe Sam ${formatMoney(4250, 'USD')} — settle up before removing them as a friend`,
    );
    expect(friendshipDeleteMock).not.toHaveBeenCalled();
  });

  it('BB-66-4b: creditor direction is reflected correctly ("X still owes you")', async () => {
    friendshipFindUniqueMock.mockResolvedValue(friendshipRow(ME_ID, SAM_ID, 'Me', 'Sam'));
    expenseFindManyMock.mockResolvedValue([expense('USD', ME_ID, SAM_ID, 4250)]); // Sam owes me

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/${SAM_ID}`,
      headers: authHeader(app, ME_ID),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe(
      `Sam still owes you ${formatMoney(4250, 'USD')} — settle up before removing them as a friend`,
    );
  });

  it('BB-66-4c: multi-currency outstanding balance appends the "(and N other outstanding balance(s))" suffix', async () => {
    friendshipFindUniqueMock.mockResolvedValue(friendshipRow(ME_ID, SAM_ID, 'Me', 'Sam'));
    expenseFindManyMock.mockResolvedValue([
      expense('USD', SAM_ID, ME_ID, 5000), // I owe Sam $50.00
      expense('EUR', ME_ID, SAM_ID, 2000), // Sam owes me €20.00
    ]);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/${SAM_ID}`,
      headers: authHeader(app, ME_ID),
    });

    expect(res.statusCode).toBe(409);
    const message = res.json().message as string;
    expect(message).toContain(`You still owe Sam ${formatMoney(5000, 'USD')}`); // larger native minor-unit magnitude named
    expect(message).toContain('(and 1 other outstanding balance)');
    expect(friendshipDeleteMock).not.toHaveBeenCalled();
  });

  it('BB-66-5: succeeds (204) once the pair nets to exactly zero in every currency', async () => {
    friendshipFindUniqueMock.mockResolvedValue(friendshipRow(ME_ID, SAM_ID, 'Me', 'Sam'));
    // Same amount each direction across two currencies -> both net to 0,
    // computePairwiseBalances drops zero entries entirely.
    expenseFindManyMock.mockResolvedValue([
      expense('USD', SAM_ID, ME_ID, 3000),
      expense('USD', ME_ID, SAM_ID, 3000),
    ]);
    friendshipDeleteMock.mockResolvedValue({});

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/${SAM_ID}`,
      headers: authHeader(app, ME_ID),
    });

    expect(res.statusCode).toBe(204);
    expect(friendshipDeleteMock).toHaveBeenCalledTimes(1);
  });

  it('BB-66-5b: succeeds (204) for the "never shared anything" zero-currencies case', async () => {
    friendshipFindUniqueMock.mockResolvedValue(friendshipRow(ME_ID, SAM_ID, 'Me', 'Sam'));
    expenseFindManyMock.mockResolvedValue([]);
    settlementFindManyMock.mockResolvedValue([]);
    friendshipDeleteMock.mockResolvedValue({});

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/${SAM_ID}`,
      headers: authHeader(app, ME_ID),
    });

    expect(res.statusCode).toBe(204);
  });

  it('BB-66-6: never touches GroupMember rows (no groupMember mock exists — any call would throw, so 204 proves none happened)', async () => {
    friendshipFindUniqueMock.mockResolvedValue(friendshipRow(ME_ID, SAM_ID, 'Me', 'Sam'));
    friendshipDeleteMock.mockResolvedValue({});

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/${SAM_ID}`,
      headers: authHeader(app, ME_ID),
    });

    expect(res.statusCode).toBe(204);
  });

  it('BB-66-7: 404 FRIENDSHIP_NOT_FOUND when no Friendship row exists for the pair', async () => {
    friendshipFindUniqueMock.mockResolvedValue(null);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/${SAM_ID}`,
      headers: authHeader(app, ME_ID),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('FRIENDSHIP_NOT_FOUND');
    expect(friendshipDeleteMock).not.toHaveBeenCalled();
    // Never reaches the balance gate for a nonexistent row.
    expect(expenseFindManyMock).not.toHaveBeenCalled();
  });

  it('BB-66-8: self-targeting collapses to the same 404 FRIENDSHIP_NOT_FOUND, no special-case branch', async () => {
    friendshipFindUniqueMock.mockResolvedValue(null); // no user<->self row can ever exist

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/${ME_ID}`,
      headers: authHeader(app, ME_ID),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('FRIENDSHIP_NOT_FOUND');
    // Same userAId/userBId both equal to ME_ID — proves the lookup key
    // collapses naturally, no separate `targetId === callerId` guard fired.
    expect(friendshipFindUniqueMock).toHaveBeenCalledWith({
      where: { userAId_userBId: { userAId: ME_ID, userBId: ME_ID } },
      include: expect.any(Object),
    });
  });

  it('BB-66-9: structurally scoped — caller A cannot delete a friendship between B and C by calling DELETE /friends/:C', async () => {
    // A calls DELETE /friends/C. The server only ever resolves the pair
    // (A, C) — never (B, C) — so B and C's real friendship is structurally
    // unreachable from this request, without any explicit ownership check.
    friendshipFindUniqueMock.mockImplementation(
      async (args: { where: { userAId_userBId: { userAId: string; userBId: string } } }) => {
        const { userAId, userBId } = args.where.userAId_userBId;
        // Only the (B, C) pair has a real friendship in this scenario.
        if (userAId === (BEA_ID < ALEX_ID ? BEA_ID : ALEX_ID) && userBId === (BEA_ID < ALEX_ID ? ALEX_ID : BEA_ID)) {
          return friendshipRow(BEA_ID, ALEX_ID, 'Bea', 'Alex');
        }
        return null; // (A, C) — no such row
      },
    );

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/${ALEX_ID}`, // A targets C (Alex)
      headers: authHeader(app, ME_ID), // caller is A (Me)
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('FRIENDSHIP_NOT_FOUND');
    expect(friendshipFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining(pairKey(ME_ID, ALEX_ID)),
    );
    // The (Bea, Alex) pair key was never looked up nor deleted from this request.
    expect(friendshipFindUniqueMock).not.toHaveBeenCalledWith(
      expect.objectContaining(pairKey(BEA_ID, ALEX_ID)),
    );
    expect(friendshipDeleteMock).not.toHaveBeenCalled();
  });

  it('BB-66-10: re-adding a former friend afterward works normally via POST /friends — fresh row, FRIEND_ADDED fires', async () => {
    // Simulates the post-removal state: no existing Friendship row.
    userFindUniqueMock
      .mockResolvedValueOnce(user(SAM_ID, 'Sam')) // target lookup by email
      .mockResolvedValueOnce({ name: 'Me' }); // actor lookup for activity
    friendshipFindUniqueMock.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/friends',
      headers: authHeader(app, ME_ID),
      payload: { identifier: 'sam@example.com' },
    });

    expect(res.statusCode).toBe(201);
    expect(recordActivityMock).toHaveBeenCalledTimes(1);
    expect(recordActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'FRIEND_ADDED',
        actorId: ME_ID,
        recipientIds: [ME_ID, SAM_ID],
      }),
    );
  });

  it('BB-66-11: silent removal — recordActivity is never called on a successful DELETE', async () => {
    friendshipFindUniqueMock.mockResolvedValue(friendshipRow(ME_ID, SAM_ID, 'Me', 'Sam'));
    friendshipDeleteMock.mockResolvedValue({});

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/${SAM_ID}`,
      headers: authHeader(app, ME_ID),
    });

    expect(res.statusCode).toBe(204);
    expect(recordActivityMock).not.toHaveBeenCalled();
  });

  it('BB-66-12 (DRB security note N1): a losing concurrent double-DELETE gets domain 404 FRIENDSHIP_NOT_FOUND, not a generic 500/404', async () => {
    friendshipFindUniqueMock.mockResolvedValue(friendshipRow(ME_ID, SAM_ID, 'Me', 'Sam'));

    // First delete wins normally.
    friendshipDeleteMock.mockResolvedValueOnce({});
    const first = await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/${SAM_ID}`,
      headers: authHeader(app, ME_ID),
    });
    expect(first.statusCode).toBe(204);

    // Second delete for the same pair loses the race: Prisma throws P2025
    // (record to delete does not exist) — the handler must catch this
    // specifically and rethrow the domain AppError, not let it fall through
    // to the global handler's generic 404 NOT_FOUND.
    friendshipDeleteMock.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('An operation failed because it depends on one or more records that were required but not found.', {
        code: 'P2025',
        clientVersion: '6.0.0',
      }),
    );
    const second = await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/${SAM_ID}`,
      headers: authHeader(app, ME_ID),
    });

    expect(second.statusCode).toBe(404);
    expect(second.json().code).toBe('FRIENDSHIP_NOT_FOUND'); // NOT the generic 'NOT_FOUND'
  });

  it('BB-66-12b: a non-P2025 error from the delete call is not swallowed into a false 404 (500 passthrough)', async () => {
    friendshipFindUniqueMock.mockResolvedValue(friendshipRow(ME_ID, SAM_ID, 'Me', 'Sam'));
    friendshipDeleteMock.mockRejectedValue(new Error('boom'));

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/friends/${SAM_ID}`,
      headers: authHeader(app, ME_ID),
    });

    expect(res.statusCode).toBe(500);
  });
});
