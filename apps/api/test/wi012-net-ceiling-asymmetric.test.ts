// WI-012 (Test stage, cycle 1, test-settlements) — "did the fix overcorrect?" check.
//
// The cycle-1 fix (ADR-010, spec-WI-012.md "Revision 2") replaces the group-scoped bound
// with `settleable = netP < 0 && netR > 0 ? Math.min(-netP, netR) : 0`. Build's own new
// coverage (`settlements.balance-bound.test.ts`'s "net-position reachability (3-member
// chain)" describe block) proves the bound rejects `ceiling + 1` in a fixture where
// `-netP === netR === 10000` — i.e. both operands of `Math.min` are numerically equal in
// that fixture. That is real coverage (it is not an input-echoing tautology: the ceiling
// is derived from real expense rows, not copied from the request), but it cannot by itself
// distinguish the correct `Math.min(-netP, netR)` from a hypothetically-broken
// `netR`-only (or `-netP`-only) implementation, since both would produce the same ceiling
// (10000) on a symmetric fixture.
//
// This test closes that gap with an intentionally ASYMMETRIC fixture — payer's own debt
// magnitude (300) is much smaller than the recipient's total credit (1000, owed by two
// different people) — so a `netR`-only bug (which would wrongly allow up to 1000) is
// distinguishable from the correct `min(-netP, netR)` (which correctly caps at 300, the
// payer's own outstanding debt). Confirms the fix is a real, tight bound — not
// effectively unlimited for a payer who happens to owe less than their creditor is owed
// in total.
//
// Written directly against the real `@divzy/shared` engine (only Prisma mocked),
// following the established harness pattern in `wi012-suggestion-bilateral-mismatch.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { computeNets } from '@divzy/shared';

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

const P = 'user_payer01'; // zId requires >= 8 chars
const R = 'user_recip01';
const Q = 'user_third01';
const GROUP = 'grp_asymm001';

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

// R pays for two separate expenses: Q owes R 700, P owes R 300.
// Nets: R +1000 (paid 1000, owed 0 of it), P -300, Q -700.
// netP (payer P) = -300, netR (recipient R) = +1000 -> correct ceiling = min(300, 1000) = 300.
// A netR-only (or unbounded) implementation would wrongly allow up to 1000.
function asymmetricExpenses() {
  return [expense('USD', 70000, R, Q), expense('USD', 30000, R, P)];
}

beforeEach(async () => {
  for (const m of [groupMemberFindManyMock, expenseFindManyMock, settlementFindManyMock, settlementCreateMock]) {
    m.mockReset();
  }
  groupMemberFindManyMock.mockResolvedValue([{ userId: P }, { userId: R }, { userId: Q }]);
  settlementCreateMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 's1',
    ...data,
    date: new Date(data.date as string),
    createdAt: new Date('2026-07-15T00:00:00.000Z'),
    deletedAt: null,
    fromUser: { id: data.fromUserId, name: 'From', avatarColor: '#111' },
    toUser: { id: data.toUserId, name: 'To', avatarColor: '#222' },
    createdBy: { id: P, name: 'Payer', avatarColor: '#111' },
  }));
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: P });
});

afterEach(async () => {
  await app.close();
});

async function postSettlement(amount: number) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/settlements',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      groupId: GROUP,
      fromUserId: P,
      toUserId: R,
      amount,
      currency: 'USD',
      method: 'CASH',
      date: new Date('2026-07-15T00:00:00.000Z').toISOString(),
    },
  });
}

describe('WI-012 cycle-1 — net-reachability ceiling caps at the SMALLER magnitude (asymmetric nets)', () => {
  it('sanity: nets are genuinely asymmetric (payer owes far less than recipient is owed overall)', () => {
    const nets = computeNets(asymmetricExpenses(), []);
    expect(nets.get('USD')?.get(P)).toBe(-30000);
    expect(nets.get('USD')?.get(R)).toBe(100000);
    expect(nets.get('USD')?.get(Q)).toBe(-70000);
  });

  it('accepts exactly the payer\'s own net debt (30000), the true ceiling', async () => {
    expenseFindManyMock.mockResolvedValue(asymmetricExpenses());
    settlementFindManyMock.mockResolvedValue([]);

    const res = await postSettlement(30000);

    expect(res.statusCode).toBe(201);
    expect(settlementCreateMock).toHaveBeenCalled();
  });

  it('rejects one unit over the payer\'s own net debt, even though the recipient is owed far more overall', async () => {
    expenseFindManyMock.mockResolvedValue(asymmetricExpenses());
    settlementFindManyMock.mockResolvedValue([]);

    const res = await postSettlement(30001);

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('EXCEEDS_BALANCE');
    // Ceiling must be reported as 300.00 (the payer's own debt), NOT 1000.00 (the
    // recipient's total credit) -- this is exactly what distinguishes a correct
    // min(-netP, netR) from a netR-only (or unbounded) implementation.
    expect(res.json().message).toContain('300.00');
    expect(res.json().message).not.toContain('1,000.00');
    expect(settlementCreateMock).not.toHaveBeenCalled();
  });

  it('rejects a grossly excessive amount (bound is a real ceiling, not effectively unlimited)', async () => {
    expenseFindManyMock.mockResolvedValue(asymmetricExpenses());
    settlementFindManyMock.mockResolvedValue([]);

    const res = await postSettlement(1000000); // USD 10,000.00 -- far beyond any real debt in this group

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('EXCEEDS_BALANCE');
    expect(settlementCreateMock).not.toHaveBeenCalled();
  });
});
