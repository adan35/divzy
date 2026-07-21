#!/usr/bin/env node
/**
 * Divzy API end-to-end smoke test.
 * Requires: API running (default http://localhost:4000) against a migrated DB.
 * Usage: node infra/smoke-test.mjs [--api http://localhost:4000]
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

async function req(method, path, { token, body, formData, expect = 200 } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
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

const money = (n) => n; // amounts are integer minor units already

// ---------------------------------------------------------------------------
step('Health');
{
  const { json } = await req('GET', '/health');
  assertEq(json.status, 'ok', 'health status');
}

// ---------------------------------------------------------------------------
step('Auth: register 4 users');
const users = {};
for (const name of ['ana', 'sam', 'lee', 'zoe']) {
  const { json } = await req('POST', '/api/v1/auth/register', {
    body: {
      name: name[0].toUpperCase() + name.slice(1),
      email: `${name}.${run}@smoke.divzy.dev`,
      password: 'password123!',
      defaultCurrency: 'EUR',
    },
    expect: [200, 201],
  });
  assert(json.accessToken && json.refreshToken && json.user?.id, `${name} registered`);
  users[name] = { ...json.user, token: json.accessToken, refresh: json.refreshToken };
}
const { ana, sam, lee, zoe } = users;

step('Auth: login + me + wrong password');
{
  const { json } = await req('POST', '/api/v1/auth/login', {
    body: { identifier: `ana.${run}@smoke.divzy.dev`, password: 'password123!' },
  });
  assert(json.accessToken, 'login returns access token');
  ana.token = json.accessToken;
  ana.refresh = json.refreshToken;
  const me = await req('GET', '/api/v1/auth/me', { token: ana.token });
  assertEq(me.json.email, `ana.${run}@smoke.divzy.dev`, 'me email');
  await req('POST', '/api/v1/auth/login', {
    body: { identifier: `ana.${run}@smoke.divzy.dev`, password: 'wrong-password' },
    expect: 401,
  });
  ok('wrong password → 401');
  await req('GET', '/api/v1/auth/me', { expect: 401 });
  ok('no token → 401');
}

step('Auth: refresh rotation + reuse detection (zoe)');
{
  const r1 = await req('POST', '/api/v1/auth/refresh', { body: { refreshToken: zoe.refresh } });
  assert(r1.json.refreshToken && r1.json.refreshToken !== zoe.refresh, 'refresh rotates token');
  const oldToken = zoe.refresh;
  zoe.refresh = r1.json.refreshToken;
  zoe.token = r1.json.accessToken;
  await req('POST', '/api/v1/auth/refresh', { body: { refreshToken: oldToken }, expect: 401 });
  ok('reused refresh token rejected (401)');
}

// ---------------------------------------------------------------------------
step('Groups: create, join by code, add member');
let group;
{
  const { json } = await req('POST', '/api/v1/groups', {
    token: ana.token,
    body: { name: `Lisbon ${run}`, emoji: '✈️', type: 'TRIP', currency: 'EUR' },
    expect: [200, 201],
  });
  group = json;
  assert(group.inviteCode?.length >= 4, 'group created with invite code');
  assertEq(group.members.length, 1, 'creator is sole member');

  const joined = await req('POST', '/api/v1/groups/join', {
    token: sam.token,
    body: { code: group.inviteCode },
  });
  assertEq(joined.json.members.length, 2, 'sam joined via code');

  const added = await req('POST', `/api/v1/groups/${group.id}/members`, {
    token: ana.token,
    body: { email: `lee.${run}@smoke.divzy.dev` },
    expect: [200, 201],
  });
  assertEq(added.json.members.length, 3, 'lee added by email');

  await req('POST', '/api/v1/groups/join', {
    token: zoe.token,
    body: { code: 'NOPE404XX' },
    expect: 404,
  });
  ok('bad invite code → 404');

  await req('GET', `/api/v1/groups/${group.id}`, { token: zoe.token, expect: [403, 404] });
  ok('non-member cannot read group');
}

// ---------------------------------------------------------------------------
step('Expenses: all six split types + multi-payer');
const mk = (body, token = ana.token) =>
  req('POST', '/api/v1/expenses', { token, body, expect: [200, 201] });

let equalExp;
{
  // EQUAL 100.00 EUR paid by ana → splits [3334,3333,3333]
  const { json } = await mk({
    groupId: group.id,
    description: 'Dinner',
    amount: 10000,
    currency: 'EUR',
    category: 'FOOD_DRINK',
    date: new Date().toISOString(),
    splitType: 'EQUAL',
    payers: [{ userId: ana.id, amount: 10000 }],
    participants: [{ userId: ana.id }, { userId: sam.id }, { userId: lee.id }],
  });
  equalExp = json;
  const total = json.splits.reduce((a, s) => a + s.amount, 0);
  assertEq(total, 10000, 'EQUAL splits sum to total');
  assert(
    json.splits.every((s) => s.amount === 3333 || s.amount === 3334),
    'EQUAL split amounts are 3333/3334',
    json.splits,
  );
}
{
  // EXACT paid by sam
  const { json } = await mk(
    {
      groupId: group.id,
      description: 'Museum tickets',
      amount: 6000,
      currency: 'EUR',
      category: 'ENTERTAINMENT',
      date: new Date().toISOString(),
      splitType: 'EXACT',
      payers: [{ userId: sam.id, amount: 6000 }],
      participants: [
        { userId: ana.id, amount: 1000 },
        { userId: sam.id, amount: 2000 },
        { userId: lee.id, amount: 3000 },
      ],
    },
    sam.token,
  );
  assertEq(json.splits.reduce((a, s) => a + s.amount, 0), 6000, 'EXACT splits sum');
}
{
  // PERCENT 33.33/33.33/33.34
  const { json } = await mk({
    groupId: group.id,
    description: 'Taxi',
    amount: 2500,
    currency: 'EUR',
    category: 'TRANSPORT',
    date: new Date().toISOString(),
    splitType: 'PERCENT',
    payers: [{ userId: lee.id, amount: 2500 }],
    participants: [
      { userId: ana.id, percentBps: 3333 },
      { userId: sam.id, percentBps: 3333 },
      { userId: lee.id, percentBps: 3334 },
    ],
  });
  assertEq(json.splits.reduce((a, s) => a + s.amount, 0), 2500, 'PERCENT splits sum');
}
{
  // SHARES 2/1
  const { json } = await mk({
    groupId: group.id,
    description: 'Groceries',
    amount: 900,
    currency: 'EUR',
    category: 'GROCERIES',
    date: new Date().toISOString(),
    splitType: 'SHARES',
    payers: [{ userId: ana.id, amount: 900 }],
    participants: [
      { userId: ana.id, shares: 2 },
      { userId: sam.id, shares: 1 },
    ],
  });
  const bySam = json.splits.find((s) => s.user.id === sam.id);
  assertEq(bySam.amount, 300, 'SHARES: sam owes 1/3');
}
{
  // ADJUSTMENT
  const { json } = await mk({
    groupId: group.id,
    description: 'Wine (sam had extra)',
    amount: 1000,
    currency: 'EUR',
    category: 'FOOD_DRINK',
    date: new Date().toISOString(),
    splitType: 'ADJUSTMENT',
    payers: [{ userId: ana.id, amount: 1000 }],
    participants: [{ userId: ana.id }, { userId: sam.id, adjustment: 200 }],
  });
  const samSplit = json.splits.find((s) => s.user.id === sam.id);
  assertEq(samSplit.amount, 600, 'ADJUSTMENT: sam owes base+200');
}
{
  // ITEMIZED with fee
  const { json } = await mk({
    groupId: group.id,
    description: 'Brunch itemized',
    amount: 1000,
    currency: 'EUR',
    category: 'FOOD_DRINK',
    date: new Date().toISOString(),
    splitType: 'ITEMIZED',
    payers: [{ userId: ana.id, amount: 1000 }],
    participants: [{ userId: ana.id }, { userId: sam.id }],
    items: [
      { name: 'Pasta', amount: 600, participantIds: [ana.id, sam.id] },
      { name: 'Juice', amount: 300, participantIds: [sam.id] },
    ],
  });
  assertEq(json.splits.reduce((a, s) => a + s.amount, 0), 1000, 'ITEMIZED splits sum (with fee)');
  assert(json.items.length === 2, 'ITEMIZED items persisted');
}
{
  // Multi-payer
  const { json } = await mk({
    groupId: group.id,
    description: 'Airbnb',
    amount: 30000,
    currency: 'EUR',
    category: 'TRAVEL',
    date: new Date().toISOString(),
    splitType: 'EQUAL',
    payers: [
      { userId: ana.id, amount: 20000 },
      { userId: sam.id, amount: 10000 },
    ],
    participants: [{ userId: ana.id }, { userId: sam.id }, { userId: lee.id }],
  });
  assertEq(json.payers.length, 2, 'multi-payer persisted');
}
{
  // Validation failures
  await req('POST', '/api/v1/expenses', {
    token: ana.token,
    body: {
      groupId: group.id,
      description: 'Bad payer sum',
      amount: 1000,
      currency: 'EUR',
      date: new Date().toISOString(),
      splitType: 'EQUAL',
      payers: [{ userId: ana.id, amount: 999 }],
      participants: [{ userId: ana.id }, { userId: sam.id }],
    },
    expect: 400,
  });
  ok('payer sum mismatch → 400');
  await req('POST', '/api/v1/expenses', {
    token: zoe.token,
    body: {
      groupId: group.id,
      description: 'Outsider expense',
      amount: 1000,
      currency: 'EUR',
      date: new Date().toISOString(),
      splitType: 'EQUAL',
      payers: [{ userId: zoe.id, amount: 1000 }],
      participants: [{ userId: zoe.id }],
    },
    expect: [400, 403, 404],
  });
  ok('non-member cannot add group expense');
}

// ---------------------------------------------------------------------------
step('Balances: zero-sum + settle-up suggestions');
let balances;
{
  const { json } = await req('GET', `/api/v1/groups/${group.id}/balances`, { token: ana.token });
  balances = json;
  const byCurrency = {};
  for (const m of json.members)
    for (const b of m.balances) byCurrency[b.currency] = (byCurrency[b.currency] ?? 0) + b.amount;
  for (const [cur, sum] of Object.entries(byCurrency)) assertEq(sum, 0, `nets zero-sum (${cur})`);
  assert(Array.isArray(json.suggestions) && json.suggestions.length > 0, 'suggestions present');
  assert(Array.isArray(json.pairwise) && json.pairwise.length > 0, 'pairwise present');

  // Applying every suggestion must zero every member
  const nets = new Map();
  for (const m of json.members)
    for (const b of m.balances) nets.set(`${b.currency}|${m.user.id}`, b.amount);
  for (const s of json.suggestions) {
    nets.set(`${s.currency}|${s.fromUserId}`, (nets.get(`${s.currency}|${s.fromUserId}`) ?? 0) + s.amount);
    nets.set(`${s.currency}|${s.toUserId}`, (nets.get(`${s.currency}|${s.toUserId}`) ?? 0) - s.amount);
  }
  assert([...nets.values()].every((v) => v === 0), 'suggestions fully settle the group');
}

step('Settlements: record + balance shift');
{
  const suggestion = balances.suggestions[0];
  const payerToken = [ana, sam, lee].find((u) => u.id === suggestion.fromUserId)?.token;
  const { json } = await req('POST', '/api/v1/settlements', {
    token: payerToken,
    body: {
      groupId: group.id,
      fromUserId: suggestion.fromUserId,
      toUserId: suggestion.toUserId,
      amount: suggestion.amount,
      currency: suggestion.currency,
      method: 'CASH',
      date: new Date().toISOString(),
    },
    expect: [200, 201],
  });
  assert(json.id, 'settlement recorded');
  const after = await req('GET', `/api/v1/groups/${group.id}/balances`, { token: ana.token });
  const fromNet = after.json.members
    .find((m) => m.user.id === suggestion.fromUserId)
    ?.balances.find((b) => b.currency === suggestion.currency);
  assert(!fromNet || fromNet.amount === 0, 'payer settled to zero in that currency');
}

step('Leave with outstanding balance blocked');
{
  const after = await req('GET', `/api/v1/groups/${group.id}/balances`, { token: sam.token });
  const samNet = after.json.members.find((m) => m.user.id === sam.id);
  const owing = samNet?.balances.some((b) => b.amount !== 0);
  if (owing) {
    await req('POST', `/api/v1/groups/${group.id}/leave`, { token: sam.token, expect: 409 });
    ok('leave with balance → 409');
  } else {
    ok('sam already settled — skip leave-block check');
  }
}

// ---------------------------------------------------------------------------
step('Non-group friend expense + friends list');
{
  await mk(
    {
      description: 'Movie night',
      amount: 2500,
      currency: 'USD',
      category: 'ENTERTAINMENT',
      date: new Date().toISOString(),
      splitType: 'EQUAL',
      payers: [{ userId: ana.id, amount: 2500 }],
      participants: [{ userId: ana.id }, { userId: zoe.id }],
    },
    ana.token,
  );
  const { json } = await req('GET', '/api/v1/friends', { token: ana.token });
  const zoeFriend = json.find((f) => f.user.id === zoe.id);
  assert(zoeFriend, 'zoe auto-added as friend via shared expense');
  // USD fully converts into ana's defaultCurrency, so the unconvertible-leftover
  // `balances` array is empty and the converted figure lives in
  // `balancesConverted` (spec-WI-001 GET /friends addendum, 2026-07-14).
  assertEq(zoeFriend.balances.length, 0, 'no unconvertible leftover currencies');
  assertEq(
    zoeFriend.balancesConverted?.currency,
    ana.defaultCurrency,
    "converted balance is in ana's default currency",
  );
  assert(
    zoeFriend.balancesConverted?.amount > 0,
    'zoe owes ana 12.50 USD (positive converted friend balance)',
  );

  const overall = await req('GET', '/api/v1/balance', { token: zoe.token });
  const owes = overall.json.youOwe.find((b) => b.currency === 'USD');
  assertEq(owes?.amount, 1250, 'zoe overall youOwe 1250 USD');
}

// ---------------------------------------------------------------------------
step('Expense update / delete');
{
  const upd = await req('PATCH', `/api/v1/expenses/${equalExp.id}`, {
    token: sam.token,
    body: {
      description: 'Dinner (fixed)',
      amount: 9000,
      currency: 'EUR',
      category: 'FOOD_DRINK',
      date: equalExp.date,
      splitType: 'EQUAL',
      payers: [{ userId: ana.id, amount: 9000 }],
      participants: [{ userId: ana.id }, { userId: sam.id }, { userId: lee.id }],
    },
  });
  assertEq(upd.json.amount, 9000, 'expense updated');
  assertEq(upd.json.splits.reduce((a, s) => a + s.amount, 0), 9000, 'updated splits sum');

  const tmp = await mk({
    groupId: group.id,
    description: 'Oops duplicate',
    amount: 500,
    currency: 'EUR',
    date: new Date().toISOString(),
    splitType: 'EQUAL',
    payers: [{ userId: ana.id, amount: 500 }],
    participants: [{ userId: ana.id }, { userId: sam.id }],
  });
  await req('DELETE', `/api/v1/expenses/${tmp.json.id}`, { token: ana.token, expect: [200, 204] });
  await req('GET', `/api/v1/expenses/${tmp.json.id}`, { token: ana.token, expect: [404, 410, 200] }).then(
    (r) => {
      if (r.status === 200 && !r.json.deletedAt) fail('deleted expense still visible without deletedAt');
      ok('deleted expense handled');
    },
  );
}

// ---------------------------------------------------------------------------
step('Comments, activity, notifications');
{
  const c = await req('POST', `/api/v1/expenses/${equalExp.id}/comments`, {
    token: sam.token,
    body: { body: 'Was it really 90?' },
    expect: [200, 201],
  });
  assert(c.json.id, 'comment created');
  const list = await req('GET', `/api/v1/expenses/${equalExp.id}/comments`, { token: ana.token });
  assert(list.json.some((x) => x.body.includes('really 90')), 'comment listed');

  const act = await req('GET', '/api/v1/activity?limit=50', { token: lee.token });
  assert(act.json.items.length >= 3, 'activity feed populated for lee');

  const unread = await req('GET', '/api/v1/notifications/unread-count', { token: lee.token });
  assert(unread.json.count >= 1, 'lee has unread notifications');
  await req('POST', '/api/v1/notifications/read-all', { token: lee.token, expect: [200, 204] });
  const unread2 = await req('GET', '/api/v1/notifications/unread-count', { token: lee.token });
  assertEq(unread2.json.count, 0, 'read-all zeroes unread count');
}

// ---------------------------------------------------------------------------
step('Analytics, rates, CSV export, expense list filters');
{
  const a = await req('GET', '/api/v1/analytics/summary?currency=EUR', { token: ana.token });
  assertEq(a.json.currency, 'EUR', 'analytics currency');
  assert(a.json.yourSpend > 0, 'analytics yourSpend > 0');
  assert(a.json.byMonth.length >= 1 && a.json.byCategory.length >= 1, 'analytics breakdowns');

  const r = await req('GET', '/api/v1/rates?base=USD', { token: ana.token });
  assert(r.json.rates && typeof r.json.rates.EUR === 'number', 'rates include EUR');

  const csv = await req('GET', `/api/v1/groups/${group.id}/export.csv`, { token: ana.token });
  const csvText = typeof csv.json === 'string' ? csv.json : JSON.stringify(csv.json);
  assert(csvText.includes('Description') || csvText.includes('description'), 'CSV has header');
  assert(csvText.includes('Ana'), 'CSV includes member column');

  const filtered = await req(
    'GET',
    `/api/v1/expenses?groupId=${group.id}&category=FOOD_DRINK&limit=50`,
    { token: ana.token },
  );
  assert(
    filtered.json.items.every((e) => e.category === 'FOOD_DRINK'),
    'category filter respected',
  );
  const search = await req('GET', `/api/v1/expenses?groupId=${group.id}&search=airbnb`, {
    token: ana.token,
  });
  assert(search.json.items.some((e) => e.description === 'Airbnb'), 'search finds Airbnb');
}

// ---------------------------------------------------------------------------
step('Recurring');
{
  const start = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const { json } = await req('POST', '/api/v1/recurring', {
    token: ana.token,
    body: {
      groupId: group.id,
      description: 'Streaming sub',
      amount: 1500,
      currency: 'EUR',
      category: 'SUBSCRIPTIONS',
      splitType: 'EQUAL',
      payers: [{ userId: ana.id, amount: 1500 }],
      participants: [{ userId: ana.id }, { userId: sam.id }, { userId: lee.id }],
      frequency: 'MONTHLY',
      startDate: start,
    },
    expect: [200, 201],
  });
  assert(json.id && json.active, 'recurring created');
  const list = await req('GET', '/api/v1/recurring', { token: sam.token });
  assert(list.json.some((x) => x.id === json.id), 'recurring visible to group member');
  await req('DELETE', `/api/v1/recurring/${json.id}`, { token: ana.token, expect: [200, 204] });
  ok('recurring deleted');
}

// ---------------------------------------------------------------------------
step('Receipt upload');
{
  // 1x1 transparent PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'receipt.png');
  const up = await req('POST', '/api/v1/uploads/receipts', {
    token: ana.token,
    formData: fd,
    expect: [200, 201],
  });
  assert(up.json.url?.startsWith('/uploads/'), 'upload returns /uploads/ url');
  const img = await fetch(`${API}${up.json.url}`);
  assertEq(img.status, 200, 'uploaded file is served');
}

// ---------------------------------------------------------------------------
step('User profile + search + logout');
{
  const u = await req('PATCH', '/api/v1/users/me', {
    token: ana.token,
    body: { name: 'Ana Águas', defaultCurrency: 'EUR' },
  });
  assertEq(u.json.name, 'Ana Águas', 'profile updated');
  const s = await req('GET', `/api/v1/users/search?email=sam.${run}@smoke.divzy.dev`, {
    token: ana.token,
  });
  assertEq(s.json?.id, sam.id, 'user search by exact email');
  await req('POST', '/api/v1/auth/logout', {
    token: zoe.token,
    body: { refreshToken: zoe.refresh },
    expect: [200, 204],
  });
  ok('logout');
}

console.log(`\n✅ SMOKE TEST PASSED — ${passed} checks against ${API}\n`);
