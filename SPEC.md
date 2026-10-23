# Nevile — Product Spec v1.1

Nevile is a Nova Scotia marketplace (built to expand across Canada) where customers find,
book, and pay local home-service businesses (lawn care, snow & ice removal, cleaning, and other
year-round household work) instead of relying on phone calls and word of mouth.

Status: **agreed** — this document is the source of truth for v1. Change it via
pull request when a decision changes.

---

## 1. Accounts & identity

| Decision | Detail |
|---|---|
| Dual role | One login can be both a customer and a business. A "Switch to business mode" toggle changes the app view. Ratings are tracked separately per role. |
| Sign-in methods | Email + password and phone SMS one-time code. |
| Sign-up | Requires a **Nova Scotia postal code** (see §2). New users are signed in immediately; an email-confirmation banner is shown until the email is confirmed. |
| Verification gate | Booking, paying, messaging, quote requests and all business tools require a **verified contact**: a confirmed email, or a phone number verified by SMS code. Browsing, saving and onboarding do not. |
| Onboarding | Optional 3-step welcome after sign-up (see §16). |
| Business teams | Supported from day one and **free** on every plan. Owner adds crew members; each crew member has their own calendar. |
| Job assignment | Customer books the *business*; the owner/manager assigns the job to a crew member. |
| Business verification | Stripe Connect identity verification is required before a business can receive payouts. Uploading proof of insurance (reviewed by admin) earns a **Verified** badge. |

## 2. Location

- **Launch market: Nova Scotia only, province-wide.** Currency **CAD**.
- **Sign-up is blocked outside Nova Scotia:** the sign-up form asks for a postal code and
  only Nova Scotia postal codes (first letter **B**) are accepted, checked on the server.
  Others see "Nevile is only in Nova Scotia for now." Existing accounts are not affected
  by later expansion settings.
- Businesses' service areas and job addresses must be in Nova Scotia.
- **Default time zone: `America/Halifax`** (Atlantic). All local-day logic (deadlines,
  payout weeks, seasons) uses the job's zone, defaulting to Halifax.
- Launch provinces are a configuration list, so expanding later is a setting, not a rewrite.
- **Service area:** Facebook-Marketplace-style — business drops a pin on a map and
  drags a radius slider. Customers only see businesses whose radius covers their address.

## 3. Services & pricing

- **Categories:** fixed list managed by Nevile (e.g. Lawn Mowing, Snow & Ice Removal,
  House Cleaning, Gutter Cleaning, Leaf Cleanup, Window Washing, Pressure Washing,
  Yard Cleanup). Businesses can **request a new category**; admin approves or rejects.
- **Pricing models** a business can offer per service:
  - **Request a quote** — customer describes the job, business replies with a price.
    Quotes expire after **7 days** if not accepted.
  - **Fixed price** — a set price per visit.

## 4. Scheduling

- **Availability:** business sets working hours per crew member and can block days off.
- **No automatic travel buffers** between jobs.
- **Slot locking:** a calendar slot is locked only when the booking is confirmed
  (quote accepted, or fixed-price booking accepted). Nothing is held while a quote is pending.
- **Instant book vs approval:** each business toggles whether fixed-price bookings
  confirm instantly or require their approval. Unanswered requests expire after **24h**
  (no charge).
- **Recurring jobs:** weekly, every 2 weeks, or monthly, with an end date. Visits repeat
  on the assigned crew calendar.
- **Snow & ice removal** supports two modes:
  - **Seasonal contract** — e.g. "clear whenever snowfall > 5 cm, Nov–Mar, $X per visit".
    The business logs each visit; the customer confirms it.
  - **On-demand** — one-off "come today" requests.
- **Weather delays:** handled manually — parties agree in chat and the business edits the booking.
- **Visibility:** customers see only open/busy availability, never other customers'
  details. Businesses see their full calendar with addresses and notes.

## 5. Cancellations

Each business picks one of three cancellation policy presets:

| Preset | Rule |
|---|---|
| Flexible | Free until 24h before; after that, 50% refund. |
| Moderate | Free until 48h before; after that, 50% refund. |
| Strict | Free until 7 days before; after that, no refund. |

- On a **customer-initiated** cancellation, the customer's service fee is **not refunded**.
- On a **business-initiated** cancellation, the customer receives a **full refund**
  including the service fee, and the cancellation is recorded on the business's reliability stats.

## 6. Job completion & disputes

1. Business (or assigned crew) marks the job complete, optionally with before/after photos.
2. Customer has **48h** to confirm or report a problem; silence auto-confirms.
3. If a problem is reported, payment stays held and the business gets **3 days** to return
   and fix it.
4. If still unresolved, **admin** decides: full payout, partial refund, or full refund.

## 7. Payments & fees

All payments run through **Stripe Connect** (Nevile never stores card numbers).

### Fee model

- Business pays **3%** (deducted from payout).
- Customer pays a **service fee** shown as a single "Service fee" line. It is sized so that
  after the card processor's cut of the **whole** charge (including sales tax), Nevile
  nets **exactly 6%** of the job price (within ±1¢ from rounding).

With card rate `r = 2.9%`, fixed fee `f = $0.30`, job price `P`, sales-tax rate on the job
price `tP` (0 if the business is not GST/HST-registered) and on the service fee `tF`:

```
serviceFee = (0.03·P + r·(1 + tP)·P + f) / (1 − r·(1 + tF))     rounded half-up to the cent
```

Worked example, Nova Scotia (HST 14%), `P = $60.00`, tax-registered business:

| Line | Amount |
|---|---|
| Job price | $60.00 |
| Service fee | $4.22 |
| HST (14%) | $8.99 ($8.40 on the job + $0.59 on the fee) |
| **Customer pays** | **$73.21** |
| Business receives | $58.20 (+ the $8.40 HST it collected on its own price) |
| Card processing | ≈ $2.42 |
| **Nevile nets** | **$3.60 (6%)** |

More reference values (NS): `P = $100` registered → fee $6.83, total $121.79;
`P = $60` not registered → fee $3.97, HST on fee $0.56, total $64.53.

### Sales tax

- GST/HST (and QST in Quebec) applied automatically by the job's province.
- Provincial sales tax (BC PST, Manitoba RST, Saskatchewan PST) is **not charged at
  launch**: whether it applies to a home service depends on the province and the type of
  service. It can be switched on per province once tax advice confirms it; until then
  jobs in those provinces are charged GST only.
- Applied to the business's price only if the business has entered a GST/HST registration
  number (small suppliers under the threshold charge none).
- Always applied to Nevile's service fee.

### When the customer is charged

| Booking type | Charge timing |
|---|---|
| One-off job | **Upfront at booking** confirmation. |
| Recurring job | Card saved; **each visit charged 3 days before** it happens. Cancellation rules apply per visit. |
| Snow contract (per visit) | Card saved at signing; **each visit charged after the customer confirms it** (or after 48h auto-confirm). |

### Refunds

- Refunds follow the business's cancellation preset (section 5).
- Customer-initiated cancellations keep the service fee.

### Payouts

- Funds are held by the platform until the job is confirmed complete.
- Businesses are paid in a **weekly batch every Monday**.

### Tips

- Customers can tip after completion. **100% goes to the business**; Nevile takes no fee
  and absorbs the card processing cost on the tip.

### Community donations

See §15. Donations are separate from the job price and the service fee, carry no sales
tax, and are never counted as Nevile revenue.

### Off-platform leakage protection

- Phone numbers and emails are hidden until a booking is paid.
- Chat auto-masks phone numbers and emails before that point.
- Payment is in-app only.

## 8. Business subscription

The 3% business fee is **the same** on every plan.

| Plan | Price | Includes |
|---|---|---|
| Free | $0 | Unlimited service listings, team calendars, all core booking features. |
| Pro | ~$29/month (admin-configurable) | Higher search placement + **Pro** badge, analytics dashboard, automatic rebooking reminders to past customers. |

- Billed monthly via Stripe Billing.
- Businesses can **pause** their subscription during their off-season.

## 9. Ratings & reviews

- Either side can rate the other **only after a job is completed**, within **14 days**.
- 1–5 stars + optional written comment. The person rated may post **one public reply**.
- Ratings are **visible immediately** on submission (not blind).
- Recurring jobs and contracts: at most **one rating per month** of service per side.
- Businesses can see a customer's rating before accepting a request and may decline
  (does not apply to instant-book).

## 10. Communication & documents

- **In-app chat** opens from the first quote/booking request (contact details masked until paid).
- **Notifications:** email, push (web + native), and an in-app notification inbox.
  SMS is used only for sign-in codes.
- **Agreements:** seasonal/recurring contracts generate a PDF agreement both parties accept.
  One-off jobs get receipts.

## 11. Admin

Full admin panel with reporting:

- Users & businesses (search, suspend, verify insurance)
- Category list & new-category requests
- Disputes & refunds
- Payouts overview
- Subscription plan pricing
- Reports: revenue, fees collected, bookings, growth

## 12. Platforms & tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript 6 (latest release supported by Next.js and Expo tooling; TS 7 native compiler to be adopted once the toolchain supports it) |
| Repo | Monorepo |
| Web | Next.js 16 + React 19, Tailwind CSS 4 |
| Mobile | Expo (React Native) iOS & Android apps, built alongside web |
| API | One shared API used by web and mobile |
| Database | PostgreSQL + Drizzle ORM |
| Auth | Better Auth (email/password, phone OTP) |
| Payments | Stripe Connect (marketplace) + Stripe Billing (subscriptions) |
| Validation | Zod |

### Security baseline

- Passwords hashed with a modern one-way algorithm; verified contact required before any
  money, messaging or business action (§1).
- Rate limiting on sign-in, OTP, and other abuse-prone endpoints.
- Server-side authorization on every request — users only access their own data.
- All input validated server-side.
- No card data stored by Nevile (Stripe handles it).
- Audit log for all money movements and admin actions.
- OWASP Top 10 reviewed before launch.

## 13. Design direction

**Chosen: "A · Seasons"** across customer web, business web, and mobile, with the
**list + map search results** and **radius-slider service area** from direction B,
restyled in the Seasons look.

| Token | Value |
|---|---|
| Display font | Bricolage Grotesque (600/700/800) |
| Body font | Figtree (400/500/600) |
| Ground / surface / border | `#F5F6F1` / `#FFFFFF` / `#E1E5DC` |
| Ink / muted | `#18211D` / `#4F5A54` |
| Primary (evergreen) / hover | `#1E5B43` / `#174A36` |
| Winter accent / tint | `#2D6A9F` / `#E3EEF7` |
| Spring accent / tint | `#3F7F3A` / `#E5F1E1` |
| Summer accent / tint | `#A86A12` / `#FBEFD9` |
| Fall accent / tint | `#A4471F` / `#F7E4DA` |
| Radii | 18px cards, 12px inputs, pill buttons |

The site's hero and featured categories re-theme **automatically** by the current month in
Nova Scotia (`America/Halifax`). There is **no manual season switcher**. Seasons follow
Nova Scotia's climate rather than the astronomical calendar:

| Season | Months |
|---|---|
| Winter | December – March |
| Spring | April – May |
| Summer | June – August |
| Fall | September – November |

In the **last month of each season** the hero adds a gentle nudge for what's next
(November: "Snow's coming — lock in a seasonal snow contract"; March: spring yard
cleanup; May: lawn-mowing season; August: book fall gutter and leaf cleanup).

## 14. Build order

1. ~~Clickable UI mockups~~ — done, direction A chosen.
2. ~~Foundation: monorepo, domain rules (fees, tax, policies), database schema, auth, app shells.~~
3. Smoother, safer, community (v1.1): Nova Scotia launch rules, onboarding, verification
   gate, motion & performance polish, Nevile Neighbours groundwork, CI, browser tests,
   monitoring, legal & accessibility drafts.
4. Listings & search (v1.2, §18) → quotes & booking → scheduling → payments (donations
   plug in here) → ratings → subscription → admin.

## 15. Nevile Neighbours (community program)

Nevile's community program helps Nova Scotians who can't keep up with their homes
(for example older adults or people with disabilities) get yard work, snow clearing or
cleaning done by local Nevile pros.

**Status: built behind a switch that is OFF** (`NEVILE_NEIGHBOURS_ENABLED`) until the
owner decides who legally holds donated money (a partner registered charity, or a
separate Nevile account with legal/accounting sign-off). While off, program pages say
"launching soon", donation options are hidden at checkout, and referrals are not accepted.

| Topic | Decision |
|---|---|
| Funding | **Optional customer donations at checkout only.** Nevile's fee is not used. |
| Checkout options | "Round up to the next dollar" (if the total is already whole, round-up offers $1), or **$2 / $5 / custom** ($1–$500). **Nothing is pre-selected.** |
| Card fees on donations | **Deducted from the donation**: 2.9% of the donated amount (the donation rides on the same card charge, so no extra fixed fee), rounded half-up. Shown openly on the impact page. Example: $2.00 donated → $0.06 fee → $1.94 to the fund. |
| Refunds | A donation is refunded automatically only when its booking is refunded **in full** (business cancellation or full admin refund). Otherwise donations are final. |
| Who is helped | **Partner referrals only.** Registered local organizations (seniors' centres, community support agencies, faith groups) are added by Nevile admins; their staff submit referrals. |
| Referral data | Minimal: homeowner first name, a contact route through the partner, the job address (Nova Scotia), the service needed, preferred timing, and the partner's confirmation that the homeowner **consented**. **No health, disability, age or income details** are collected. Admin approves or declines each referral. |
| Spending | Approved referral jobs are booked with Nevile pros at their **normal full price**, paid from the fund, and run like any other booking. |
| Transparency | Public **impact page**: total donated, card fees, amount paid to pros, jobs completed, by region. No names or addresses; a region is shown only once it has at least 3 completed jobs. |
| Wording | Soft, accurate claims only, e.g. "We're setting aside donations from our community to help neighbours who can't keep up with their homes." **No fixed percentage or outcome is promised.** |
| Money ledger | Every donation, fee and payout is an append-only ledger entry; the fund balance is derived from the ledger, never stored as an editable number. |

## 16. Onboarding & feel

- **Welcome (optional, skippable), web and mobile:**
  1. "I need help at home" / "I run a business" / both.
  2. Postal code (customers) or service area (businesses), Nova Scotia only.
  3. Interests: which services matter to them (used to personalise the homepage).
- **Motion:** subtle and fast (150–250 ms fades/slides, press feedback, season crossfade),
  disabled automatically when the device asks for reduced motion.
- **Speed:** instant-feeling navigation (prefetching, loading skeletons, no layout shift);
  pages keep the strict per-request security policy (§17), so speed comes from streaming
  and caching rather than fully static pages.
- **Phone-first layouts** on every web page; touch targets ≥ 44 px.
- Friendly empty states everywhere.

## 17. Quality, monitoring & compliance

- **Continuous integration:** every push and pull request runs lint, type checks, all
  tests (with a real Postgres), the web build, the mobile bundle and browser tests. The
  `main` branch is protected so failing changes cannot be merged.
- **Browser tests (Playwright):** sign-up (including the Nova Scotia block), sign-in,
  onboarding, the verification gate and community pages, at desktop and phone sizes,
  with automated accessibility checks (axe).
- **Monitoring:** `/api/health` for uptime checks; error reporting (Sentry) that is off
  until a DSN is configured; environment variables validated at startup.
- **Dependency updates:** automated weekly update pull requests.
- **Legal drafts for lawyer review:** Privacy Policy (PIPEDA), Terms of Service, and
  **CASL**-compliant marketing consent (an optional, unticked checkbox, with the consent
  text version and timestamp recorded).
- **Accessibility:** WCAG 2.1 AA target, in line with the Nova Scotia Accessibility Act;
  an accessibility statement page with a way to report problems.

## 18. Listings & search (v1.2)

### Business listing

- A business manages its listing from **business mode** on the website (the app links there
  for now): profile (name, about, logo, up to **8 work photos**), tax registration (GST/HST
  number), cancellation preset (§5), Instant Book (§4), service area and services.
- **Services:** category (§3), title, description, pricing (**fixed** price per visit, or
  **request a quote** with an optional "from $X"), typical duration, and whether it is
  active. Instant Book applies to fixed-price services only.
- **Service area:** a pin and a radius from **1 to 100 km**, set on a map (§2). The pin must be
  in Nova Scotia.
- **Publishing:** a business appears in search only when it is **published**, and it can only
  be published when it is ready: verified contact (§1), a name and an "about" of at least
  40 characters, a service area, and at least one active service. Unpublishing is instant.
  Suspended businesses never appear.
- Only the owner and managers can edit a listing; crew can view it.

### Photos

- Logo and work photos are uploaded through the website: JPEG, PNG, WebP or HEIC, up to
  **10 MB** each. Every image is re-encoded on the server (WebP, at most 1600 px wide; logos
  512 px square), which **removes all metadata including GPS location**. The original file
  is never stored.
- Storage is S3-compatible (e.g. Cloudflare R2) in production and a local folder in
  development. Photos are public once the listing is published.

### Search

- Customers search by **service category** and **postal code**. Location is the **postal code
  area** (the first three characters, e.g. `B3H`); the exact address is only needed at
  booking. "Use my location" (with the browser's permission) gives a precise point instead
  and is never stored.
- A business matches when the customer's point is within its radius
  (great-circle distance).
- **Ordering — "Best match" (default):** a weighted score of distance (closer is better),
  rating (a confidence-weighted average, so a few reviews don't dominate) and a **Pro
  boost**; results that got the boost show the **Pro** badge. Customers can switch to
  **Closest** or **Top rated**.
- **Filters:** Instant Book, Verified, Pro, rating 4.5+.
- Results show name, badges, rating (or "New on Nevile"), the service's price ("$60 / visit"
  or "Quote · from $45"), approximate distance and the cancellation preset.
- **Map:** OpenStreetMap data via MapLibre (free, no key). Business pins are shown at an
  **approximate location** (rounded to about 1 km) so a sole operator's home address is
  never revealed.

### Postal code areas

- Areas live in the `postal_areas` table (code, place name, centre point). Production data
  must come from **Statistics Canada's Forward Sortation Area boundary file** (Open
  Government Licence – Canada), loaded with `pnpm db:import-postal-areas`.
- Until then the database is seeded with a **starter list of Nova Scotia areas** whose
  centres are approximate (town and neighbourhood centres) and flagged `approximate`.
  Replacing them is on the launch checklist (docs/OPERATIONS.md).
- An unknown area falls back to the nearest known one with the same first two characters,
  then to all of Nova Scotia (results sorted without distance).

### Public business page

- `/pros/<slug>`: name, badges, about, photos, services with prices, service area (as a
  description, e.g. "Serves about 25 km around Bedford"), cancellation preset, rating and
  reviews when they exist. Contact details stay hidden (§7). Booking and quote buttons are
  shown as "coming soon" until booking ships.

