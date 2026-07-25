#!/usr/bin/env node
/**
 * WI-080 end-to-end smoke — per-bucket composition counts on GET /friends.
 * Requires: API running (default http://localhost:4000) against a migrated DB.
 * Usage: node infra/smoke-wi080-bucket-composition.mjs [--api http://localhost:4000]
 *
 * Journeys (story-WI-080 Gherkin, live HTTP, real DB + real rates chain):
 *  1. Multi-bucket friend → group bucket + direct bucket, each carrying
 *     expenseCount / settlementCount populated from the real ledger.
 *  2. Count semantics: group-scoped rows do not leak into other buckets;
 *     expenses and settlements are counted separately; zero kinds are still
 *     emitted by the API (UI omits them at display time).
 *  3. GET /friends/:userId parity — field-identical DTO including counts
 *     (WI-070 §2b + WI-080).
 *  4. Cached second read within 15s serves identical count fields (WI-070/T3).
 *
 * Note: the client's dev-DB "fahad pattern" (direct bucket with two settlements
 * and zero expenses) is not directly reproducible through the public settlement
 * endpoint because WI-012/WI-013 require an outstanding balance before a
 * non-group settlement can be recorded. The route-side count helper still
 * handles that shape correctly — it is covered by the mocked unit tests in
 * apps/api/test/wi080-bucket-composition.test.ts. This smoke focuses on the
 * mixed direct bucket that the API allows end-to-end.
 *
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
  if (actual !== expected) fail(`${msg} — expected ${expected}, got ${actual}`);
  ok(`${msg} (${expected})`);
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
  const expected = Array.isArray(expect) ? [expect].flat() : [expect];
  if (!expected.includes(res.status)) {
    fail(`${method} ${path} → ${res.status}, expected ${expected.join('/')}`, json);
  }
  return { status: res.status, json };
}

function findBucket(dto, predicate) {
  return dto.balancesByGroup.find(predicate);
}

// ---------------------------------------------------------------------------
step('Health');
{
  const { json } = await req('GET', '/health');
  assertEq(json.status, 'ok', 'health status');
}

step('Setup: register ana + sam (USD), one shared group');
const users = {};
for (const name of ['ana', 'sam']) {
  const { json } = await req('POST', '/api/v1/auth/register', {
    body: {
      name: name[0].toUpperCase() + name.slice(1),
      email: `${name}.wi080.${run}@smoke.divzy.dev`,
      password: 'password123!',
      defaultCurrency: 'USD',
    },
    expect: [200, 201],
  });
  assert(json.accessToken && json.user?.id, `${name} registered`);
  users[name] = { ...json.user, token: json.accessToken };
}
const { ana, sam } = users;

const { json: tripGroup } = await req('POST', '/api/v1/groups', {
  token: ana.token,
  body: { name: `Trip to Lahore ${run}`, emoji: '🌴', type: 'TRIP', currency: 'USD' },
  expect: [200, 201],
});
await req('POST', '/api/v1/groups/join', {
  token: sam.token,
  body: { code: tripGroup.inviteCode },
});
ok('Trip to Lahore created + sam joined');

step('Ledger: sam = group expense + group settlement + direct expense + direct settlement');
{
  // Group expense: sam pays 10000, ana owes it all → ana owes sam 10000 (trip).
  await req('POST', '/api/v1/expenses', {
    token: sam.token,
    body: {
      groupId: tripGroup.id,
      description: 'Lahore hotel',
      amount: 10000,
      currency: 'USD',
      category: 'TRAVEL',
      date: new Date().toISOString(),
      splitType: 'EXACT',
      payers: [{ userId: sam.id, amount: 10000 }],
      participants: [
        { userId: ana.id, amount: 10000 },
        { userId: sam.id, amount: 0 },
      ],
    },
    expect: [200, 201],
  });
  // Group settlement: ana → sam 3000 (inside the trip group).
  await req('POST', '/api/v1/settlements', {
    token: ana.token,
    body: {
      groupId: tripGroup.id,
      fromUserId: ana.id,
      toUserId: sam.id,
      amount: 3000,
      currency: 'USD',
      method: 'CASH',
      date: new Date().toISOString(),
    },
    expect: [200, 201],
  });
  // Direct expense: sam pays 1000, ana owes it all.
  await req('POST', '/api/v1/expenses', {
    token: sam.token,
    body: {
      description: 'Movie night',
      amount: 1000,
      currency: 'USD',
      category: 'ENTERTAINMENT',
      date: new Date().toISOString(),
      splitType: 'EXACT',
      payers: [{ userId: sam.id, amount: 1000 }],
      participants: [
        { userId: ana.id, amount: 1000 },
        { userId: sam.id, amount: 0 },
      ],
    },
    expect: [200, 201],
  });
  // Direct settlement: ana → sam 2000.
  await req('POST', '/api/v1/settlements', {
    token: ana.token,
    body: {
      fromUserId: ana.id,
      toUserId: sam.id,
      amount: 2000,
      currency: 'USD',
      method: 'CASH',
      date: new Date().toISOString(),
    },
    expect: [200, 201],
  });
  ok('sam↔ana group + direct ledger recorded');
}

step('GET /api/v1/friends — composition counts present and correct');
let samFriend;
{
  const { json } = await req('GET', '/api/v1/friends', { token: ana.token });
  samFriend = json.find((f) => f.user.id === sam.id);
  assert(samFriend, 'sam present in ana’s friends list');

  // sam: group bucket + direct bucket.
  assertEq(samFriend.balancesByGroup.length, 2, 'sam has group + direct buckets');
  const tripBucket = findBucket(samFriend, (b) => b.group?.id === tripGroup.id);
  const directBucket = findBucket(samFriend, (b) => b.group === null);
  assert(tripBucket, 'trip bucket exists');
  assert(directBucket, 'direct bucket exists');
  assertEq(tripBucket.expenseCount, 1, 'trip bucket expenseCount');
  assertEq(tripBucket.settlementCount, 1, 'trip bucket settlementCount');
  assertEq(tripBucket.balancesNative[0].amount, -7000, 'trip net: ana owes 7000');
  assertEq(directBucket.expenseCount, 1, 'direct bucket expenseCount');
  assertEq(directBucket.settlementCount, 1, 'direct bucket settlementCount');
  // Expense: ana owes sam 1000 (-1000). Settlement: ana → sam 2000 (+2000).
  // Net: sam owes ana 1000 (+1000).
  assertEq(directBucket.balancesNative[0].amount, 1000, 'direct net: sam owes ana 1000');

  // Every emitted bucket has both count fields populated (DRB-architecture N6).
  for (const bucket of samFriend.balancesByGroup) {
    assert(
      typeof bucket.expenseCount === 'number' && typeof bucket.settlementCount === 'number',
      `bucket for ${samFriend.user.name} has both count fields populated`,
      bucket,
    );
  }
}

step('GET /api/v1/friends/:userId — parity with the list entry including counts');
{
  const samSingle = await req('GET', `/api/v1/friends/${sam.id}`, { token: ana.token });
  assertEq(samSingle.status, 200, 'single-read status');
  assert(
    JSON.stringify(samSingle.json.balancesByGroup) === JSON.stringify(samFriend.balancesByGroup),
    'sam single-read carries byte-identical balancesByGroup',
    { single: samSingle.json.balancesByGroup, list: samFriend.balancesByGroup },
  );
}

step('Cached second read within 15s serves identical count fields');
{
  const second = await req('GET', '/api/v1/friends', { token: ana.token });
  const samSecond = second.json.find((f) => f.user.id === sam.id);
  assert(
    JSON.stringify(samSecond.balancesByGroup) === JSON.stringify(samFriend.balancesByGroup),
    'cached second read serves identical sam buckets',
  );
}

console.log(`\n✅ WI-080 smoke: ${passed} checks passed`);
