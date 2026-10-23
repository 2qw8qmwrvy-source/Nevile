# Operations runbook

How Nevile is run: environments, configuration, health checks, error reporting, backups,
the Nevile Neighbours switch, and what to do when something breaks. Product rules live in
[SPEC.md](../SPEC.md); local setup is in the [README](../README.md).

## Environments

| Environment | Purpose | Database | Who uses it |
|---|---|---|---|
| **dev** | Each developer's machine (`pnpm --filter @nevile/web dev`). Emails and SMS codes are printed to the console. | Local Postgres `nevile_dev` (tests use `nevile_test`) | Developers |
| **staging** | A production-like copy for checking a release before customers see it. Same build and settings as production, its own secrets, test-mode payment keys, email/SMS providers limited to the team. | Its own managed Postgres | The team |
| **prod** | The live site and API used by the apps. Deployed only from `main` after CI passes. | Managed Postgres with backups (below) | Customers and businesses |

Rules that apply everywhere:

- Each environment has its **own** database and its **own** secrets. Never point staging
  at the production database, and never copy `BETTER_AUTH_SECRET` between environments.
- Staging and production run with `NODE_ENV=production` (`next build` / `next start`).
- Secrets live in the hosting provider's secret/environment settings, never in git or chat.

## Environment variables

Locally, copy `.env.example` (the dev defaults) to `.env`; on staging and production, set
the variables below in the hosting provider. The app validates its configuration
(SPEC §17) and refuses to run when something required is missing or invalid; the error in
the logs names the variable.

| Variable | dev | staging / prod | Notes |
|---|---|---|---|
| `DATABASE_URL` | required | required | Postgres connection string. In the cloud, require TLS (for example `?sslmode=require`). |
| `TEST_DATABASE_URL` | for tests | never | Database name must end in `_test`; tests wipe it. |
| `BETTER_AUTH_SECRET` | optional | **required** | Signs sessions and email links. Generate with `openssl rand -base64 32`, unique per environment. Changing it signs everyone out. |
| `BETTER_AUTH_URL` | optional | **required** | Public origin of the website, e.g. `https://<your-domain>`. |
| `BETTER_AUTH_TRUSTED_ORIGINS` | optional | optional | Extra origins allowed to call `/api/auth` (comma-separated). |
| `BETTER_AUTH_TRUSTED_PROXIES` or `BETTER_AUTH_CLIENT_IP_HEADER` | leave empty | **one is required** | Where sign-in rate limiting reads the visitor's IP. Use the header your host or CDN always sets (e.g. `cf-connecting-ip`), or list the proxy IPs. |
| `NEXT_PUBLIC_SITE_URL` | optional | required | Public site URL, used for page metadata and server-side API calls. Built into the site: rebuild after changing it. |
| `SENTRY_DSN` | leave empty | optional | Server-side error reporting (below). |
| `NEXT_PUBLIC_SENTRY_DSN` | leave empty | optional | Browser error reporting. Built into the site: rebuild after changing it. |
| `NEVILE_NEIGHBOURS_ENABLED` | optional | **off** | Community program switch (below). |
| `MEDIA_STORAGE` | `local` (default) | `s3` (default) | Where business photos and logos are stored (below). `local` is refused in production. |
| `MEDIA_LOCAL_DIR` | optional | never | Folder for `local` media; defaults to `.media` in the web app's folder. |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | leave empty | **required** | The media bucket and a key that may only read, write and delete in it. |
| `S3_ENDPOINT`, `S3_REGION` | leave empty | for R2 | Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com` and `auto`. Leave empty for AWS S3 and set the region. |
| `MEDIA_PUBLIC_BASE_URL` | leave empty | recommended | The bucket's public custom domain (e.g. `https://media.<your-domain>`). Without it, photos are served through the website. Added to the page security policy automatically. |
| `EXPO_PUBLIC_API_URL` | `apps/mobile/.env.local` | app build settings | The website's origin for the mobile app. Release builds must use the production `https://` origin. |

Until real email and SMS providers are connected in `@nevile/auth`, sign-in does not work
with `NODE_ENV=production`: the auth module refuses to run rather than silently drop
sign-up codes and verification emails. That is expected until those providers are chosen.

## Health check

`GET /api/health` answers HTTP **200** while the app is up. Point an uptime monitor (for
example UptimeRobot or Better Stack) at `https://<your-domain>/api/health`:

- check every 1 to 5 minutes from at least two regions;
- alert when the status is not 200 or there is no answer within 10 seconds;
- send alerts to email and phone, not only to a chat channel.

Use the same URL for the hosting provider's health check if it has one, so broken
deployments are not switched in.

## Error reporting (Sentry)

Error reporting is **off until a DSN is set**, so dev and CI never send anything.

1. In Sentry, create a project for the platform **Next.js** and copy its **DSN**
   (Project Settings → Client Keys (DSN)).
2. Set `SENTRY_DSN` (server errors) and `NEXT_PUBLIC_SENTRY_DSN` (browser errors) to that
   DSN in staging and production. Using one Sentry project per environment, or Sentry's
   environment filter, keeps staging noise out of production alerts.
3. Rebuild and redeploy (the browser DSN is built into the site).
4. Check it works: Sentry's **Issues** page should show new errors within a minute of one
   happening.

To turn it off, remove both variables and redeploy. Sentry must not receive personal data:
do not enable options that send request bodies, cookies, IP addresses or user details.

## Database and backups

Production and staging use **managed PostgreSQL 16** (for example in a Canadian region of
AWS, Google Cloud or Azure, or a Postgres host such as Neon or Crunchy Bridge). Required
settings:

- **Automated daily backups** kept for at least 14 days.
- **Point-in-time restore** turned on, so the database can be rewound to any minute in the
  retention window (for example to just before a bad migration or mistaken delete).
- Encryption at rest, TLS-only connections, and no public access except from the app.
- A **restore test every quarter**: restore the latest backup into a new, temporary
  database, run `pnpm db:migrate` against it (it should have nothing to apply), compare a
  few row counts with production, then delete it. Don't connect staging to it: it holds
  real customers' data.

Schema changes:

- Apply them with `pnpm db:migrate` (with `DATABASE_URL` for that environment) **before**
  starting the new app version. Never use `drizzle-kit push`: it skips the custom
  constraints and triggers in `packages/db/drizzle`.
- Write migrations so the previous app version still works with the new schema (add
  first, remove in a later release). That keeps an app rollback safe.
- Before a risky migration, take a manual snapshot and note the time, so a point-in-time
  restore target is known.
- `pnpm db:seed` (service categories) is safe to run again after each deploy.

## Business photos (media storage)

Logos and work photos (SPEC §18) are re-encoded on upload (WebP, metadata and location
removed), then stored under random names like `businesses/<id>/photos/<uuid>.webp`. Files
never change once written, so they can be cached for a year.

Setting up Cloudflare R2 (AWS S3 works the same way):

1. Create a bucket per environment (e.g. `nevile-media-staging`, `nevile-media-prod`).
2. Create an API token limited to that bucket with **Object Read & Write**. Put its keys
   in `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`, the bucket name in `S3_BUCKET`, the
   account endpoint in `S3_ENDPOINT` and `auto` in `S3_REGION`.
3. Recommended: connect a custom domain to the bucket for public reads (e.g.
   `media.<your-domain>`) and set `MEDIA_PUBLIC_BASE_URL` to it. Keep bucket listing off.
4. Redeploy, upload a photo on staging, and check it shows on the business's public page.

Deleting a photo or replacing a logo deletes the file too. A failed delete only leaves an
unused file behind (it is logged as "Could not delete stored media").

## Maps and postal code areas

- Maps use OpenStreetMap data styled by **OpenFreeMap** (`tiles.openfreemap.org`), which
  needs no key or account. If it is ever unavailable, pages still work: the map shows a
  short note and everything is also listed. To switch providers, change `MAP_STYLE_URL`
  (`apps/web/src/components/map/load-maplibre.ts`) and `MAP_TILES_ORIGIN`
  (`apps/web/src/lib/csp.ts`) together.
- **Before launch, replace the starter postal areas.** `pnpm db:seed` adds an approximate
  list of Nova Scotia postal code areas so search works in development. For production,
  load official centres from Statistics Canada's Forward Sortation Area boundary file
  (Open Government Licence – Canada):
  1. Download the 2021 Census FSA boundary file and compute each Nova Scotia FSA's centre
     (any GIS tool, e.g. QGIS "Centroids" or `ogr2ogr`), keeping the place name.
  2. Save a CSV with the header `code,place_name,lat,lng` (optionally `province`).
  3. Run `DATABASE_URL=… pnpm db:import-postal-areas /absolute/path/areas.csv
     --source="Statistics Canada FSA boundary file 2021"`. Imported rows replace starter
     rows and are no longer marked approximate; re-running the seed never overwrites them.
  4. Check: `SELECT count(*) FROM postal_areas WHERE approximate;` should be 0 for areas
     you imported.

## Nevile Neighbours switch

The community program (SPEC §15) is built but **off**. While off, its pages say
"launching soon", donation options are hidden at checkout and referrals are not accepted.

- **Do not turn it on** until the owner has decided who legally holds donated money (a
  partner registered charity, or a separate Nevile account with legal and accounting
  sign-off).
- **To turn it on:** set `NEVILE_NEIGHBOURS_ENABLED=true` in that environment's settings
  and redeploy or restart the app. Try it on staging first.
- **To turn it off:** remove the variable (or set it to `false`) and redeploy or restart.
  Turning it off hides donations from new checkouts; donations already made stay in the
  fund's ledger.

## Deploying

1. Merge to `main` only through a pull request with all CI checks green
   ([BRANCH_PROTECTION.md](BRANCH_PROTECTION.md)).
2. Run `pnpm db:migrate` against the staging database, deploy to staging, then open the
   site and sign in.
3. Repeat for production, then watch `/api/health` and Sentry for 15 minutes.
4. If anything looks wrong, roll back (incident step 3).

## Incident checklist

1. **Confirm.** Check `/api/health`, Sentry, the hosting dashboard and the database
   provider's status page. Note the time the problem started.
2. **Tell people.** If customers are affected, post a short notice (site banner or social
   account) and say when the next update will come.
3. **Stop the damage.** Roll back to the last good deployment in the hosting dashboard. If
   the problem is the community program, turn `NEVILE_NEIGHBOURS_ENABLED` off. Roll back
   the app before touching the database.
4. **Data problems.** Stop writes if data is being damaged (scale the app to zero or show
   the host's maintenance page). Use point-in-time restore into a **new** database, check it, then switch
   the app over. Never restore over the live database. Money questions are answered by
   the audit log and the payment provider's dashboard, not by editing rows by hand.
5. **Leaked secret or account takeover.** Rotate the exposed secret immediately
   (`BETTER_AUTH_SECRET` signs everyone out; also database passwords and provider keys),
   redeploy, and review recent admin and money entries in the audit log.
6. **Personal information breach.** Under PIPEDA, a breach that creates a real risk of
   significant harm must be reported to the Office of the Privacy Commissioner of Canada
   and the affected people must be notified as soon as feasible. Keep a record of every
   breach, even minor ones, for at least 24 months. Get legal advice early.
7. **Afterwards.** Within a week, write a short note: what happened, who was affected, the
   timeline, the fix, and follow-up work (a test or alert that would have caught it).
