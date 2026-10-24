# Operations runbook

How Nevile is run: environments, configuration, health checks, error reporting, backups,
payments and scheduled jobs, the Nevile Neighbours switch, and what to do when something
breaks. Product rules live in
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
| `PAYMENTS_PROVIDER` | `fake` (default) | `stripe` (default) | `fake` takes no real money and is refused in production (below). |
| `STRIPE_SECRET_KEY` | leave empty | **required** | `sk_test_…` on staging, `sk_live_…` in production. A restricted key (`rk_…`) works if it can manage Checkout, Connect accounts, refunds and transfers. |
| `STRIPE_WEBHOOK_SECRET` | leave empty | **required** | Signing secret (`whsec_…`) of the webhook endpoint below. |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | leave empty | optional | Only if Connect events use a second endpoint with its own secret. |
| `NEVILE_ALLOW_TEST_PAYMENTS` | leave empty | staging only | `true` lets a production build run with a test key. Never set it in production. |
| `CRON_SECRET` | optional | **required** | Bearer token for `/api/cron` (below). `openssl rand -base64 32`, unique per environment. |
| `NEVILE_OPS_EMAIL` | optional | recommended | Where problems unresolved after 3 days are escalated. |
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

## Business photos and private photos (media storage)

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

Private photos (quote requests and chat, SPEC §20) live in the same bucket under
`private/quotes/<uuid>.webp` and `private/chat/<uuid>.webp`. The site never hands out
their storage keys: it streams them through `/api/private-media/<id>` only to the people
in that request or conversation. If the bucket is publicly readable through
`MEDIA_PUBLIC_BASE_URL`, **allow public reads of `businesses/*` only**:

- Cloudflare R2 with a custom domain: add a WAF custom rule on the media domain,
  "URI Path starts with `/private/`" → Block.
- AWS S3: grant public `s3:GetObject` only on `arn:aws:s3:::<bucket>/businesses/*`.

Photos uploaded but never sent are deleted after a day by the scheduled jobs.

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

## Payments (Stripe)

Bookings are paid through Stripe (SPEC §7, §19): customers pay Nevile with Stripe Checkout,
businesses get paid to a Stripe Connect **Express** account, and Nevile sends each
business one transfer a week. Card numbers never touch Nevile's servers.

Set up once per environment (staging uses Stripe **test mode**, production live mode):

1. In the Stripe dashboard, turn on **Connect** with Express accounts, country Canada,
   currency CAD. Set the platform name, icon and support email shown during payout setup.
2. Create a **webhook endpoint** at `https://<your-domain>/api/webhooks/stripe` listening
   to `checkout.session.completed`, `checkout.session.expired` and `account.updated`, and
   tick "Listen to events on Connected accounts" for `account.updated`. Put its signing
   secret in `STRIPE_WEBHOOK_SECRET`. (If you prefer a separate Connect endpoint, use the
   same URL and put its secret in `STRIPE_CONNECT_WEBHOOK_SECRET`.)
3. Set `STRIPE_SECRET_KEY` and `PAYMENTS_PROVIDER=stripe`, deploy, then make a test
   booking on staging with Stripe's test card `4242 4242 4242 4242`.

How money moves:

- **Instant Book** charges the card at checkout. **Requests** only hold the card; it is
  charged when the business accepts, and the hold is released if they decline or don't
  answer within 24 hours.
- **Refunds** go back to the customer's card through Stripe (the amounts follow the
  cancellation rules in `@nevile/core`). Each refund is recorded in the `refunds` table.
- **Payouts**: every Monday (Halifax time), each business gets one transfer for jobs
  confirmed the week before, minus Nevile's 3% fee and any refunds. A failed transfer is
  retried on the next scheduled run. Stripe then pays the business's bank on its own
  schedule (usually 1 to 2 business days).
- **Payout setup deadline**: a business can take bookings before setting up payouts, but
  its first paid booking starts a 7-day clock. If setup isn't finished in time, its
  upcoming bookings are cancelled with full refunds and new bookings pause until setup is
  done.

Every Stripe call carries an idempotency key, so repeating a scheduled run or a webhook
never charges, refunds or transfers twice. The webhook and the customer's return page can
both finish a booking; whichever comes first wins.

In development and browser tests, `PAYMENTS_PROVIDER=fake` replaces Stripe with test pages
on the site itself (`/dev/fake-checkout/…`, `/dev/fake-onboarding`). They return 404 in
production builds.

## Scheduled jobs

Booking upkeep runs from one protected endpoint. Call it **every 5 minutes**:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron
```

Use the hosting provider's cron (for example Vercel Cron, Render Cron Jobs or a GitHub
Actions schedule). Without `CRON_SECRET` the endpoint answers 503; with a wrong token, 401.
Each run, in order, and each step is safe to repeat:

1. expires unpaid checkouts (holds last 30 minutes) and frees their time;
2. expires requests a business didn't answer (24 hours, or when the window starts) and
   releases the card hold;
3. confirms finished jobs the customer didn't answer within 48 hours;
4. escalates problems not resolved within 3 days to `NEVILE_OPS_EMAIL`;
5. reminds businesses 2 days before their payout setup deadline, then enforces it;
6. on Mondays, creates and sends the week's payouts (and retries failed ones);
7. closes quote requests nobody answered in 3 days, and quotes not booked in 7 (SPEC §20);
8. sends one email per conversation when chat messages have sat unread for 10 minutes;
9. deletes photos that were uploaded for a request or message but never sent (after a day).

The JSON answer lists how many items each step handled. Alert if the endpoint fails
several runs in a row: holds then stay open longer and payouts wait.

## Problems and escalations

When a customer reports a problem, the business has 3 days to fix it and payment for that
job is held. If it isn't resolved, an email goes to `NEVILE_OPS_EMAIL` with the booking.
For now staff resolve these by contacting both sides and, if a refund is due, issuing it
from the Stripe dashboard **and** recording it with a note in the audit log; an admin
screen for this comes with the admin tools. Never edit payment or booking rows by hand.

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
   the app before touching the database. If payments are misbehaving, pause the
   scheduled jobs (stop the cron caller) so no payouts go out while you investigate;
   Stripe keeps webhook events and retries them for up to 3 days.
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
