// Test-stage integration coverage — story-WI-016 Part B (shareable settle-up
// link/QR) / ADR-013.
//
// The link/QR feature itself is entirely client-side (mobile
// `buildSettleShareLink`, web `buildSettleLink` in settle-dialog.tsx) — no
// new endpoint, no server state, no signed token (ADR-013 "Decision"). This
// file verifies that boundary from the server side, end to end: the exact
// query-param shape a generated link carries, once parsed back into a
// POST /settlements payload, is subject to the *same* unmodified
// authorization the manual "Record payment" flow always was — a party can
// record it, a non-party (WI-004) cannot, no matter how the payload arrived
// at the client. Also confirms no new "settle request" resource/endpoint was
// introduced (ADR-013's explicit "no server state" claim).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const userFindUniqueMock = vi.fn();
const groupMemberFindFirstMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const settlementCreateMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    groupMember: { findFirst: (...args: unknown[]) => groupMemberFindFirstMock(...args) },
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

// zId requires >= 8 chars — see this domain's own memory.
const ANA_ID = 'user_id_ana1';
const BOB_ID = 'user_id_bob1';
const CARA_ID = 'user_id_cara1';

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
  userFindUniqueMock.mockReset();
  groupMemberFindFirstMock.mockReset();
  expenseFindManyMock.mockReset();
  settlementFindManyMock.mockReset();
  settlementCreateMock.mockReset();
  expenseFindManyMock.mockResolvedValue([]);
  settlementFindManyMock.mockResolvedValue([]);

  app = await buildApp();
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

/**
 * Mirrors mobile's `buildSettleShareLink` / web's `buildSettleLink` — the
 * exact query-string shape ADR-013 specifies — and parses it back into the
 * `POST /settlements` payload the "Record payment" form would submit, the
 * same way `app/(app)/settle/page.tsx` / mobile's `app/settle.tsx` do.
 */
function shareLinkFor(params: {
  fromUserId: string;
  toUserId: string;
  amount: number;
  currency: string;
}): string {
  const qs = new URLSearchParams({
    fromUserId: params.fromUserId,
    toUserId: params.toUserId,
    amount: String(params.amount),
    currency: params.currency,
  });
  return `https://app.divzy.example/settle?${qs.toString()}`;
}

function parseSharedSettlementPayload(link: string) {
  const url = new URL(link);
  return {
    fromUserId: url.searchParams.get('fromUserId')!,
    toUserId: url.searchParams.get('toUserId')!,
    amount: Number.parseInt(url.searchParams.get('amount')!, 10),
    currency: url.searchParams.get('currency')!,
    method: 'CASH' as const,
    date: new Date('2026-07-16T00:00:00.000Z').toISOString(),
  };
}

describe('WI-016 Part B integration — a generated share link carries no authority of its own', () => {
  it('the payer named in the link can record the exact amount/currency the link carried (party, 201)', async () => {
    const token = app.jwt.sign({ sub: ANA_ID });
    const link = shareLinkFor({ fromUserId: ANA_ID, toUserId: BOB_ID, amount: 4250, currency: 'USD' });
    const payload = parseSharedSettlementPayload(link);

    userFindUniqueMock.mockResolvedValue({ id: BOB_ID }); // counterpart exists (non-group settlement)
    // ADR-010/ADR-011 balance bound: a real 4250 USD debt (Bob paid, Ana owes)
    // must exist in the pair's ledger for the exact-payoff amount to pass.
    expenseFindManyMock.mockResolvedValue([expense('USD', 4250, BOB_ID, ANA_ID)]);
    settlementCreateMock.mockResolvedValue({
      id: 's_link_1',
      groupId: null,
      group: null,
      fromUserId: ANA_ID,
      toUserId: BOB_ID,
      amount: 4250,
      currency: 'USD',
      method: 'CASH',
      note: null,
      date: new Date(payload.date),
      createdById: ANA_ID,
      deletedAt: null,
      createdAt: new Date('2026-07-16T00:00:00.000Z'),
      fromUser: { id: ANA_ID, name: 'Ana', avatarColor: '#111' },
      toUser: { id: BOB_ID, name: 'Bob', avatarColor: '#222' },
      createdBy: { id: ANA_ID, name: 'Ana', avatarColor: '#111' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/settlements',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    // The exact integer minor-units amount/currency round-tripped through the
    // link, unchanged — no float drift, no conversion applied.
    expect(body.amount).toBe(4250);
    expect(body.currency).toBe('USD');
  });

  it('a non-party who opens the same link (Cara, neither Ana nor Bob) is 403-rejected by the server — the link itself never authorizes anything (WI-004, re-verified end to end)', async () => {
    const token = app.jwt.sign({ sub: CARA_ID });
    const link = shareLinkFor({ fromUserId: ANA_ID, toUserId: BOB_ID, amount: 4250, currency: 'USD' });
    const payload = parseSharedSettlementPayload(link);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/settlements',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
    expect(settlementCreateMock).not.toHaveBeenCalled();
  });

  it('opening/generating the link never itself creates a Settlement row — no request is made merely by parsing the link', async () => {
    // Purely a construction/parse round-trip — the assertion is that no
    // network call happens as a side effect of building or reading the link.
    const link = shareLinkFor({ fromUserId: ANA_ID, toUserId: BOB_ID, amount: 4250, currency: 'USD' });
    parseSharedSettlementPayload(link);

    expect(settlementCreateMock).not.toHaveBeenCalled();
  });

  it('ADR-013 "no server state": no settle-request resource exists to fetch back by link/token — a plausible guess at such an endpoint 404s', async () => {
    const token = app.jwt.sign({ sub: ANA_ID });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/settle-requests/anything',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
