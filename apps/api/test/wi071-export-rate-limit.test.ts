// spec-WI-071.md §4 / story-WI-071.md "Export routes get a stricter,
// route-specific rate limit" — `max: 5, timeWindow: '1 minute'`, per-user
// keyed (not per-IP), applied to export.csv/.pdf/.xlsx, overriding (not
// stacking with) the global 300/min limiter (mirrors auth.ts's shipped
// `authRateLimit` precedent).
//
// Mocked-prisma style (mirrors xlsx-export-route.test.ts / pdf-export-route.test.ts
// / csv-export.test.ts) so each test is fast and isolated — the rate limiter
// itself is the REAL @fastify/rate-limit plugin (never mocked), since that's
// exactly the thing under test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const groupMemberFindFirstMock = vi.fn();
const groupMemberFindManyMock = vi.fn();
const groupFindUniqueMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    group: { findUnique: (...args: unknown[]) => groupFindUniqueMock(...args) },
    groupMember: {
      findFirst: (...args: unknown[]) => groupMemberFindFirstMock(...args),
      findMany: (...args: unknown[]) => groupMemberFindManyMock(...args),
    },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: { findMany: (...args: unknown[]) => settlementFindManyMock(...args) },
  },
}));

import { buildApp } from '../src/app';

let app: FastifyInstance;

const USER_A = 'user_ratelimit_a1';
const USER_B = 'user_ratelimit_b1';
const GROUP_ID = 'group_ratelimit_01';

function tokenFor(app: FastifyInstance, userId: string) {
  return app.jwt.sign({ sub: userId });
}

function activeMember() {
  return { id: 'gm_1' };
}

function members() {
  return [
    { userId: USER_A, user: { name: 'Ana' } },
    { userId: USER_B, user: { name: 'Bailey' } },
  ];
}

beforeEach(async () => {
  groupMemberFindFirstMock.mockReset().mockResolvedValue(activeMember());
  groupMemberFindManyMock.mockReset().mockResolvedValue(members());
  groupFindUniqueMock.mockReset().mockResolvedValue({ name: 'Rate Limit Trip', emoji: '🚦' });
  expenseFindManyMock.mockReset().mockResolvedValue([]);
  settlementFindManyMock.mockReset().mockResolvedValue([]);

  app = await buildApp();
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

function exportRequest(app: FastifyInstance, userId: string, route: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/groups/${GROUP_ID}/${route}`,
    headers: { authorization: `Bearer ${tokenFor(app, userId)}` },
  });
}

describe.each([
  ['export.csv', 200],
  ['export.pdf', 200],
  ['export.xlsx', 200],
] as const)('GET /api/v1/groups/:groupId/%s — WI-071 §4 rate limit', (route, okStatus) => {
  it('a single call succeeds exactly as before (normal usage unaffected)', async () => {
    const res = await exportRequest(app, USER_A, route);
    expect(res.statusCode).toBe(okStatus);
  });

  it('the 6th call within a minute is rejected 429, the first 5 succeed', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await exportRequest(app, USER_A, route);
      statuses.push(res.statusCode);
    }

    expect(statuses.slice(0, 5)).toEqual([okStatus, okStatus, okStatus, okStatus, okStatus]);
    expect(statuses[5]).toBe(429);
  });

  it('two different users do not share the rate-limit bucket (per-user keying, not per-IP)', async () => {
    // Exhaust A's own allowance (5 calls)...
    for (let i = 0; i < 5; i += 1) {
      const res = await exportRequest(app, USER_A, route);
      expect(res.statusCode).toBe(okStatus);
    }
    // ...A's 6th call is now limited...
    const aSixth = await exportRequest(app, USER_A, route);
    expect(aSixth.statusCode).toBe(429);

    // ...but B, a completely different user (same fake app.inject "IP"), still
    // gets their own full allowance — proving the key is request.userId, not
    // the shared connection/IP both requests appear to come from.
    const bFirst = await exportRequest(app, USER_B, route);
    expect(bFirst.statusCode).toBe(okStatus);
  });
});

describe('GET /api/v1/groups/:groupId/export.* — WI-071 §4 rate limit is per-route, not shared globally', () => {
  it('exhausting csv\'s limit does not block a fresh pdf call for the same user', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await exportRequest(app, USER_A, 'export.csv');
      expect(res.statusCode).toBe(200);
    }
    const csvSixth = await exportRequest(app, USER_A, 'export.csv');
    expect(csvSixth.statusCode).toBe(429);

    const pdfFirst = await exportRequest(app, USER_A, 'export.pdf');
    expect(pdfFirst.statusCode).toBe(200);
  });
});
