#!/usr/bin/env node
/**
 * WI-087 — live end-to-end verification of the group whiteboard against the
 * real running dev API and a migrated, running Postgres.
 *
 * Drives the full create-group → join → read → edit → silence cycle through
 * live HTTP endpoints, asserting on the real GET/PUT whiteboard routes and on
 * activity/notification counts as seen by a non-actor recipient.
 *
 * Requires: API running (default http://localhost:4000) against a migrated dev DB.
 * Usage: node apps/api/test/wi087-whiteboard-live-e2e.mjs
 * Exits 0 when every check passes; prints and exits 1 on the first failure.
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

async function activityCount(token, groupId) {
  let count = 0;
  let cursor;
  for (let page = 0; page < 20; page += 1) {
    const qs = new URLSearchParams({ limit: '50' });
    qs.set('groupId', groupId);
    if (cursor) qs.set('cursor', cursor);
    const { json } = await req('GET', `/api/v1/activity?${qs}`, { token });
    count += json.items.length;
    if (!json.nextCursor) break;
    cursor = json.nextCursor;
  }
  return count;
}

// ---------------------------------------------------------------------------
step('Health check');
{
  const { json } = await req('GET', '/health');
  assertEq(json.status, 'ok', 'API is up');
}

// ---------------------------------------------------------------------------
step('Register alice (actor), bob (recipient), and carol (outsider)');
const users = {};
for (const name of ['alice', 'bob', 'carol']) {
  const { json } = await req('POST', '/api/v1/auth/register', {
    body: {
      name: name[0].toUpperCase() + name.slice(1),
      email: `${name}.${run}@wi087.divzy.dev`,
      password: 'password123!',
      defaultCurrency: 'USD',
    },
    expect: [200, 201],
  });
  users[name] = { ...json.user, token: json.accessToken };
}
const { alice, bob, carol } = users;
ok('alice, bob, carol registered');

// ---------------------------------------------------------------------------
step('Create a group and have bob join');
let group;
{
  const { json } = await req('POST', '/api/v1/groups', {
    token: alice.token,
    body: { name: `WI087 ${run}`, emoji: '🧪', type: 'HOME', currency: 'USD' },
    expect: [200, 201],
  });
  group = json;
  const joined = await req('POST', '/api/v1/groups/join', {
    token: bob.token,
    body: { code: group.inviteCode },
  });
  assertEq(joined.json.members.length, 2, 'bob joined');
}

// ---------------------------------------------------------------------------
step('SCENARIO 1 — Empty-state read before first edit');
{
  const { json } = await req('GET', `/api/v1/groups/${group.id}/whiteboard`, {
    token: alice.token,
  });
  assertEq(json.body, '', 'body is empty string before first edit');
  assertEq(json.updatedBy, null, 'updatedBy is null before first edit');
  assertEq(json.updatedAt, null, 'updatedAt is null before first edit');
}

// ---------------------------------------------------------------------------
step('SCENARIO 2 — Any active member can edit');
{
  const { json } = await req('PUT', `/api/v1/groups/${group.id}/whiteboard`, {
    token: alice.token,
    body: { body: 'Meet at 9am by the gate' },
  });
  assertEq(json.body, 'Meet at 9am by the gate', 'PUT returns the new body');
  assertEq(json.updatedBy.name, 'Alice', 'updatedBy is alice');
  assert(json.updatedAt !== null, 'updatedAt is set');
}

// ---------------------------------------------------------------------------
step('SCENARIO 3 — Another member sees the edit');
{
  const { json } = await req('GET', `/api/v1/groups/${group.id}/whiteboard`, {
    token: bob.token,
  });
  assertEq(json.body, 'Meet at 9am by the gate', 'bob sees the updated body');
  assertEq(json.updatedBy.name, 'Alice', 'bob sees alice as last editor');
}

// ---------------------------------------------------------------------------
step('SCENARIO 4 — Character cap is enforced');
{
  const bigBody = 'x'.repeat(2001);
  const { status } = await req('PUT', `/api/v1/groups/${group.id}/whiteboard`, {
    token: alice.token,
    body: { body: bigBody },
    expect: 400,
  });
  assertEq(status, 400, 'oversized body rejected');

  const { json } = await req('GET', `/api/v1/groups/${group.id}/whiteboard`, {
    token: alice.token,
  });
  assertEq(json.body, 'Meet at 9am by the gate', 'whiteboard unchanged after rejected PUT');
}

// ---------------------------------------------------------------------------
step('SCENARIO 5 — Non-member cannot read or edit');
{
  const read = await req('GET', `/api/v1/groups/${group.id}/whiteboard`, {
    token: carol.token,
    expect: 404,
  });
  assertEq(read.status, 404, 'non-member GET is 404');

  const write = await req('PUT', `/api/v1/groups/${group.id}/whiteboard`, {
    token: carol.token,
    body: { body: 'Malicious' },
    expect: 404,
  });
  assertEq(write.status, 404, 'non-member PUT is 404');
}

// ---------------------------------------------------------------------------
step('SCENARIO 6 — Empty/clear behavior keeps the row');
{
  const { json } = await req('PUT', `/api/v1/groups/${group.id}/whiteboard`, {
    token: bob.token,
    body: { body: '' },
  });
  assertEq(json.body, '', 'PUT with empty string clears body');
  assertEq(json.updatedBy.name, 'Bob', 'last editor updated to bob');
}

// ---------------------------------------------------------------------------
step('SCENARIO 7 — Silent fan-out: no activity feed item or notification after an edit');
{
  const activityBefore = await activityCount(bob.token, group.id);
  const { json: unreadBefore } = await req('GET', '/api/v1/notifications/unread-count', {
    token: bob.token,
  });

  await req('PUT', `/api/v1/groups/${group.id}/whiteboard`, {
    token: alice.token,
    body: { body: 'Silent edit' },
  });

  const activityAfter = await activityCount(bob.token, group.id);
  const { json: unreadAfter } = await req('GET', '/api/v1/notifications/unread-count', {
    token: bob.token,
  });

  assertEq(activityAfter, activityBefore, 'whiteboard edit created no new activity items for bob');
  assertEq(unreadAfter.count, unreadBefore.count, 'whiteboard edit created no new notifications for bob');
}

console.log(
  `\n✅ WI-087 LIVE E2E PASSED — ${passed} checks against ${API}\n` +
    'Coverage: empty-state read, member edit, cross-member read, character-cap enforcement,\n' +
    'non-member 404, clear behavior, and silent fan-out (zero activity + notification side effects).\n',
);
