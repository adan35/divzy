// WI-087 — real-database integration test for the group whiteboard endpoint.
// Uses the actual Prisma client and buildApp() app.inject() harness so the
// serializer, the new GroupWhiteboard migration, and the silent-fan-out
// invariant are exercised against a real Postgres dev database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/lib/prisma';
import { buildApp } from '../src/app';

let app: FastifyInstance;
let aliceToken: string;
let bobToken: string;
let carolToken: string;
let groupId: string;
let cleanupUserIds: string[] = [];

async function createUser(name: string, email: string) {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: 'not-a-real-hash',
      name,
      defaultCurrency: 'USD',
    },
  });
  cleanupUserIds.push(user.id);
  return user;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  const run = Date.now().toString(36);
  const alice = await createUser('Alice Whiteboard', `wi087-alice-${run}@test.local`);
  const bob = await createUser('Bob Whiteboard', `wi087-bob-${run}@test.local`);
  const carol = await createUser('Carol Outsider', `wi087-carol-${run}@test.local`);

  aliceToken = app.jwt.sign({ sub: alice.id });
  bobToken = app.jwt.sign({ sub: bob.id });
  carolToken = app.jwt.sign({ sub: carol.id });

  const group = await app.inject({
    method: 'POST',
    url: '/api/v1/groups',
    headers: { authorization: `Bearer ${aliceToken}` },
    payload: { name: `WI087 ${run}`, emoji: '🧪', type: 'HOME', currency: 'USD' },
  });
  const groupJson = group.json();
  groupId = groupJson.id;

  await app.inject({
    method: 'POST',
    url: `/api/v1/groups/${groupId}/members`,
    headers: { authorization: `Bearer ${aliceToken}` },
    payload: { email: bob.email },
  });
});

afterAll(async () => {
  await app?.close();
  // Hard-delete the group first; the User<->Group creator relation does not
  // cascade, so deleting users while the group still exists violates FK.
  // Group delete cascades to GroupWhiteboard / GroupMember rows.
  await prisma.group.delete({ where: { id: groupId } }).catch(() => {});
  for (const userId of cleanupUserIds) {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  }
  await prisma.$disconnect();
});

describe('GET /groups/:groupId/whiteboard', () => {
  it('returns an empty-state DTO before the first edit', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${groupId}/whiteboard`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ body: '', updatedBy: null, updatedAt: null });
  });

  it('returns 404 NOT_FOUND for a non-member', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${groupId}/whiteboard`,
      headers: { authorization: `Bearer ${carolToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /groups/:groupId/whiteboard', () => {
  it('creates the row on first edit and returns last-edited attribution', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/groups/${groupId}/whiteboard`,
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { body: 'Meet at 9am' },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.body).toBe('Meet at 9am');
    expect(json.updatedBy).toMatchObject({ name: 'Alice Whiteboard' });
    expect(json.updatedAt).not.toBeNull();

    const row = await prisma.groupWhiteboard.findUnique({ where: { groupId } });
    expect(row).not.toBeNull();
    expect(row!.body).toBe('Meet at 9am');
  });

  it('is readable by another active member', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${groupId}/whiteboard`,
      headers: { authorization: `Bearer ${bobToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().body).toBe('Meet at 9am');
    expect(res.json().updatedBy.name).toBe('Alice Whiteboard');
  });

  it('rejects a body over the 2000-character cap with 400', async () => {
    const bigBody = 'x'.repeat(2001);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/groups/${groupId}/whiteboard`,
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { body: bigBody },
    });

    expect(res.statusCode).toBe(400);
    const row = await prisma.groupWhiteboard.findUnique({ where: { groupId } });
    expect(row!.body).toBe('Meet at 9am');
  });

  it('returns 404 NOT_FOUND for a non-member', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/groups/${groupId}/whiteboard`,
      headers: { authorization: `Bearer ${carolToken}` },
      payload: { body: 'Should not persist' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('allows clearing the body to an empty string while keeping the row', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/groups/${groupId}/whiteboard`,
      headers: { authorization: `Bearer ${bobToken}` },
      payload: { body: '' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().body).toBe('');
    expect(res.json().updatedBy.name).toBe('Bob Whiteboard');

    const row = await prisma.groupWhiteboard.findUnique({ where: { groupId } });
    expect(row).not.toBeNull();
    expect(row!.body).toBe('');
  });

  it('creates zero ActivityLog rows after a successful PUT (silent fan-out)', async () => {
    const before = await prisma.activityLog.count({ where: { groupId } });

    await app.inject({
      method: 'PUT',
      url: `/api/v1/groups/${groupId}/whiteboard`,
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { body: 'Another edit' },
    });

    const after = await prisma.activityLog.count({ where: { groupId } });
    expect(after).toBe(before);
  });

  it('creates zero Notification rows after a successful PUT (silent fan-out)', async () => {
    const userIds = cleanupUserIds;
    const before = await prisma.notification.count({ where: { userId: { in: userIds } } });

    await app.inject({
      method: 'PUT',
      url: `/api/v1/groups/${groupId}/whiteboard`,
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { body: 'Yet another edit' },
    });

    const after = await prisma.notification.count({ where: { userId: { in: userIds } } });
    expect(after).toBe(before);
  });
});
