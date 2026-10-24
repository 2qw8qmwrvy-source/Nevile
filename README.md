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
| Payments | Stripe Checkout + Stripe Connect Express (`@nevile/payments`; a built-in test provider in development) |
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

Or with Docker (the `nevile` user is a superuser there):

```bash
docker run --name nevile-db -e POSTGRES_USER=nevile -e POSTGRES_PASSWORD=nevile \
  -e POSTGRES_DB=nevile_dev -p 5432:5432 -d postgres:16
docker exec nevile-db createdb -U nevile nevile_test
# Later, after a restart: docker start nevile-db
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
pnpm db:seed      # service categories and starter postal areas (safe to re-run)
```

Always apply the schema with `db:migrate`, not `drizzle-kit push`: the custom migrations
`0001`, `0004` and `0006` add the crew double-booking exclusion constraint, the append-only
audit-log and community-fund-ledger triggers, the booking crew-member foreign key, and the
payment charge-shape and refund-cap triggers, which `push` would skip.

### 4. Run the apps

```bash
pnpm --filter @nevile/web dev      # website + API on http://localhost:3000
pnpm --filter @nevile/mobile start # Expo dev server (press i / a, or scan with Expo Go)
```

`pnpm dev` runs every package's `dev` task through Turborepo (today that is the website).
The mobile app talks to the running website for `/api/auth` and `/api/trpc`, so start the
web app first.

Nevile launches in Nova Scotia only: sign-up needs a Nova Scotia postal code (it starts
with **B**, e.g. `B3H 1A1`) and phone sign-in needs a Canadian mobile number (e.g. a `902`
number).

In development, verification emails and SMS sign-in codes are printed to the web server's
console under `[dev email]` / `[dev sms]` instead of being sent. Production refuses to start until real email and SMS
senders are configured in `@nevile/auth`, and until auth rate limiting has a trusted
client IP source (`BETTER_AUTH_TRUSTED_PROXIES` or `BETTER_AUTH_CLIENT_IP_HEADER`, see
`.env.example`).

### Trying a booking locally

With the default `PAYMENTS_PROVIDER=fake`, no Stripe account is needed:

1. Sign up as a business owner, confirm the email (the link is in the web console), switch
   to business mode and publish a listing with a fixed-price service (Bedford `B4A 1A1`
   covers most of Halifax).
2. In a private window, sign up as a customer, open the pro's page and press **Book a
   time**. The payment step is a test page: **Pay with test card** (Instant Book) or
   **Authorize test card** (a request the pro accepts on their **Calendar**).
3. Business tools are under `/business`: **Calendar** (requests, crew assignment, marking
   jobs done), **Team** (hours, time off, invites, arrival windows) and **Payouts** (test
   payout setup).

Quotes and chat work the same way: as a customer, search with a service chosen, tick up to
3 pros and press **Ask for a quote**; as the business, answer it under **Business → Quotes**.
Each request has its own conversation in the **Inbox**; phone numbers and emails typed in
chat stay hidden from the other side until a booking between them is paid.

Scheduled upkeep (expiring holds, auto-confirming jobs, Monday payouts) runs when something
calls `/api/cron`; locally, set `CRON_SECRET` in `.env` and run
`curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron`.

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
| `pnpm db:seed` | Seed reference data (service categories, starter postal code areas) into `DATABASE_URL`. Safe to re-run. |
| `pnpm db:import-postal-areas <file.csv>` | Load official postal code area centres (Statistics Canada) into `DATABASE_URL`; see [OPERATIONS.md](docs/OPERATIONS.md#maps-and-postal-code-areas). |
| `pnpm test:e2e` | Playwright browser tests (desktop and phone sizes, with axe accessibility checks). Starts the website in development mode on port 3100 against a fresh `nevile_e2e` database (created and reset automatically; set `E2E_DATABASE_URL` to use another `*_e2e` database). Run `pnpm exec playwright install chromium` once first, or point `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at an installed Chromium. |
| `pnpm --filter @nevile/web start` | Serve the production build. |
| `pnpm --filter @nevile/mobile ios` / `android` | Start Expo and open a simulator/emulator. |

Mobile bundle smoke test (no simulator needed):

```bash
cd apps/mobile && npx expo export --platform ios --output-dir /tmp/nevile-export
```

If pages keep reloading by themselves in development, stop the dev server and delete
`apps/web/.next`: a stale Next.js dev cache can cause a reload loop. (Browser tests clear
it on every run.)

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
  storage/    @nevile/storage Photo storage (local folder or S3/R2) and safe image re-encoding
  payments/   @nevile/payments Stripe (Checkout, Connect, refunds, transfers) and a test provider
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
