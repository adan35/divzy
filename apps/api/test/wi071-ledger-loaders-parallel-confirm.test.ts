// spec-WI-071.md §3 / story-WI-071.md "assertWithinOutstanding's write-path
// ledger scan — confirmed already parallel; no change made". Test's own
// independent re-verification (not just trusting Build's claim) that
// `loadGroupLedger` (lib/ledger.ts) and `loadPairLedger` (settlements.ts,
// exercised indirectly via POST /settlements since it is not exported) still
// issue their expense + settlement queries via a single `Promise.all`, not a
// sequential pair of awaits.
//
// Proof technique: each mocked query only resolves once the OTHER query has
// also been invoked (a mutual barrier). If the two queries were dispatched
// sequentially (one `await`ed before the other is even called), the first
// mock would spin until its own timeout and the call would reject — a
// deliberate, fast-failing way to catch a regression back to sequential
// awaits, rather than silently passing either way.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const userFindUniqueMock = vi.fn();
const groupMemberFindManyMock = vi.fn();
const settlementCreateMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: {
      findMany: (...args: unknown[]) => settlementFindManyMock(...args),
      create: (...args: unknown[]) => settlementCreateMock(...args),
    },
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    groupMember: { findMany: (...args: unknown[]) => groupMemberFindManyMock(...args) },
  },
}));

vi.mock('../src/lib/activity', () => ({ recordActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/lib/social', () => ({ ensureFriendshipsAmong: vi.fn().mockResolvedValue(undefined) }));

import { loadGroupLedger } from '../src/lib/ledger';
import { buildApp } from '../src/app';

const ME = 'user_ledgerconfirm_me';
const ANA = 'user_ledgerconfirm_ana';

/** Resolves once `cond()` is true, or rejects after `timeoutMs` — a fast,
 *  deterministic way to fail (not hang) if the two queries never overlap. */
function waitUntil(cond: () => boolean, timeoutMs = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (cond()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('waitUntil timed out — the two ledger queries were never concurrently in flight'));
        return;
      }
      setTimeout(check, 5);
    };
    check();
  });
}

beforeEach(() => {
  expenseFindManyMock.mockReset();
  settlementFindManyMock.mockReset();
  userFindUniqueMock.mockReset();
  groupMemberFindManyMock.mockReset();
  settlementCreateMock.mockReset();
});

describe('loadGroupLedger — group-scoped ledger loader (lib/ledger.ts)', () => {
  it('issues the expense and settlement queries concurrently via Promise.all, not sequentially', async () => {
    let expenseStarted = false;
    let settlementStarted = false;
    expenseFindManyMock.mockImplementation(async () => {
      expenseStarted = true;
      await waitUntil(() => settlementStarted);
      return [];
    });
    settlementFindManyMock.mockImplementation(async () => {
      settlementStarted = true;
      await waitUntil(() => expenseStarted);
      return [];
    });

    const result = await loadGroupLedger('grp_confirm_01');

    expect(result).toEqual({ expenses: [], settlements: [] });
    expect(expenseFindManyMock).toHaveBeenCalledTimes(1);
    expect(settlementFindManyMock).toHaveBeenCalledTimes(1);
  });
});

describe('loadPairLedger — direct-pair ledger loader (settlements.ts, exercised via POST /settlements)', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    userFindUniqueMock.mockResolvedValue({ id: ANA }); // counterpart exists (non-group path)
    app = await buildApp();
    await app.ready();
    token = app.jwt.sign({ sub: ME });
  });

  afterEach(async () => {
    await app.close();
  });

  it('assertWithinOutstanding (non-group) issues the pair\'s expense and settlement queries concurrently', async () => {
    let expenseStarted = false;
    let settlementStarted = false;
    expenseFindManyMock.mockImplementation(async () => {
      expenseStarted = true;
      await waitUntil(() => settlementStarted);
      return [];
    });
    settlementFindManyMock.mockImplementation(async () => {
      settlementStarted = true;
      await waitUntil(() => expenseStarted);
      return [];
    });

    // Result (400 NO_OUTSTANDING_BALANCE, since the ledger is empty) is
    // irrelevant to this test — only that both queries were concurrently
    // in flight by the time assertWithinOutstanding resolved, without hanging.
    const res = await app.inject({
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
      },
    });

    expect(res.statusCode).toBe(400);
    expect(expenseFindManyMock).toHaveBeenCalledTimes(1);
    expect(settlementFindManyMock).toHaveBeenCalledTimes(1);
  });
});
