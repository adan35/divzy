# Divzy

**Split expenses, stay friends.** Divzy is a production-grade, self-hostable expense-splitting
app (web + iOS + Android) — everything Splitwise does, plus the things it should:
multi-payer expenses, itemized receipt splits, realtime sync, analytics, and no paywalls.

> Suggested domains (checked available at build time): **divzy.app** (~$8.75/yr),
> **divzy.xyz** (~$2.04 first year), **divzy.io**.

## Features

- 👥 **Groups & friends** — trips, homes, couples, projects; direct 1:1 expenses without a group
- 💸 **Six split modes** — equal, exact amounts, percentages, shares, ± adjustments, and
  **itemized** (per-line-item with proportional tax/tip)
- 🤝 **Multiple payers** on a single expense
- 🧮 **Exact integer money math** — largest-remainder allocation; splits always sum to the total
- 🔁 **Debt simplification** — minimal settle-up plan per group (min cash flow)
- 🌍 **Multi-currency** — per-expense currencies, per-currency balances, FX-converted analytics
- ⚡ **Realtime** — socket.io pushes changes to every device instantly
- 🔔 Activity feed, comments, in-app + email + push notifications
- 📈 **Analytics** — monthly trend, category & group breakdowns, period deltas
- 🔁 Recurring expenses (rent, subscriptions) posted automatically
- 🧾 Receipt photo uploads, CSV export, invite links & deep links, dark mode everywhere

## Stack

| App | Tech |
|---|---|
| `apps/api` | Fastify 5 · Prisma 6 · PostgreSQL 16 · socket.io · JWT (rotating refresh) · argon2 |
| `apps/web` | Next.js 15 (App Router) · Tailwind · TanStack Query · Recharts |
| `apps/mobile` | Expo SDK 53 (expo-router) · TanStack Query — one codebase, iOS + Android |
| `packages/shared` | The domain core: money math, split engine, debt simplification, zod schemas, DTO types |
| `packages/api-client` | Typed HTTP client used by web & mobile (the API contract) |

Monorepo: pnpm workspaces + Turborepo. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/CONTRACTS.md](docs/CONTRACTS.md), [docs/STYLE.md](docs/STYLE.md).

## Quickstart (local dev)

Prereqs: Node ≥ 20, pnpm ≥ 9 (`npm i -g pnpm`), Docker.

```bash
pnpm install

# 1. Infrastructure: Postgres (host port 5433) + Mailpit (dev email UI :8026)
docker compose up -d postgres mailpit

# 2. Environment
cp apps/api/.env.example apps/api/.env        # then set the three secrets (openssl rand -hex 32)
cp apps/web/.env.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env

# 3. Database
pnpm db:migrate        # prisma migrate dev
pnpm db:seed           # demo users (ana@divzy.dev / password123, ...)

# 4. Run
pnpm dev:api           # http://localhost:4000  (Swagger at /docs)
pnpm dev:web           # http://localhost:3000
pnpm dev:mobile        # Expo — press i / a, or scan the QR with Expo Go
```

Mobile on a physical device: set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to your
machine's LAN IP (e.g. `http://192.168.1.20:4000`).

## Testing & verification

```bash
pnpm typecheck               # all workspaces
pnpm test                    # unit tests (money math, split engine, simplification, ...)
pnpm build                   # production builds (api + web)
node infra/smoke-test.mjs    # end-to-end API test against a running API
```

## Production

- **API + web via Docker**: `docker compose --profile full up --build`
  (runs migrations on boot). Put a TLS proxy (Caddy/nginx/Traefik) in front.
- **Env**: set real secrets (`openssl rand -hex 32`), `NODE_ENV=production`,
  `CORS_ORIGINS`/`WEB_URL` to your domain, and a real SMTP provider if you want emails.
- **Mobile stores**: build with [EAS](https://docs.expo.dev/build/introduction/):
  `cd apps/mobile && npx eas build --platform all`. Set `EXPO_PUBLIC_API_URL` to your
  API's public URL in `eas.json` build profiles.
- Receipts are stored on local disk (`UPLOAD_DIR`); mount a volume, or swap
  `apps/api/src/routes/uploads.ts` for S3 — it's isolated behind one route.

## Repo scripts

| Command | What |
|---|---|
| `pnpm dev` | everything in dev (turbo) |
| `pnpm db:studio` | Prisma Studio |
| `pnpm format` | Prettier |
| CI | `.github/workflows/ci.yml` — typecheck, tests, builds, migration validation |

## License

[MIT](LICENSE)
