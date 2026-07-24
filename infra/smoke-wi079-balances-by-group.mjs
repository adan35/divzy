#!/usr/bin/env node
/**
 * WI-079 end-to-end smoke — per-group balance breakdown on GET /friends.
 * Requires: API running (default http://localhost:4000) against a migrated DB.
 * Usage: node infra/smoke-wi079-balances-by-group.mjs [--api http://localhost:4000]
 *
 * Journeys (story-WI-079 Gherkin, live HTTP, real DB + real rates chain):
 *  1. Multi-group + direct friend → one bucket per shared group + one direct
 *     bucket, each with native/converted/fallback, labels from membership.
 *  2. Reconciliation invariant: Σ bucket.balancesNative === top-level
 *     balancesNative per currency.
 *  3. Deterministic DTO order: magnitude desc (no ties here).
 *  4. GET /friends/:userId parity — field-identical DTO (WI-070 §2b).
 *  5. Settled group bucket dropped after an exact in-group settlement.
 *  6. Cached second read within 15s serves identical buckets (WI-070/T3).
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

function expectReconciliation(dto) {
  const bucketTotals = new Map();
  for (const bucket of dto.balancesByGroup) {
    for (const entry of bucket.balancesNative) {
      bucketTotals.set(entry.currency, (bucketTotals.get(entry.currency) ?? 0) + entry.amount);
    }
  }
  const currencies = new Set([...bucketTotals.keys(), ...dto.balancesNative.map((b) => b.currency)]);
  for (const currency of currencies) {
    const top = dto.balancesNative.find((b) => b.currency === currency)?.amount ?? 0;
    assertEq(bucketTotals.get(currency) ?? 0, top, `reconciliation: Σ buckets === top-level (${currency})`);
  }
}

// ---------------------------------------------------------------------------
step('Health');
{
  const { json } = await req('GET', '/health');
  assertEq(json.status, 'ok', 'health status');
}

step('Setup: register ana + sam (USD), two shared groups');
const users = {};
for (const name of ['ana', 'sam']) {
  const { json } = await req('POST', '/api/v1/auth/register', {
    body: {
      name: name[0].toUpperCase() + name.slice(1),
      email: `${name}.wi079.${run}@smoke.divzy.dev`,
      password: 'password123!',
      defaultCurrency: 'USD',
    },
    expect: [200, 201],
  });
  assert(json.accessToken && json.user?.id, `${name} registered`);
  users[name] = { ...json.user, token: json.accessToken };
}
const { ana, sam } = users;

const groups = {};
for (const [key, name, emoji, type] of [
  ['trip', `Trip to Lahore ${run}`, '🌴', 'TRIP'],
  ['home', `Roommates ${run}`, '🏠', 'HOME'],
]) {
  const { json } = await req('POST', '/api/v1/groups', {
    token: ana.token,
    body: { name, emoji, type, currency: 'USD' },
    expect: [200, 201],
  });
  groups[key] = json;
  await req('POST', '/api/v1/groups/join', {
    token: sam.token,
    body: { code: json.inviteCode },
  });
  ok(`${name}: created + sam joined`);
}

step('Ledger: group expenses (both directions) + one direct expense');
{
  // Trip group: sam pays 10000, ana owes it all → ana owes sam 10000 (trip).
  await req('POST', '/api/v1/expenses', {
    token: sam.token,
    body: {
      groupId: groups.trip.id,
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
  // Home group: ana pays 4000, sam owes it all → sam owes ana 4000 (home).
  await req('POST', '/api/v1/expenses', {
    token: ana.token,
    body: {
      groupId: groups.home.id,
      description: 'Rent share',
      amount: 4000,
      currency: 'USD',
      category: 'UTILITIES',
      date: new Date().toISOString(),
      splitType: 'EXACT',
      payers: [{ userId: ana.id, amount: 4000 }],
      participants: [
        { userId: sam.id, amount: 4000 },
        { userId: ana.id, amount: 0 },
      ],
    },
    expect: [200, 201],
  });
  // Direct (non-group): sam pays 2000, ana owes it all → ana owes sam 2000.
  await req('POST', '/api/v1/expenses', {
    token: sam.token,
    body: {
      description: 'Movie night',
      amount: 2000,
      currency: 'USD',
      category: 'ENTERTAINMENT',
      date: new Date().toISOString(),
      splitType: 'EXACT',
      payers: [{ userId: sam.id, amount: 2000 }],
      participants: [
        { userId: ana.id, amount: 2000 },
        { userId: sam.id, amount: 0 },
      ],
    },
    expect: [200, 201],
  });
  ok('three expenses recorded (trip 10000, home 4000, direct 2000)');
}

step('GET /friends — per-group breakdown shape + reconciliation');
let samFriend;
{
  const { json } = await req('GET', '/api/v1/friends', { token: ana.token });
  samFriend = json.find((f) => f.user.id === sam.id);
  assert(samFriend, 'sam present in ana’s friends list');
  assert(Array.isArray(samFriend.balancesByGroup), 'balancesByGroup present (array)');

  // Top-level collapsed net unchanged: -10000 + 4000 - 2000 = -8000 USD.
  assertEq(samFriend.balancesNative.length, 1, 'one native currency');
  assertEq(samFriend.balancesNative[0].amount, -8000, 'top-level USD net');
  assertEq(samFriend.balancesConverted?.amount, -8000, 'top-level converted (USD→USD)');

  assertEq(samFriend.balancesByGroup.length, 3, 'one bucket per group + one direct bucket');
  const [trip, home, direct] = samFriend.balancesByGroup; // magnitude desc: 10000, 4000, 2000
  assertEq(trip.group?.id, groups.trip.id, 'bucket[0] is the trip group (largest magnitude)');
  assertEq(trip.group?.name, groups.trip.name, 'trip bucket label name');
  assertEq(trip.group?.emoji, '🌴', 'trip bucket label emoji');
  assertEq(trip.balancesNative[0].amount, -10000, 'trip bucket native net');
  assertEq(trip.balancesConverted?.amount, -10000, 'trip bucket converted');
  assertEq(trip.usedFallbackRates, false, 'trip bucket fallback flag');
  assertEq(home.group?.id, groups.home.id, 'bucket[1] is the home group');
  assertEq(home.balancesNative[0].amount, 4000, 'home bucket native net (sam owes ana)');
  assertEq(direct.group, null, 'bucket[2] is the direct/non-group bucket');
  assertEq(direct.balancesNative[0].amount, -2000, 'direct bucket native net');

  expectReconciliation(samFriend);
}

step('GET /friends/:userId — parity with the list entry (WI-070 §2b)');
{
  const { json } = await req('GET', `/api/v1/friends/${sam.id}`, { token: ana.token });
  assert(
    JSON.stringify(json.balancesByGroup) === JSON.stringify(samFriend.balancesByGroup),
    'single-friend read carries byte-identical balancesByGroup',
    { single: json.balancesByGroup, list: samFriend.balancesByGroup },
  );
  assertEq(json.balancesNative[0].amount, -8000, 'single-read top-level net matches');
  expectReconciliation(json);
}

step('Settled group bucket dropped after an exact in-group settlement');
{
  await req('POST', '/api/v1/settlements', {
    token: sam.token,
    body: {
      groupId: groups.home.id,
      fromUserId: sam.id,
      toUserId: ana.id,
      amount: 4000,
      currency: 'USD',
      method: 'CASH',
      date: new Date().toISOString(),
    },
    expect: [200, 201],
  });
  ok('home-group settlement recorded (sam → ana 4000)');

  // The settlement write bumps the WI-070 cache generation, so this read is fresh.
  const { json } = await req('GET', '/api/v1/friends', { token: ana.token });
  const after = json.find((f) => f.user.id === sam.id);
  assert(after, 'sam still present');
  assertEq(after.balancesNative[0].amount, -12000, 'top-level net after settle (-10000 - 2000)');
  assertEq(after.balancesByGroup.length, 2, 'settled home bucket dropped');
  assert(
    after.balancesByGroup.every((b) => b.group?.id !== groups.home.id),
    'no bucket references the settled group',
  );
  assertEq(after.balancesByGroup[0].group?.id, groups.trip.id, 'trip bucket remains first');
  assertEq(after.balancesByGroup[1].group, null, 'direct bucket remains');
  expectReconciliation(after);

  // Cached second read within the 15s TTL serves identical buckets (T3, live).
  const second = await req('GET', '/api/v1/friends', { token: ana.token });
  const afterSecond = second.json.find((f) => f.user.id === sam.id);
  assert(
    JSON.stringify(afterSecond.balancesByGroup) === JSON.stringify(after.balancesByGroup),
    'cached second read serves identical buckets',
  );
}

console.log(`\n✅ WI-079 smoke: ${passed} checks passed`);
