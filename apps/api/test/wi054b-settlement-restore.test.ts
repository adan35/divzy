// spec-WI-054b §2 / §9 (backend) — POST /settlements/:settlementId/restore
// (undo a soft delete) and the extracted `assertCanMutateSettlement` helper
// shared with DELETE. Real-DB (no mocked prisma) integration coverage,
// mirroring this repo's wi054-055-056-real-db-integration.test.ts /
// wi054b-restore-balance-reapply.test.ts approach: real users/groups/
// settlements seeded via `prisma`, driven end-to-end through `app.inject`
// against the real routes — not a hand-rolled in-memory prisma mock.
//
// TDD: written directly from spec-WI-054b.md §2 before the restore route or
// the `assertCanMutateSettlement` extraction existed. Run red first: no
// restore route at all (Fastify 404 FST_ERR_NOT_FOUND on every restore call,
// not the domain's NOT_FOUND), then made green by the minimal additive
// route + refactor.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../src/lib/prisma';
import { buildApp } from '../src/app';

const STAMP = Date.now();
let app: FastifyInstance;

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `wi054b-restore-${label}-${STAMP}@test.local`,
      passwordHash: 'not-a-real-hash',
      name: `WI-054b Restore ${label}`,
      emailNotifications: false,
    },
  });
  return user.id;
}

function tokenFor(userId: string) {
  return app.jwt.sign({ sub: userId });
}

async function restoreSettlement(settlementId: string, asUserId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/settlements/${settlementId}/restore`,
    headers: { authorization: `Bearer ${tokenFor(asUserId)}` },
  });
}

async function deleteSettlement(settlementId: string, asUserId: string) {
  return app.inject({
    method: 'DELETE',
    url: `/api/v1/settlements/${settlementId}`,
    headers: { authorization: `Bearer ${tokenFor(asUserId)}` },
  });
}

// -- Shared fixtures ----------------------------------------------------------
let ana: string; // payer, direct + group
let sam: string; // recipient, direct + group
let caseyCreator: string; // creates settlements as a party at seed time, distinct from parties in the row itself
let priyaAdmin: string; // active group ADMIN, not a party
let jordanMember: string; // active group MEMBER, not a party, not admin
let strangerNoGroup: string; // no relation to the group or the direct settlement at all
let sinceLeftAdmin: string; // was ADMIN, leaves before the restore attempt
let otherGroupAdmin: string; // ADMIN of an unrelated group only

let groupId: string;
let unrelatedGroupId: string;

const allUserIds: string[] = [];
const allGroupIds: string[] = [];
const settlementIdsToClean: string[] = [];

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  ana = await createUser('ana');
  sam = await createUser('sam');
  caseyCreator = await createUser('casey');
  priyaAdmin = await createUser('priya');
  jordanMember = await createUser('jordan');
  strangerNoGroup = await createUser('stranger');
  sinceLeftAdmin = await createUser('since-left-admin');
  otherGroupAdmin = await createUser('other-admin');
  allUserIds.push(
    ana,
    sam,
    caseyCreator,
    priyaAdmin,
    jordanMember,
    strangerNoGroup,
    sinceLeftAdmin,
    otherGroupAdmin,
  );

  const group = await prisma.group.create({
    data: {
      name: 'WI-054b Restore Fixture',
      inviteCode: `wi054b-restore-${STAMP}`,
      createdById: ana,
      members: {
        create: [
          { userId: ana, role: 'MEMBER' },
          { userId: sam, role: 'MEMBER' },
          { userId: caseyCreator, role: 'MEMBER' },
          { userId: priyaAdmin, role: 'ADMIN' },
          { userId: jordanMember, role: 'MEMBER' },
          { userId: sinceLeftAdmin, role: 'ADMIN' },
        ],
      },
    },
  });
  groupId = group.id;
  allGroupIds.push(groupId);

  // sinceLeftAdmin leaves the group before any restore attempt against them.
  await prisma.groupMember.updateMany({
    where: { groupId, userId: sinceLeftAdmin },
    data: { leftAt: new Date() },
  });

  const unrelatedGroup = await prisma.group.create({
    data: {
      name: 'WI-054b Unrelated Group',
      inviteCode: `wi054b-restore-unrelated-${STAMP}`,
      createdById: otherGroupAdmin,
      members: { create: [{ userId: otherGroupAdmin, role: 'ADMIN' }] },
    },
  });
  unrelatedGroupId = unrelatedGroup.id;
  allGroupIds.push(unrelatedGroupId);
});

afterAll(async () => {
  await app?.close();
  await prisma.activityRecipient.deleteMany({ where: { userId: { in: allUserIds } } });
  await prisma.activityLog.deleteMany({ where: { actorId: { in: allUserIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: allUserIds } } });
  await prisma.settlement.deleteMany({ where: { id: { in: settlementIdsToClean } } });
  await prisma.groupMember.deleteMany({ where: { groupId: { in: allGroupIds } } });
  await prisma.group.deleteMany({ where: { id: { in: allGroupIds } } });
  await prisma.user.deleteMany({ where: { id: { in: allUserIds } } });
  await prisma.$disconnect();
});

/**
 * Seeds a settlement row directly via `prisma` (not the POST /settlements
 * route) so `createdById` can be set independently of `fromUserId`/
 * `toUserId` — the real creation route always sets `createdById` to the
 * calling party, so a "creator, not a party" fixture is only reachable by
 * seeding the row directly (same technique WI-039b's mocked tests use).
 */
async function seedSettlement(overrides: {
  groupId?: string | null;
  fromUserId: string;
  toUserId: string;
  createdById: string;
  deletedAt?: Date | null;
}) {
  const settlement = await prisma.settlement.create({
    data: {
      groupId: overrides.groupId ?? null,
      fromUserId: overrides.fromUserId,
      toUserId: overrides.toUserId,
      amount: 1500,
      currency: 'USD',
      method: 'CASH',
      date: new Date('2026-07-10T00:00:00.000Z'),
      createdById: overrides.createdById,
      // `?? default` would treat an explicit `deletedAt: null` override (an
      // "already active" fixture) as "unset -> use default" since `null` is
      // nullish too — that would silently seed an unwanted deleted row. Use
      // `'deletedAt' in overrides` so an explicit null is honored.
      deletedAt: 'deletedAt' in overrides ? overrides.deletedAt : new Date('2026-07-11T00:00:00.000Z'),
    },
  });
  settlementIdsToClean.push(settlement.id);
  return settlement.id;
}

describe('POST /api/v1/settlements/:settlementId/restore — direct settlements', () => {
  it('the payer can restore', async () => {
    const id = await seedSettlement({ fromUserId: ana, toUserId: sam, createdById: ana });
    const res = await restoreSettlement(id, ana);
    expect(res.statusCode).toBe(200);
    expect(res.json().deletedAt).toBeNull();
    const row = await prisma.settlement.findUnique({ where: { id } });
    expect(row?.deletedAt).toBeNull();
  });

  it('the recipient can restore', async () => {
    const id = await seedSettlement({ fromUserId: ana, toUserId: sam, createdById: ana });
    const res = await restoreSettlement(id, sam);
    expect(res.statusCode).toBe(200);
    expect(res.json().deletedAt).toBeNull();
  });

  it('the creator (not a party) can restore', async () => {
    const id = await seedSettlement({ fromUserId: ana, toUserId: sam, createdById: caseyCreator });
    const res = await restoreSettlement(id, caseyCreator);
    expect(res.statusCode).toBe(200);
    expect(res.json().deletedAt).toBeNull();
  });

  it('a stranger to a direct settlement gets 404', async () => {
    const id = await seedSettlement({ fromUserId: ana, toUserId: sam, createdById: ana });
    const res = await restoreSettlement(id, strangerNoGroup);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
    const row = await prisma.settlement.findUnique({ where: { id } });
    expect(row?.deletedAt).not.toBeNull();
  });

  it('an admin of an unrelated group has no special standing on a direct settlement — 404, no admin concept applies', async () => {
    const id = await seedSettlement({ fromUserId: ana, toUserId: sam, createdById: ana });
    const res = await restoreSettlement(id, otherGroupAdmin);
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/v1/settlements/:settlementId/restore — group settlements', () => {
  it('the payer can restore', async () => {
    const id = await seedSettlement({ groupId, fromUserId: ana, toUserId: sam, createdById: ana });
    const res = await restoreSettlement(id, ana);
    expect(res.statusCode).toBe(200);
    expect(res.json().deletedAt).toBeNull();
  });

  it('the recipient can restore', async () => {
    const id = await seedSettlement({ groupId, fromUserId: ana, toUserId: sam, createdById: ana });
    const res = await restoreSettlement(id, sam);
    expect(res.statusCode).toBe(200);
  });

  it('the creator (not a party) can restore', async () => {
    const id = await seedSettlement({
      groupId,
      fromUserId: ana,
      toUserId: sam,
      createdById: caseyCreator,
    });
    const res = await restoreSettlement(id, caseyCreator);
    expect(res.statusCode).toBe(200);
  });

  it('an active group ADMIN who is not a party can restore', async () => {
    const id = await seedSettlement({ groupId, fromUserId: ana, toUserId: sam, createdById: ana });
    const res = await restoreSettlement(id, priyaAdmin);
    expect(res.statusCode).toBe(200);
    expect(res.json().deletedAt).toBeNull();
  });

  it('a non-admin, non-party active member gets an explicit 403, deletedAt unchanged', async () => {
    const id = await seedSettlement({ groupId, fromUserId: ana, toUserId: sam, createdById: ana });
    const res = await restoreSettlement(id, jordanMember);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
    const row = await prisma.settlement.findUnique({ where: { id } });
    expect(row?.deletedAt).not.toBeNull();
  });

  it('a stranger to the group gets 404, never 403 (existence never leaks)', async () => {
    const id = await seedSettlement({ groupId, fromUserId: ana, toUserId: sam, createdById: ana });
    const res = await restoreSettlement(id, strangerNoGroup);
    expect(res.statusCode).toBe(404);
  });

  it('a former admin who has since left the group gets 404 — exactly the DELETE admin-leave rule (member lookup excludes leftAt rows, falls through to 404)', async () => {
    const id = await seedSettlement({ groupId, fromUserId: ana, toUserId: sam, createdById: ana });
    const res = await restoreSettlement(id, sinceLeftAdmin);
    expect(res.statusCode).toBe(404);
  });

  it('a nonexistent settlementId returns 404', async () => {
    const res = await restoreSettlement('nonexistent_settlement_id', ana);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });
});

describe('POST /api/v1/settlements/:settlementId/restore — idempotency', () => {
  it('restoring an already-active settlement is a 200 no-op: unchanged DTO, no new SETTLEMENT_RESTORED row', async () => {
    const id = await seedSettlement({
      fromUserId: ana,
      toUserId: sam,
      createdById: ana,
      deletedAt: null, // already active
    });

    const before = await prisma.activityLog.count({
      where: { settlementId: id, type: 'SETTLEMENT_RESTORED' },
    });
    expect(before).toBe(0);

    const res = await restoreSettlement(id, ana);
    expect(res.statusCode).toBe(200);
    expect(res.json().deletedAt).toBeNull();

    const after = await prisma.activityLog.count({
      where: { settlementId: id, type: 'SETTLEMENT_RESTORED' },
    });
    expect(after).toBe(0);
  });

  it('restore-then-restore-again: the second call is still 200, still no duplicate SETTLEMENT_RESTORED row', async () => {
    const id = await seedSettlement({ fromUserId: ana, toUserId: sam, createdById: ana });

    const first = await restoreSettlement(id, ana);
    expect(first.statusCode).toBe(200);
    expect(first.json().deletedAt).toBeNull();

    const second = await restoreSettlement(id, ana);
    expect(second.statusCode).toBe(200);
    expect(second.json().deletedAt).toBeNull();

    const restoredRows = await prisma.activityLog.count({
      where: { settlementId: id, type: 'SETTLEMENT_RESTORED' },
    });
    expect(restoredRows).toBe(1);
  });
});

describe('POST /api/v1/settlements/:settlementId/restore — activity fan-out', () => {
  it('success fires exactly one SETTLEMENT_RESTORED ActivityLog row, actorId = caller, no Notification row for anyone', async () => {
    const id = await seedSettlement({ groupId, fromUserId: ana, toUserId: sam, createdById: ana });

    const notifBefore = await prisma.notification.count({
      where: { userId: { in: [ana, sam, priyaAdmin, jordanMember] } },
    });

    const res = await restoreSettlement(id, priyaAdmin);
    expect(res.statusCode).toBe(200);

    const rows = await prisma.activityLog.findMany({ where: { settlementId: id, type: 'SETTLEMENT_RESTORED' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(priyaAdmin);

    const notifAfter = await prisma.notification.count({
      where: { userId: { in: [ana, sam, priyaAdmin, jordanMember] } },
    });
    expect(notifAfter).toBe(notifBefore);
  });

  it('recipients are computed fresh at restore time, not reused from delete time: a member who joins the group AFTER the delete but BEFORE the restore is included as a recipient', async () => {
    // Fresh, isolated group + settlement for this scenario so the recipient
    // set is exactly attributable to this test.
    const freshMemberBefore = await createUser('fresh-before-delete');
    const lateJoiner = await createUser('fresh-late-joiner');
    allUserIds.push(freshMemberBefore, lateJoiner);

    const scopedGroup = await prisma.group.create({
      data: {
        name: 'WI-054b Recipients Fixture',
        inviteCode: `wi054b-restore-recipients-${STAMP}`,
        createdById: ana,
        members: {
          create: [
            { userId: ana, role: 'MEMBER' },
            { userId: sam, role: 'MEMBER' },
            { userId: freshMemberBefore, role: 'MEMBER' },
          ],
        },
      },
    });
    allGroupIds.push(scopedGroup.id);

    const id = await seedSettlement({
      groupId: scopedGroup.id,
      fromUserId: ana,
      toUserId: sam,
      createdById: ana,
    });

    // Late joiner joins AFTER the settlement was already soft-deleted (seeded
    // deletedAt) and BEFORE the restore call below.
    await prisma.groupMember.create({
      data: { groupId: scopedGroup.id, userId: lateJoiner, role: 'MEMBER' },
    });

    const res = await restoreSettlement(id, ana);
    expect(res.statusCode).toBe(200);

    const activity = await prisma.activityLog.findFirst({
      where: { settlementId: id, type: 'SETTLEMENT_RESTORED' },
      include: { recipients: true },
    });
    expect(activity).toBeDefined();
    const recipientUserIds = activity!.recipients.map((r) => r.userId);
    expect(recipientUserIds).toContain(lateJoiner);
    expect(recipientUserIds).toContain(ana);
    expect(recipientUserIds).toContain(sam);
    expect(recipientUserIds).toContain(freshMemberBefore);
  });
});

describe('DELETE /api/v1/settlements/:settlementId — regression (authz-extraction refactor must not change DELETE behavior)', () => {
  it('direct: payer/recipient/creator delete unchanged (204)', async () => {
    for (const actor of [ana, sam, caseyCreator]) {
      const id = await seedSettlement({
        fromUserId: ana,
        toUserId: sam,
        createdById: caseyCreator,
        deletedAt: null,
      });
      const res = await deleteSettlement(id, actor);
      expect(res.statusCode).toBe(204);
      const row = await prisma.settlement.findUnique({ where: { id } });
      expect(row?.deletedAt).not.toBeNull();
    }
  });

  it('direct: a stranger gets 404, never 403', async () => {
    const id = await seedSettlement({
      fromUserId: ana,
      toUserId: sam,
      createdById: ana,
      deletedAt: null,
    });
    const res = await deleteSettlement(id, strangerNoGroup);
    expect(res.statusCode).toBe(404);
  });

  it('direct: an unrelated group admin has no special standing — 404', async () => {
    const id = await seedSettlement({
      fromUserId: ana,
      toUserId: sam,
      createdById: ana,
      deletedAt: null,
    });
    const res = await deleteSettlement(id, otherGroupAdmin);
    expect(res.statusCode).toBe(404);
  });

  it('group: party (payer/creator) delete unchanged (204)', async () => {
    const id = await seedSettlement({
      groupId,
      fromUserId: ana,
      toUserId: sam,
      createdById: ana,
      deletedAt: null,
    });
    const res = await deleteSettlement(id, ana);
    expect(res.statusCode).toBe(204);
  });

  it('group: an active ADMIN who is not a party can delete (204)', async () => {
    const id = await seedSettlement({
      groupId,
      fromUserId: ana,
      toUserId: sam,
      createdById: ana,
      deletedAt: null,
    });
    const res = await deleteSettlement(id, priyaAdmin);
    expect(res.statusCode).toBe(204);
  });

  it('group: non-admin, non-party member gets explicit 403', async () => {
    const id = await seedSettlement({
      groupId,
      fromUserId: ana,
      toUserId: sam,
      createdById: ana,
      deletedAt: null,
    });
    const res = await deleteSettlement(id, jordanMember);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
    const row = await prisma.settlement.findUnique({ where: { id } });
    expect(row?.deletedAt).toBeNull();
  });

  it('group: a former admin who left the group gets 404', async () => {
    const id = await seedSettlement({
      groupId,
      fromUserId: ana,
      toUserId: sam,
      createdById: ana,
      deletedAt: null,
    });
    const res = await deleteSettlement(id, sinceLeftAdmin);
    expect(res.statusCode).toBe(404);
  });

  it('deleting an already-deleted settlement still 404s (unchanged lookup filter)', async () => {
    const id = await seedSettlement({
      fromUserId: ana,
      toUserId: sam,
      createdById: ana,
      deletedAt: new Date('2026-07-11T00:00:00.000Z'),
    });
    const res = await deleteSettlement(id, ana);
    expect(res.statusCode).toBe(404);
  });

  it('a nonexistent settlementId returns 404 on DELETE', async () => {
    const res = await deleteSettlement('nonexistent_settlement_id', ana);
    expect(res.statusCode).toBe(404);
  });
});
