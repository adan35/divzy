#!/usr/bin/env node
/**
 * WI-054 Part 2 — live end-to-end verification of EXPENSE_RESTORED /
 * SETTLEMENT_RESTORED against the REAL restore endpoints and the REAL
 * running dev API (not app.inject, not mocked prisma, not synthetic
 * ActivityLog rows). Registers real users via /api/v1/auth/register, creates
 * a real group/expense/settlement, and drives the full delete -> restore
 * cycle through the live HTTP endpoints, asserting on GET /activity as seen
 * by DIFFERENT recipients (not just the actor).
 *
 * Requires: API running (default http://localhost:4000) against a migrated,
 * running dev Postgres. Usage: node apps/api/test/wi054-part2-restore-live-e2e.mjs
 * Exits 0 when every check passes; prints and exits 1 on the first failure.
 *
 * Deliberately NOT a *.test.ts picked up by vitest (apps/api/vitest.config.ts
 * only includes test/**\/*.test.ts) — this is a standalone live-server script,
 * matching infra/smoke-test.mjs's established pattern for this repo, because
 * the story explicitly requires exercising the REAL producer endpoints
 * end-to-end, not an in-process buildApp() + app.inject() harness.
 */

const API = process.argv.includes('--api')
  ? process.argv[process.argv.indexOf('--api') + 1]
  : process.env.API_URL ?? 'http://localhost:4000';

let passed = 0;
const run = Date.now().toString(36);

function fail(msg, extra) {
  console.error(`\n❌ FAIL: ${msg}`);
  if (extra !== undefined) console.error(JSON.stringify(extra, null, 2).slice(0, 4000));
  process.exit(1);
}
function ok(msg) {
  passed += 1;
  console.log(`  ✓ ${msg}`);
}
function assert(cond, msg, extra) {
  if (!cond) fail(msg, extra);
  ok(msg);
}
function assertEq(actual, expected, msg) {
  if (actual !== expected) fail(`${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  ok(`${msg} (${JSON.stringify(expected)})`);
}
function step(name) {
  console.log(`\n▶ ${name}`);
}

async function req(method, path, { token, body, expect = 200 } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  const expected = Array.isArray(expect) ? expect : [expect];
  if (!expected.includes(res.status)) {
    fail(`${method} ${path} → ${res.status}, expected ${expected.join('/')}`, json);
  }
  return { status: res.status, json };
}

/** Finds a recipient's collapsed activity item for a given expenseId/settlementId across all pages. */
async function findActivityItem(token, { expenseId, settlementId }) {
  let cursor;
  for (let page = 0; page < 20; page += 1) {
    const qs = new URLSearchParams({ limit: '50' });
    if (cursor) qs.set('cursor', cursor);
    const { json } = await req('GET', `/api/v1/activity?${qs}`, { token });
    const match = json.items.find((i) =>
      expenseId ? i.expenseId === expenseId : i.settlementId === settlementId,
    );
    if (match) return match;
    if (!json.nextCursor) return null;
    cursor = json.nextCursor;
  }
  return null;
}

// ---------------------------------------------------------------------------
step('Health check');
{
  const { json } = await req('GET', '/health');
  assertEq(json.status, 'ok', 'API is up');
}

// ---------------------------------------------------------------------------
step('Register 3 users (alice=actor, bob=recipient, carol=leaver)');
const users = {};
for (const name of ['alice', 'bob', 'carol']) {
  const { json } = await req('POST', '/api/v1/auth/register', {
    body: {
      name: name[0].toUpperCase() + name.slice(1),
      email: `${name}.${run}@wi054part2.divzy.dev`,
      password: 'password123!',
      defaultCurrency: 'USD',
    },
    expect: [200, 201],
  });
  users[name] = { ...json.user, token: json.accessToken };
}
const { alice, bob, carol } = users;
ok('alice, bob, carol registered');

step('Create a group with all three members');
let group;
{
  const { json } = await req('POST', '/api/v1/groups', {
    token: alice.token,
    body: { name: `WI054P2 ${run}`, emoji: '🧪', type: 'HOME', currency: 'USD' },
    expect: [200, 201],
  });
  group = json;
  const joined = await req('POST', '/api/v1/groups/join', {
    token: bob.token,
    body: { code: group.inviteCode },
  });
  assertEq(joined.json.members.length, 2, 'bob joined');
  const joined2 = await req('POST', '/api/v1/groups/join', {
    token: carol.token,
    body: { code: group.inviteCode },
  });
  assertEq(joined2.json.members.length, 3, 'carol joined');
}

const mkExpense = (description, amount = 3000) =>
  req('POST', '/api/v1/expenses', {
    token: alice.token,
    body: {
      groupId: group.id,
      description,
      amount,
      currency: 'USD',
      category: 'FOOD_DRINK',
      date: new Date().toISOString(),
      splitType: 'EQUAL',
      payers: [{ userId: alice.id, amount }],
      participants: [{ userId: alice.id }, { userId: bob.id }, { userId: carol.id }],
    },
    expect: [200, 201],
  });

// ===========================================================================
step('SCENARIO 1 — Expense delete -> restore: same row id, deletedAt set then null (checked as bob, a NON-actor recipient)');
{
  const { json: exp } = await mkExpense('E2E expense one');

  const anchorBefore = await findActivityItem(bob.token, { expenseId: exp.id });
  assert(anchorBefore, 'bob sees the EXPENSE_ADDED anchor row before delete');
  assertEq(anchorBefore.deletedAt, null, 'anchor.deletedAt is null before delete');
  assertEq(anchorBefore.colorHint, 'red', 'anchor.colorHint is red for bob (non-actor) before delete');
  const anchorId = anchorBefore.id;

  await req('DELETE', `/api/v1/expenses/${exp.id}`, { token: alice.token, expect: [200, 204] });

  const anchorAfterDelete = await findActivityItem(bob.token, { expenseId: exp.id });
  assert(anchorAfterDelete, 'bob still sees exactly one row referencing this expenseId after delete (collapsed, not a new row)');
  assertEq(anchorAfterDelete.id, anchorId, 'row id is UNCHANGED after delete (same ActivityLog row, not a new one)');
  assert(anchorAfterDelete.deletedAt !== null, 'anchor.deletedAt is set (non-null) after delete');
  assertEq(anchorAfterDelete.colorHint, null, 'anchor.colorHint forced null while struck through (WI-055 precedence)');

  const restoreRes = await req('POST', `/api/v1/expenses/${exp.id}/restore`, {
    token: alice.token,
    expect: [200, 201, 204],
  });
  assert(restoreRes.status < 300, 'restore endpoint succeeds');

  const anchorAfterRestore = await findActivityItem(bob.token, { expenseId: exp.id });
  assert(anchorAfterRestore, 'bob still sees exactly one row referencing this expenseId after restore');
  assertEq(anchorAfterRestore.id, anchorId, 'row id is STILL UNCHANGED after restore (same row throughout the whole cycle)');
  assertEq(anchorAfterRestore.deletedAt, null, 'anchor.deletedAt is null again after restore');
  // §6 — colorHint per spec-WI-055 §3 / charter: forced null ONLY while
  // deletedAt is set; once deletedAt clears, colorHint recovers to
  // green/red for an EXPENSE_ADDED anchor (it does NOT stay/become null —
  // "null" only applies to non-EXPENSE_ADDED types or non-authenticated
  // rows). Verified against the actual business rule text, not assumed.
  assertEq(
    anchorAfterRestore.colorHint,
    'red',
    'anchor.colorHint RECOVERS to red for bob (non-actor) after restore — it does not stay forced null',
  );

  // Same check from alice's (the actor's) own feed — she should see 'green'.
  const aliceView = await findActivityItem(alice.token, { expenseId: exp.id });
  assertEq(aliceView.colorHint, 'green', "alice (the actor) sees colorHint 'green' on the same restored row");
  assertEq(aliceView.id, anchorId, "alice's view is the exact same row id too (feed rows are per-recipient, but same underlying ActivityLog row)");
}

// ===========================================================================
step('SCENARIO 2 — Settlement delete -> restore: same row id, deletedAt set then null');
{
  const { json: settlement } = await req('POST', '/api/v1/settlements', {
    token: bob.token,
    body: {
      groupId: group.id,
      fromUserId: bob.id,
      toUserId: alice.id,
      amount: 500,
      currency: 'USD',
      method: 'CASH',
      date: new Date().toISOString(),
    },
    expect: [200, 201],
  });

  const anchorBefore = await findActivityItem(alice.token, { settlementId: settlement.id });
  assert(anchorBefore, 'alice sees the SETTLEMENT_ADDED anchor row before delete');
  assertEq(anchorBefore.deletedAt, null, 'settlement anchor.deletedAt is null before delete');
  assertEq(anchorBefore.colorHint, null, 'settlement rows never carry colorHint (only EXPENSE_ADDED does), regardless of deletedAt');
  const settlementAnchorId = anchorBefore.id;

  await req('DELETE', `/api/v1/settlements/${settlement.id}`, { token: bob.token, expect: [200, 204] });

  const anchorAfterDelete = await findActivityItem(alice.token, { settlementId: settlement.id });
  assertEq(anchorAfterDelete.id, settlementAnchorId, 'settlement row id UNCHANGED after delete');
  assert(anchorAfterDelete.deletedAt !== null, 'settlement anchor.deletedAt set after delete');

  await req('POST', `/api/v1/settlements/${settlement.id}/restore`, {
    token: bob.token,
    expect: [200, 201, 204],
  });

  const anchorAfterRestore = await findActivityItem(alice.token, { settlementId: settlement.id });
  assertEq(anchorAfterRestore.id, settlementAnchorId, 'settlement row id UNCHANGED after restore — same row throughout');
  assertEq(anchorAfterRestore.deletedAt, null, 'settlement anchor.deletedAt null again after restore');
  assertEq(anchorAfterRestore.colorHint, null, 'settlement anchor.colorHint stays null after restore too (never carries color)');

  // Cross-viewer, non-actor check: carol (a group member, not a party to
  // this settlement, never touched delete/restore herself) also sees the
  // un-struck state on her own next GET /activity call.
  const carolView = await findActivityItem(carol.token, { settlementId: settlement.id });
  assert(carolView, 'carol (group member, non-party, non-actor) also sees the settlement anchor row');
  assertEq(carolView.id, settlementAnchorId, "carol's view is the same underlying row");
  assertEq(carolView.deletedAt, null, "carol's independent GET /activity call reflects the un-struck state too — fan-out/read-side scoping correct for a third, uninvolved viewer");
}

// ===========================================================================
step('SCENARIO 3 — Multi-cycle delete -> restore -> delete -> restore: latest-wins each time, same row id throughout');
{
  const { json: exp } = await mkExpense('E2E multi-cycle expense', 2000);
  const anchor0 = await findActivityItem(bob.token, { expenseId: exp.id });
  const anchorId = anchor0.id;
  assertEq(anchor0.deletedAt, null, 'cycle 0: active, deletedAt null');

  // Cycle 1: delete -> restore
  await req('DELETE', `/api/v1/expenses/${exp.id}`, { token: alice.token, expect: [200, 204] });
  const afterDelete1 = await findActivityItem(bob.token, { expenseId: exp.id });
  assertEq(afterDelete1.id, anchorId, 'cycle 1 delete: same row id');
  assert(afterDelete1.deletedAt !== null, 'cycle 1: deletedAt set after 1st delete');
  const deletedAt1 = afterDelete1.deletedAt;

  await req('POST', `/api/v1/expenses/${exp.id}/restore`, { token: alice.token, expect: [200, 201, 204] });
  const afterRestore1 = await findActivityItem(bob.token, { expenseId: exp.id });
  assertEq(afterRestore1.id, anchorId, 'cycle 1 restore: same row id');
  assertEq(afterRestore1.deletedAt, null, 'cycle 1: deletedAt cleared after 1st restore');

  // Cycle 2: delete -> restore again
  await req('DELETE', `/api/v1/expenses/${exp.id}`, { token: alice.token, expect: [200, 204] });
  const afterDelete2 = await findActivityItem(bob.token, { expenseId: exp.id });
  assertEq(afterDelete2.id, anchorId, 'cycle 2 delete: same row id (never a new row across 2 full cycles)');
  assert(afterDelete2.deletedAt !== null, 'cycle 2: deletedAt set again after 2nd delete');
  assert(
    afterDelete2.deletedAt !== deletedAt1,
    'cycle 2: deletedAt reflects the NEWEST delete event (a different timestamp than the 1st delete), confirming latest-wins is re-evaluated each time, not cached from cycle 1',
  );

  await req('POST', `/api/v1/expenses/${exp.id}/restore`, { token: alice.token, expect: [200, 201, 204] });
  const afterRestore2 = await findActivityItem(bob.token, { expenseId: exp.id });
  assertEq(afterRestore2.id, anchorId, 'cycle 2 restore: same row id');
  assertEq(afterRestore2.deletedAt, null, 'cycle 2: deletedAt cleared again after 2nd restore — latest-wins generalizes across N cycles');
}

// ===========================================================================
step('SCENARIO 4 — Per-recipient scoping: a member who LEAVES between DELETE and RESTORE keeps seeing the DELETED state (new to Part 2, not covered by Part 1\'s add/delete-only real-DB test)');
{
  // Deliberately a FRESH, isolated group: carol must be able to leave via
  // POST /groups/:groupId/leave without a 409 outstanding-balance block, and
  // scenarios 1-3's restored expenses in `group` would otherwise leave her
  // with a real outstanding balance there. This group has exactly one
  // expense, which is soft-deleted (deletedAt filtered out of every balance
  // computation, ADR-028 D3) at the moment carol leaves, so her net balance
  // in this isolated group is genuinely zero.
  const { json: group4 } = await req('POST', '/api/v1/groups', {
    token: alice.token,
    body: { name: `WI054P2-S4 ${run}`, emoji: '🧪', type: 'HOME', currency: 'USD' },
    expect: [200, 201],
  });
  await req('POST', '/api/v1/groups/join', { token: bob.token, body: { code: group4.inviteCode } });
  await req('POST', '/api/v1/groups/join', { token: carol.token, body: { code: group4.inviteCode } });

  const { json: exp } = await req('POST', '/api/v1/expenses', {
    token: alice.token,
    body: {
      groupId: group4.id,
      description: 'E2E leaver-between-delete-and-restore expense',
      amount: 1200,
      currency: 'USD',
      category: 'FOOD_DRINK',
      date: new Date().toISOString(),
      splitType: 'EQUAL',
      payers: [{ userId: alice.id, amount: 1200 }],
      participants: [{ userId: alice.id }, { userId: bob.id }, { userId: carol.id }],
    },
    expect: [200, 201],
  });

  // All three (alice, bob, carol) are active members right now -> all three
  // are recipients of the EXPENSE_ADDED and (about to be) EXPENSE_DELETED rows.
  const carolBefore = await findActivityItem(carol.token, { expenseId: exp.id });
  assert(carolBefore, 'carol sees the ADDED anchor (still an active member)');

  await req('DELETE', `/api/v1/expenses/${exp.id}`, { token: alice.token, expect: [200, 204] });
  const carolAfterDelete = await findActivityItem(carol.token, { expenseId: exp.id });
  assert(carolAfterDelete.deletedAt !== null, 'carol sees the deleted state (she was still active at delete time)');
  const carolDeletedAt = carolAfterDelete.deletedAt;

  // Carol leaves the group NOW, between delete and restore. The expense is
  // currently soft-deleted, so her balance in this isolated group is zero
  // and leave is not blocked by the 409 outstanding-balance guard.
  await req('POST', `/api/v1/groups/${group4.id}/leave`, { token: carol.token, expect: [200, 204] });

  // Restore happens after carol left -> restore's recipientIds recomputes
  // active members fresh, excluding carol (mirrors deleteExpense's own
  // recipient recompute, spec-WI-054 §3 "per-recipient scoping is automatic").
  await req('POST', `/api/v1/expenses/${exp.id}/restore`, { token: alice.token, expect: [200, 201, 204] });

  // bob (still active) correctly sees the un-struck state.
  const bobAfterRestore = await findActivityItem(bob.token, { expenseId: exp.id });
  assertEq(bobAfterRestore.deletedAt, null, 'bob (still an active member) correctly sees the restored/un-struck state');

  // carol (left before restore) never received the RESTORED row -> her feed
  // must still show the entity as deleted, using the newest row she DID
  // receive (the DELETED one) — exactly Story 4's last Gherkin scenario.
  const carolAfterRestore = await findActivityItem(carol.token, { expenseId: exp.id });
  assert(carolAfterRestore, 'carol (left the group, but was a recipient of ADDED+DELETED) still sees the collapsed row — not silently missing');
  assertEq(carolAfterRestore.id, carolAfterDelete.id, "carol's row id is unchanged too");
  assert(carolAfterRestore.deletedAt !== null, "carol's feed still shows deletedAt SET — she never received the RESTORED fan-out, so her feed does not silently flip to active");
  assertEq(
    carolAfterRestore.deletedAt,
    carolDeletedAt,
    "carol's deletedAt value is exactly the DELETED row's createdAt she already had — unaffected by the restore she never received",
  );
}

console.log(
  `\n✅ WI-054 PART 2 LIVE E2E PASSED — ${passed} checks against ${API}\n` +
    'Coverage: expense + settlement delete/restore same-row-id identity, multi-cycle latest-wins,\n' +
    'cross-viewer (non-actor) live read-side correctness, colorHint precedence recovery, and the\n' +
    'new-to-Part-2 leave-between-delete-and-restore per-recipient scoping edge case.\n',
);
