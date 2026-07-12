# Divzy Architecture

Divzy is an expense-splitting product (Splitwise-class, friendlier UX): groups & friends,
multi-payer expenses, 6 split modes, settle-up with debt simplification, realtime sync,
analytics, recurring expenses — free, no paywalls.

## Monorepo layout

```
divzy/
├── apps/
│   ├── api/        Fastify 5 + Prisma 6 + PostgreSQL 16, socket.io, node-cron
│   ├── web/        Next.js 15 (App Router) + Tailwind + TanStack Query
│   └── mobile/     Expo SDK 53 (expo-router) — iOS + Android
├── packages/
│   ├── shared/     Domain core: money math, split engine, simplification,
│   │               zod schemas, DTO types, constants. SOURCE OF TRUTH.
│   └── api-client/ Typed HTTP client (the API contract). Used by web + mobile.
└── docker-compose.yml   postgres:16 (host port 5433) + mailpit (dev SMTP)
```

Workspace packages ship **TypeScript source** (`main: src/index.ts`) — no build step.
Consumers transpile: Next via `transpilePackages`, Metro natively, the API via tsup
(`noExternal: ['@divzy/shared']`) and tsx in dev. pnpm uses `node-linker=hoisted`
(Metro requirement).

## Non-negotiable invariants

1. **Money is integer minor units** (cents/yen/fils), JS `number`, max ±2_000_000_000
   (Postgres INT4). NEVER floats, NEVER strings, NEVER BigInt in DTOs.
2. **Splits are computed server-side.** Clients send split *inputs* (type + per-user
   exact/percentBps/shares/adjustment/items); the API runs `computeSplits()` from
   `@divzy/shared` and persists its output. Client previews use the SAME function.
3. **Splits always sum exactly to the expense amount** (largest-remainder allocation —
   guaranteed by the engine).
4. **Dates are ISO 8601 strings** in every DTO. DB stores timestamptz.
5. **Currencies never mix silently.** Balances are per-currency; only Analytics converts
   (via the rates service) and flags `usedFallbackRates`.
6. **Soft deletes** for expenses/settlements/comments (`deletedAt`); balance queries
   filter them out.
7. All request validation via the zod schemas in `@divzy/shared` — never hand-rolled.
8. All API responses use the DTO shapes in `@divzy/shared` `types.ts`, built by the
   serializers in `apps/api/src/lib/serializers.ts`. Never return raw Prisma rows.

## Auth model

- Access token: JWT (`@fastify/jwt`, secret `JWT_ACCESS_SECRET`), payload `{ sub: userId }`,
  TTL `ACCESS_TOKEN_TTL_MIN` (default 15 min). Sent as `Authorization: Bearer`.
- Refresh token: 48 random bytes hex, stored **sha256-hashed** in `RefreshToken`,
  TTL `REFRESH_TOKEN_TTL_DAYS`. Rotation on every refresh (old row revoked, linked).
  Reuse of a revoked token ⇒ revoke ALL the user's refresh tokens (401 `TOKEN_REUSED`).
- Web: refresh token ALSO set as httpOnly cookie `divzy_rt`
  (path `/api/v1/auth`, SameSite=Lax, Secure in production). Web client calls
  `auth.refresh()` with no body; API reads the cookie. Mobile stores the refresh token
  in SecureStore and sends it in the body.
- Passwords: argon2id.

## Realtime (socket.io)

Attached to the Fastify HTTP server, path `/ws`. Handshake auth: `auth: { token: <accessToken> }`.
On connect the server joins the socket to `user:<id>`. Client may `group:subscribe(groupId)`
(server verifies membership) to join `group:<id>`.
Events: see `ServerToClientEvents` in `@divzy/shared`. Clients respond by invalidating
the relevant TanStack Query keys (see CONTRACTS.md §Query keys).

## Background jobs (in-process, node-cron)

- `jobs/recurring.ts` — every 15 min: post due `RecurringExpense`s as real expenses,
  advance `nextRunAt` by frequency (looping until in the future), deactivate past `endDate`.
- Rates cache refresh is lazy (on demand, max 1 live fetch per base per 12h).

## Notifications fan-out

One helper (`lib/activity.ts`) does ALL mutation side effects in a consistent order:
1. `ActivityLog` + `ActivityRecipient` rows (recipients = group members or involved users, **including** the actor).
2. `Notification` rows for recipients **except** the actor.
3. Socket emits: `activity:new` + `notification:new` to user rooms, `group:changed` to the group room (or `friends:changed` for non-group).
4. Optional email (SMTP configured + user.emailNotifications) and Expo push — both fire-and-forget with error logging, never blocking the response.

## Error handling

`AppError(statusCode, code, message)` in `lib/errors.ts`; a global error handler maps:
AppError → as-is; ZodError → 400 `VALIDATION_ERROR` (first issue's message);
`SplitError`/`MoneyError` → 400 with their `code`; Prisma P2002 → 409 `CONFLICT`;
P2025 → 404 `NOT_FOUND`; anything else → 500 `INTERNAL` (logged, message hidden in prod).
Response body: `ApiErrorBody` from shared types.

## Frontend state

- Server state: TanStack Query only (no server data in zustand). Query keys and
  invalidation map in CONTRACTS.md — identical on web and mobile.
- Auth state: web keeps the access token in memory (zustand) and silently refreshes via
  cookie on load; mobile persists both tokens in expo-secure-store.
- Money display: ALWAYS `formatMoney()` from shared. Green = they owe you / positive;
  red = you owe / negative (exact colors in STYLE.md).

## Environments

Each app has `.env.example` (the user fills real `.env` later — NEVER hardcode secrets;
read env only via `apps/api/src/config/env.ts` which zod-validates at boot and fails fast
with a readable message listing missing vars).
