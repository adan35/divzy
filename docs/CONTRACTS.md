# Divzy Contracts

The HTTP surface is defined by `packages/api-client/src/client.ts` (paths + DTOs) and
`packages/shared/src/schemas.ts` (request validation). This file specifies server
BEHAVIOR: permissions, side effects, and cross-app conventions. Follow it exactly.

## Conventions

- Base path `/api/v1`. JSON in/out. 204 for void responses.
- Pagination: cursor-based. Fetch `limit + 1` rows ordered `[sortField desc, id desc]`;
  if an extra row exists, `nextCursor` = id of the last returned item, else `null`.
  Cursor param = the id of the last seen row (Prisma `cursor` + `skip: 1`).
- IDs are cuids. Unknown id in an authorized scope → 404 `NOT_FOUND`; a resource that
  exists but the caller can't access → 403 `FORBIDDEN` (or 404 to avoid leaking, for
  expenses/groups use 404).
- Rate limits: global 300 req/min/IP; `POST /auth/login|register`: 10/min/IP.

## Route behavior (beyond the obvious CRUD)

### Auth (`routes/auth.ts`, `routes/users.ts`)
- register: email lowercased/unique (409 `EMAIL_TAKEN`), argon2id hash, avatarColor
  assigned round-robin from `AVATAR_COLORS` by user count. Returns `AuthResponseDto` +
  sets refresh cookie. defaultCurrency from input or `USD`.
- login: 401 `INVALID_CREDENTIALS` (identical message whether email exists or not).
- refresh: body token (mobile) takes precedence, else `divzy_rt` cookie (web). Rotate.
- logout: revoke that token (204 even if unknown), clear cookie.
- `GET /users/search?email=` → exact-match `PublicUserDto | null` (never leak email lists).
- password change requires currentPassword; on success revoke all OTHER refresh tokens.

### Groups (`routes/groups.ts`)
- create: creator becomes ADMIN member; inviteCode = 10-char base32 (A-Z2-7) crypto-random.
- list: groups where caller is an active member (leftAt null, group not archived +
  archived ones included with archivedAt set — client filters). `yourBalances` computed
  from the shared balance engine; `lastActivityAt` = latest expense/settlement/activity.
- any member may PATCH name/emoji/type/currency/simplifyDebts.
- ADMIN required: remove member, change role, rotate invite code, archive (DELETE).
- join by code: 404 `INVALID_CODE`; idempotent when already a member (200 with group).
- addMember by email: target must be existing user → 404 `USER_NOT_FOUND`. Also creates
  friendships (new member ↔ every existing member) with `skipDuplicates`.
- member add/join side effect: notification `ADDED_TO_GROUP` / activity `MEMBER_JOINED`.
- leave/remove: 409 `OUTSTANDING_BALANCE` if the member's net ≠ 0 in ANY currency of
  that group. Set `leftAt` (never delete the row — history!). If the last ADMIN leaves,
  promote the longest-standing remaining member.
- `GET /groups/:id/balances` → `GroupBalancesDto`: load non-deleted expenses
  (payers+splits) and settlements of the group, run `computeNets`,
  `computePairwiseBalances`, `suggestSettlements` from shared. `members` includes only
  active members. `suggestions` always computed (client shows per `simplifyDebts`).
- `GET /groups/:id/export.csv` → text/csv, filename header. Columns:
  `Date,Description,Category,Currency,Amount,Paid by,Split type,<member name> ...`
  (one column per active member = that member's net effect: paid − owed), then
  settlement rows with description `Settlement: <from> → <to>`.

### Expenses (`routes/expenses.ts`)
- create: validate `zCreateExpenseInput`; if groupId → caller + every payer/participant
  must be ACTIVE members; else (non-group) → caller MUST be among payers or participants,
  min 2 distinct users total; friendships auto-created among all involved pairs.
  Currency must be supported (400 `UNSUPPORTED_CURRENCY`). Run `computeSplits` —
  persist returned amounts + the raw inputs (shares/percentBps/adjustment) on
  `ExpenseSplit`, items for ITEMIZED. Drop participants whose computed amount is 0?
  NO — persist them (they were included intentionally; UI shows "not involved" only
  when absent).
- update (PATCH = full replacement of payload fields): permission = group member
  (group expense) or involved user (non-group). Re-run computeSplits; replace payers/
  splits/items atomically (transaction: deleteMany + createMany).
- delete: soft (`deletedAt`, `deletedById` recorded via updatedBy). Same permission as update.
- list: `groupId` → member check. `friendId` → expenses (any group or none) where BOTH
  caller and friend appear in payers∪splits. Neither → all caller's expenses.
  Excludes deleted. `search` = case-insensitive contains on description; `category` filter.
- get: includes payers, splits, items, `commentCount`.
- comments: any user who can see the expense; activity `COMMENT_ADDED`, notify involved.
- side effects on create/update/delete: activity (`EXPENSE_ADDED|UPDATED|DELETED`,
  data: `{description, amount, currency}`), notifications to involved-except-actor,
  socket `group:changed`/`friends:changed`.

### Settlements (`routes/settlements.ts`)
- create: caller must be `fromUserId` or `toUserId`. Group settlements: both parties
  active members. Non-group: parties must be friends (or have shared history).
  Activity `SETTLEMENT_ADDED` (data `{amount, currency, fromName, toName}`),
  notification `SETTLEMENT_RECORDED` to the other party. Socket as expenses.
- delete: soft; only fromUser/toUser/creator.
- list: by groupId (member check) or friendId (both parties) or all-mine.

### Balance & friends (`routes/balances.ts`, `routes/friends.ts`)
- `GET /balance`: load ALL non-deleted expenses where caller is payer or split
  participant + all their settlements; `computePairwiseBalances`; totals = sums of
  pairwise debts toward/away from caller per currency → `OverallBalanceDto`.
- `GET /friends`: friendship rows + the same pairwise result filtered per friend →
  `FriendDto[]` sorted by |balance| desc then name. Include friends with zero balance.
- `POST /friends` by email: 404 `USER_NOT_FOUND` if absent; self-add → 400.

### Activity / notifications (`routes/activity.ts`, `routes/notifications.ts`)
- activity list: rows where caller ∈ `ActivityRecipient`, optional groupId filter,
  cursor-paginated, serialized with actor/group preloaded.
- notifications: caller's own; `unread-count` cheap count query; `read-all` bulk update.

### Recurring (`routes/recurring.ts`, `jobs/recurring.ts`)
- create: same membership validation as expenses; validate splits by running
  `computeSplits` once (reject invalid inputs early); `nextRunAt` = startDate.
- job (cron `*/15 * * * *`): due rows → create expense exactly like the expenses route
  (same service function — share it), actor = recurring creator, activity
  `RECURRING_POSTED`; advance nextRunAt (DAILY +1d, WEEKLY +7d, BIWEEKLY +14d,
  MONTHLY +1 month clamped to month end, YEARLY +1y); deactivate when past endDate.
- list/update/delete: creator or (group recurring) any member may view; creator/admin mutate.

### Analytics (`routes/analytics.ts`, `lib/rates.ts`)
- summary: range default = start of month 5 months ago → now. Scope: caller's expenses
  (their split share = `yourSpend`; full amounts = `totalActivity`), optional groupId.
  Convert everything to `query.currency ?? user.defaultCurrency` using rates service:
  live fetch `EXCHANGE_RATE_API_URL/{base}` (open.er-api.com shape: `{rates: {...}}`)
  cached in `ExchangeRateCache` 12h; on failure use `lib/rates-fallback.ts` static table
  and set `usedFallbackRates: true`. `byMonth` = calendar months covering the range
  (zero-filled). `previousYourSpend` = same computation shifted one range-length back.

### Uploads (`routes/uploads.ts`)
- `POST /uploads/receipts` multipart field `file`; allow jpeg/png/webp/heic/pdf,
  ≤ `MAX_UPLOAD_MB`; store `${UPLOAD_DIR}/receipts/<cuid>.<ext>`; respond
  `{url: "/uploads/receipts/<name>"}`. `@fastify/static` serves `/uploads/`.
  Clients render `apiBaseUrl + url`.

### Rates (`routes/analytics.ts` or own file)
- `GET /rates?base=USD` → cached rates map (same service), `source: 'live'|'fallback'`.

## Query keys (TanStack Query — IDENTICAL on web & mobile)

```
['me']                      ['groups']                 ['group', groupId]
['group-balances', groupId] ['expenses', filtersObj]   ['expense', expenseId]
['comments', expenseId]     ['settlements', filtersObj]['friends']
['balance']                 ['activity', groupId|null] ['notifications']
['unread-count']            ['recurring']              ['analytics', paramsObj]
['rates', base]
```
Invalidation map (after mutation → invalidate):
- expense create/update/delete, settlement create/delete →
  `['expenses']*, ['expense', id], ['group', gid], ['groups'], ['group-balances', gid],
   ['balance'], ['friends'], ['activity']*, ['analytics']*` (prefix invalidation).
- group mutations → `['groups'], ['group', id], ['group-balances', id]`.
- comment → `['comments', expenseId], ['expense', expenseId], ['activity']*`.
- notifications read → `['notifications'], ['unread-count']`.
- socket `group:changed {groupId}` → same as expense mutation for that gid.
  `friends:changed` → `['friends'], ['balance'], ['expenses']*, ['activity']*`.
  `notification:new` → `['notifications'], ['unread-count']` (+ toast/badge).

## Shared component/hook manifest (web)

All data hooks live in `apps/web/src/lib/hooks.ts` (web-core). Feature components:
- `components/expenses/expense-editor.tsx` exports
  `ExpenseEditorDialog({ open, onOpenChange, groupId?, friendUserId?, expense?, onSaved? })`
  — create + edit, all 6 split types, multi-payer, itemized rows, receipt upload.
- `components/expenses/expense-list.tsx` exports
  `ExpenseList({ groupId?, friendId?, emptyHint? })` — infinite list, opens detail.
- `components/expenses/expense-detail.tsx` exports
  `ExpenseDetailDialog({ expenseId, open, onOpenChange })` — full breakdown + comments.
- `components/settle/settle-dialog.tsx` exports
  `SettleUpDialog({ open, onOpenChange, groupId?, prefill? })`
  where `prefill = { fromUserId, toUserId, amount, currency }`.
The owning agents are authoritative for these files; consumers import them by these
exact paths/props.

## Mobile route manifest (expo-router)

```
app/(auth)/login.tsx, register.tsx
app/(tabs)/_layout.tsx           tabs: index(Home) groups friends activity account
app/group/[id].tsx               segmented: Expenses | Balances | Totals
app/friend/[id].tsx              shared ledger + settle
app/expense/[id].tsx             detail + comments
app/expense/new.tsx              editor (params: groupId?, friendId?, expenseId? for edit)
app/settle.tsx                   params: groupId?, fromUserId?, toUserId?, amount?, currency?
app/join/[code].tsx              deep link divzy://join/CODE
app/notifications.tsx  app/analytics.tsx  app/recurring.tsx  app/group-form.tsx
```
Data hooks in `src/lib/hooks.ts` (mobile-core) mirror the web names.
