# Nevile — contributor guide

`SPEC.md` is the source of truth for product rules. Read the relevant section before
changing behaviour; if code and spec disagree, the spec wins (or update the spec in the
same change).

## Layout

pnpm + Turborepo monorepo, TypeScript 6, ESM everywhere.

| Path | Package | Purpose |
|---|---|---|
| `packages/core` | `@nevile/core` | Pure domain rules: money, fees, tax, cancellation, booking lifecycle, recurrence, ratings. No I/O. |
| `packages/tokens` | `@nevile/tokens` | Seasons design tokens shared by web and mobile. |
| `packages/db` | `@nevile/db` | Drizzle schema, migrations (`packages/db/drizzle`), client, seed. |
| `packages/auth` | `@nevile/auth` | Better Auth server config (`.`) and client helpers (`./client`). |
| `packages/api` | `@nevile/api` | tRPC router shared by web and mobile. |
| `apps/web` | `@nevile/web` | Next.js 16 website; hosts `/api/auth/*` and `/api/trpc/*`. |
| `apps/mobile` | `@nevile/mobile` | Expo (React Native) iOS/Android app. |

Internal packages are consumed as TypeScript source (`exports` → `src/*.ts`); there is no
build step for them.

## Conventions

- **Money is integer cents** (`number`, never floats for stored amounts). Currency is CAD.
  Round only at defined points, half-up to the cent (see `@nevile/core` money helpers).
- **Time**: store `timestamptz` in UTC; business logic that depends on local days uses the
  job's IANA zone (default `America/Toronto`).
- **Erasable TypeScript only** (`erasableSyntaxOnly`): no `enum`, no `namespace`, no
  constructor parameter properties. Use `as const` objects + union types. Node runs `.ts`
  files directly (type stripping), so scripts like `src/migrate.ts` need no build.
- Relative imports inside a package include the `.ts` extension.
- Validate every external input with Zod on the server. Never trust client-sent prices,
  fees, user ids or roles; derive them server-side.
- Authorization lives on the server for every procedure: a user may only read or modify
  rows they own or that belong to a business they are a member of.
- Never log secrets, tokens, OTP codes (outside the dev console sender), or full card data.
- Don't add dependencies casually; prefer the platform and existing packages.

## Commands

```bash
pnpm install
pnpm typecheck        # all packages
pnpm test             # all packages (db tests need TEST_DATABASE_URL)
pnpm lint             # biome
pnpm format           # biome autofix
pnpm db:generate      # drizzle-kit generate migrations from schema
pnpm db:migrate       # apply migrations to DATABASE_URL
pnpm --filter @nevile/web dev
pnpm --filter @nevile/mobile start
```

Local Postgres: `postgresql://nevile:nevile@localhost:5432/nevile_dev` (dev) and
`.../nevile_test` (tests). Copy `.env.example` to `.env`.
