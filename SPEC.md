# Nevile — Product Spec v1

Nevile is a Canadian marketplace where customers find, book, and pay local
home-service businesses (lawn care, snow & ice removal, cleaning, and other
year-round household work) instead of relying on phone calls and word of mouth.

Status: **agreed** — this document is the source of truth for v1. Change it via
pull request when a decision changes.

---

## 1. Accounts & identity

| Decision | Detail |
|---|---|
| Dual role | One login can be both a customer and a business. A "Switch to business mode" toggle changes the app view. Ratings are tracked separately per role. |
| Sign-in methods | Email + password (with email verification) and phone SMS one-time code. |
| Business teams | Supported from day one and **free** on every plan. Owner adds crew members; each crew member has their own calendar. |
| Job assignment | Customer books the *business*; the owner/manager assigns the job to a crew member. |
| Business verification | Stripe Connect identity verification is required before a business can receive payouts. Uploading proof of insurance (reviewed by admin) earns a **Verified** badge. |

## 2. Location

- **Launch market:** Canada only. Currency **CAD**. Canadian address & postal code formats.
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
| Flexible | Free cancellation until 24h before the job. |
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
- Customer pays a **service fee = 3% + the exact card processing cost** for that charge,
  shown as a single "Service fee" line, so Nevile always nets **6%** of the job price.

Customer total for job price `P` (before sales tax), with Stripe at 2.9% + $0.30:

```
customerTotal = (P × 1.03 + 0.30) / (1 − 0.029)
```

Worked example, `P = $100.00`:

| Line | Amount |
|---|---|
| Job price | $100.00 |
| Service fee | $6.39 |
| **Customer pays** (pre-tax) | **$106.39** |
| Business receives | $97.00 |
| Stripe processing | ≈ $3.39 |
| **Nevile nets** | **≈ $6.00** |

### Sales tax

- GST/HST/PST applied automatically by the job's province.
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

- Passwords hashed with a modern one-way algorithm; email verification required.
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

The site's hero and featured categories re-theme by season (Winter: Dec–Feb,
Spring: Mar–May, Summer: Jun–Aug, Fall: Sep–Nov).

## 14. Build order

1. ~~Clickable UI mockups~~ — done, direction A chosen.
2. Foundation: monorepo, domain rules (fees, tax, policies), database schema, auth, app shells.
3. Listings & search → quotes & booking → scheduling → payments → ratings → subscription → admin.
