# Nevile

Nevile is a Canadian marketplace where customers find, book and pay local home-service
businesses (lawn care, snow and ice removal, cleaning and other year-round household work)
instead of relying on phone calls and word of mouth. Businesses list fixed-price or
quote-based services inside a service radius, run their crew calendars, and get paid weekly
through Stripe Connect; customers book on the website or the iOS/Android app and pay in-app.
Product rules (fees, sales tax, cancellations, disputes, payouts, ratings) are defined in
[SPEC.md](SPEC.md), which is the source of truth. Contributor conventions are in
[CLAUDE.md](CLAUDE.md).

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript 6 (ESM, erasable syntax only; Node runs `.ts` directly) |
| Repo | pnpm 10 workspaces + Turborepo |
| Web | Next.js 16 (App Router, Turbopack) + React 19, Tailwind CSS 4 |
| Mobile | Expo SDK 58 (React Native), Expo Router |
| API | tRPC 11 + superjson, served by the web app at `/api/trpc`, shared by web and mobile |
| Auth | Better Auth (email + password with verification, phone SMS code), served at `/api/auth` |
| Database | PostgreSQL 16 + Drizzle ORM (node-postgres) |
| Validation | Zod 4 |
| Payments | Stripe Connect + Stripe Billing (not wired yet) |
| Lint/format | Biome |
| Tests | Vitest |

## Getting started

### Prerequisites

- Node.js 22.18 or newer (`engines` is enforced)
- pnpm 10.28 (`corepack enable` picks up the version in `package.json`)
- PostgreSQL 16, running locally
- For the mobile app: Xcode (iOS simulator) or Android Studio (emulator), or Expo Go on a phone

### 1. Create the databases

The role owns its databases (tests drop and recreate the `public` schema) and needs
`CREATEDB`, because the auth and API tests create sibling databases such as
`nevile_auth_test` next to `nevile_test`.

```bash
psql -U postgres <<'SQL'
CREATE ROLE nevile WITH LOGIN PASSWORD 'nevile' CREATEDB;
CREATE DATABASE nevile_dev OWNER nevile;
CREATE DATABASE nevile_test OWNER nevile;
SQL
```

### 2. Configure the environment

```bash
cp .env.example .env
# Optional outside production: set BETTER_AUTH_SECRET (openssl rand -base64 32).
# Without it, development uses a fixed insecure secret and logs a warning.
```

The root `.env` is read by the web app (`next.config.ts` loads it), by `db:migrate` /
`db:seed`, and by the database tests (`TEST_DATABASE_URL` only). Variables already set in
your shell take precedence. `.env` is git-ignored; never commit real secrets.

The mobile app does not read the root `.env`. Create `apps/mobile/.env.local` with the web
app's address (see [apps/mobile/README.md](apps/mobile/README.md) for emulator and device
values):

```bash
EXPO_PUBLIC_API_URL=http://localhost:3000
```

### 3. Install, migrate and seed

```bash
pnpm install
pnpm db:migrate   # applies packages/db/drizzle to DATABASE_URL
pnpm db:seed      # upserts the service categories (safe to re-run)
```

Always apply the schema with `db:migrate`, not `drizzle-kit push`: the custom migrations
`0001` and `0004` add the crew double-booking exclusion constraint, the append-only
audit-log triggers, the booking crew-member foreign key, and the payment charge-shape and
refund-cap triggers, which `push` would skip.

### 4. Run the apps

```bash
pnpm --filter @nevile/web dev      # website + API on http://localhost:3000
pnpm --filter @nevile/mobile start # Expo dev server (press i / a, or scan with Expo Go)
```

`pnpm dev` runs every package's `dev` task through Turborepo (today that is the website).
The mobile app talks to the running website for `/api/auth` and `/api/trpc`, so start the
web app first.

In development, verification emails and SMS sign-in codes are printed to the web server's
console instead of being sent. Production refuses to start until real email and SMS
senders are configured in `@nevile/auth`, and until auth rate limiting has a trusted
client IP source (`BETTER_AUTH_TRUSTED_PROXIES` or `BETTER_AUTH_CLIENT_IP_HEADER`, see
`.env.example`).

## Scripts

Run from the repository root.

| Command | What it does |
|---|---|
| `pnpm install` | Install all workspace dependencies. |
| `pnpm dev` | `turbo run dev` (the Next.js dev server). |
| `pnpm build` | `turbo run build` (production build of the website). |
| `pnpm typecheck` | Type-check every package (`turbo run typecheck`). |
| `pnpm test` | Run every package's Vitest suite. Database tests need `TEST_DATABASE_URL` (from the shell or the root `.env`) and skip with a warning without it. |
| `pnpm lint` | Biome lint and format check for the whole repo. |
| `pnpm format` | Biome autofix (formatting, import order, safe fixes). |
| `pnpm db:generate` | Generate a new SQL migration from the Drizzle schema. |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL`. |
| `pnpm db:seed` | Seed reference data (service categories) into `DATABASE_URL`. |
| `pnpm --filter @nevile/web start` | Serve the production build. |
| `pnpm --filter @nevile/mobile ios` / `android` | Start Expo and open a simulator/emulator. |

Mobile bundle smoke test (no simulator needed):

```bash
cd apps/mobile && npx expo export --platform ios --output-dir /tmp/nevile-export
```

If mobile type-checking complains about routes after you add a screen, run
`pnpm --filter @nevile/mobile start` once: Expo regenerates the typed-routes file
(`apps/mobile/.expo/types/router.d.ts`, git-ignored) on start.

## Project layout

```
apps/
  web/        @nevile/web     Next.js website; hosts /api/auth/* and /api/trpc/*
  mobile/     @nevile/mobile  Expo iOS/Android app
packages/
  core/       @nevile/core    Pure domain rules: money, fees, tax, cancellation, booking
                              lifecycle, recurrence, charge schedule, ratings, schemas
  db/         @nevile/db      Drizzle schema, migrations (drizzle/), client, seed, test helpers
  auth/       @nevile/auth    Better Auth server config (.) and client helpers (./client)
  api/        @nevile/api     tRPC router, context and procedures shared by web and mobile
  tokens/     @nevile/tokens  Seasons design tokens shared by web and mobile
SPEC.md       Product spec (source of truth)
CLAUDE.md     Contributor guide and conventions
```

Internal packages are consumed as TypeScript source (`exports` point at `src/*.ts`), so
there is no build step for them. `@nevile/auth/client` is the server-free entry point that
the web browser bundle and the mobile app import; everything else in `@nevile/auth`,
`@nevile/db` and `@nevile/api` is server-only (mobile imports only the `AppRouter` type from
`@nevile/api`).

Key conventions (details in [CLAUDE.md](CLAUDE.md)): money is integer cents in CAD,
timestamps are stored in UTC with local-day logic in the job's IANA time zone, every API
procedure validates input with Zod and authorizes on the server.

## Contributing & CI

Work on a branch and open a pull request into `main`. `main` is protected
([docs/BRANCH_PROTECTION.md](docs/BRANCH_PROTECTION.md)): a pull request can only be merged
once all three CI checks pass, and force pushes are blocked. If a change alters a product
rule, update [SPEC.md](SPEC.md) in the same pull request.

[CI](.github/workflows/ci.yml) runs on every push and pull request (a newer push cancels
the run it replaces):

| Check | What it runs |
|---|---|
| `checks` | `pnpm lint`, `pnpm typecheck`, `pnpm test` against Postgres 16, then `pnpm --filter @nevile/web build` |
| `mobile-bundle` | `expo export` for iOS and Android in `apps/mobile` |
| `e2e` | `pnpm db:migrate` and `pnpm db:seed` into a fresh database, then the Playwright browser tests (`pnpm test:e2e`); on failure the HTML report is uploaded as the `playwright-report` artifact |

Before pushing, run the same checks locally:

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @nevile/web build
pnpm test:e2e   # once: pnpm exec playwright install chromium
```

Dependabot ([.github/dependabot.yml](.github/dependabot.yml)) opens update pull requests
every Monday: one grouped pull request for minor and patch npm updates, one per major
update, and one for GitHub Actions. Expo, React and React Native versions are tied to the
Expo SDK, so only their patch updates are proposed; upgrade them together with
`npx expo install --fix` in `apps/mobile` when moving to a new SDK.

Running the service (environments, configuration, health check, Sentry, backups, the Nevile
Neighbours switch and the incident checklist) is covered in
[docs/OPERATIONS.md](docs/OPERATIONS.md).
