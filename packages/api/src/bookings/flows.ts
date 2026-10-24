import type { EmailMessage, EmailSender } from "@nevile/auth";
import {
  APPROVAL_EXPIRY_HOURS,
  type BookingEventType,
  type BookingSnapshot,
  type BookingState,
  CHECKOUT_HOLD_MINUTES,
  COMPLETION_CONFIRMATION_HOURS,
  calculateCharge,
  canTakeBookings,
  checkWindow,
  FIX_WINDOW_DAYS,
  fitsInWindow,
  haversineKm,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  parseIsoDate,
  payoutSetupDueAt,
  planDay,
  postalAreaOf,
  type RefundBreakdown,
  refundForBusinessCancellation,
  refundForCustomerCancellation,
  sameQuoteArea,
  toLocal,
  transition,
} from "@nevile/core";
import {
  addresses,
  and,
  auditLog,
  type Booking,
  type BookingCheckout,
  type Business,
  bookingCheckouts,
  bookings,
  businesses,
  businessMembers,
  type Database,
  type DbExecutor,
  type Dispute,
  disputes,
  eq,
  inArray,
  lte,
  type Payment,
  payments,
  quoteRequests,
  quotes,
  refunds,
  type Service,
  serviceAreas,
  services,
  type Visit,
  visits,
} from "@nevile/db";
import type { PaymentProvider } from "@nevile/payments";
import { TRPCError } from "@trpc/server";
import { openConversation } from "../chat/flows.ts";
import type { ApiConfig } from "../config.ts";
import { isInstantBookable } from "../listing-state.ts";
import { sendAll } from "../notify.ts";
import { lookupPostalArea } from "../postal.ts";
import { defaultPushSender, deliverPendingNotifications, type PushSender } from "../push.ts";
import { acceptQuoteInTx, bookableQuote } from "../quotes/flows.ts";
import {
  type BookingMailFacts,
  bookingEmails,
  businessEmails,
  businessTeamEmails,
  customerEmail,
  receiptText,
  whenLabel,
} from "./emails.ts";
import { loadSchedule, lockBusinessCapacity, noticeRules } from "./schedule.ts";

/** What booking flows need from the request context (or a scheduled job). */
export type BookingDeps = {
  db: Database;
  payments: PaymentProvider;
  email: EmailSender;
  /** Phone pushes for in-app notifications (defaults to the environment's sender). */
  push?: PushSender;
  config: ApiConfig;
  now: () => Date;
};

/** After a change that created in-app notifications: push them to phones. */
export async function pushNotifications(deps: BookingDeps): Promise<void> {
  await deliverPendingNotifications({
    db: deps.db,
    push: deps.push ?? defaultPushSender,
    now: deps.now,
  });
}

type Mail = EmailMessage[];

// ---------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------

export type BookingParts = {
  booking: Booking;
  visit: Visit | null;
  payment: Payment | null;
  dispute: Dispute | null;
  service: Service;
  business: Business;
};

/** A booking with its visit, live payment, open dispute, service and business. */
export async function loadBookingParts(
  db: DbExecutor,
  bookingId: string,
  options: { lock?: boolean } = {},
): Promise<BookingParts | null> {
  const query = db.select().from(bookings).where(eq(bookings.id, bookingId));
  const [booking] = options.lock ? await query.for("update") : await query;
  if (!booking) return null;
  const [visit] = await db.select().from(visits).where(eq(visits.bookingId, booking.id)).limit(1);
  const [payment] = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.bookingId, booking.id),
        inArray(payments.status, [
          "authorized",
          "succeeded",
          "partially_refunded",
          "refunded",
          "pending",
        ]),
      ),
    )
    .limit(1);
  const [dispute] = visit
    ? await db
        .select()
        .from(disputes)
        .where(
          and(
            eq(disputes.visitId, visit.id),
            inArray(disputes.status, ["open", "fix_scheduled", "escalated"]),
          ),
        )
        .limit(1)
    : [];
  const [service] = await db.select().from(services).where(eq(services.id, booking.serviceId));
  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, booking.businessId));
  if (!service || !business) return null;
  return {
    booking,
    visit: visit ?? null,
    payment: payment ?? null,
    dispute: dispute ?? null,
    service,
    business,
  };
}

export function mailFacts(parts: BookingParts, config: ApiConfig): BookingMailFacts {
  const { booking, visit } = parts;
  const startsAt = visit?.startsAt ?? booking.requestedStartsAt ?? booking.createdAt;
  const endsAt = visit?.endsAt ?? booking.requestedEndsAt ?? startsAt;
  return {
    bookingId: booking.id,
    businessName: parts.business.name,
    serviceTitle: booking.title,
    when: whenLabel(startsAt, endsAt, booking.timezone),
    totalCents: booking.totalCents,
    siteUrl: config.siteUrl,
  };
}

/** The state-machine view of a booking (core `transition`), from its stored facts. */
export function snapshotOf(parts: BookingParts): BookingSnapshot {
  const { booking, visit, dispute } = parts;
  const startsAt = visit?.startsAt ?? booking.requestedStartsAt;
  if (!visit) {
    return { state: booking.status as BookingState, enteredAt: booking.createdAt, startsAt };
  }
  const state = visit.status as BookingState;
  const enteredAt =
    state === "completed_pending_confirmation" && visit.autoConfirmAt
      ? new Date(visit.autoConfirmAt.getTime() - COMPLETION_CONFIRMATION_HOURS * MS_PER_HOUR)
      : (dispute?.updatedAt ?? booking.confirmedAt ?? booking.createdAt);
  return { state, enteredAt, startsAt, disputeOpenedAt: dispute?.createdAt ?? null };
}

const TRANSITION_MESSAGES = {
  invalid_transition: "This booking can't be changed that way any more.",
  deadline_passed: "The time for that has passed.",
  deadline_not_reached: "It's too early for that.",
  job_not_started: "You can mark it done once the arrival window has started.",
  job_started: "The arrival window has started, so it can't be cancelled now.",
} as const;

/** Checks a lifecycle event against core's state machine; throws a friendly error. */
export function assertTransition(parts: BookingParts, type: BookingEventType, at: Date): void {
  const result = transition(snapshotOf(parts), { type, at });
  if (!result.ok) {
    throw new TRPCError({ code: "BAD_REQUEST", message: TRANSITION_MESSAGES[result.error.code] });
  }
}

async function audit(
  tx: DbExecutor,
  action: string,
  entity: string,
  entityId: string,
  actorUserId: string | null,
  data: Record<string, unknown>,
): Promise<void> {
  await tx.insert(auditLog).values({ action, entity, entityId, actorUserId, data });
}

/** The first paid booking starts the 7-day payout-setup clock (SPEC §19). */
async function startPayoutClock(
  tx: DbExecutor,
  business: Business,
  now: Date,
): Promise<Date | null> {
  if (business.payoutsEnabled || business.payoutSetupDueAt) return null;
  const due = payoutSetupDueAt(now);
  await tx.update(businesses).set({ payoutSetupDueAt: due }).where(eq(businesses.id, business.id));
  return due;
}

const dueLabel = (due: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(due);

// ---------------------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------------------

export type CheckoutRequest = {
  serviceId: string;
  date: string;
  windowStart: number;
  address: { line1: string; line2: string | null; city: string; postalCode: string };
  notes: string | null;
};

const WINDOW_MESSAGES = {
  no_window: "That arrival window isn't offered any more. Pick another time.",
  too_soon: "That time is too soon to book. Pick a later day.",
  too_far: "That's further ahead than this pro takes bookings.",
  full: "That window just filled up. Pick another time.",
} as const;

/** At most this many checkouts in progress per customer (each one holds time). */
const MAX_OPEN_CHECKOUTS = 3;

/** A bookable fixed-price service of a listed business, or an error saying why not. */
export async function bookableService(db: DbExecutor, serviceId: string) {
  const [row] = await db
    .select({ service: services, business: businesses, area: serviceAreas })
    .from(services)
    .innerJoin(businesses, eq(businesses.id, services.businessId))
    .innerJoin(serviceAreas, eq(serviceAreas.businessId, businesses.id))
    .where(eq(services.id, serviceId))
    .limit(1);
  const unavailable = new TRPCError({
    code: "NOT_FOUND",
    message: "That service isn't available to book.",
  });
  if (!row) throw unavailable;
  const { service, business, area } = row;
  if (!service.active || service.pricingType !== "fixed" || service.priceCents === null)
    throw unavailable;
  if (!business.publishedAt || business.suspendedAt) throw unavailable;
  return { service, business, area, priceCents: service.priceCents };
}

/** What is being booked: a fixed-price service, or an accepted quote (SPEC §20). */
type CheckoutTarget = {
  business: Business;
  area: { lat: number; lng: number; radiusKm: number };
  serviceId: string;
  quoteId: string | null;
  title: string;
  priceCents: number;
  workMinutes: number;
  instantBook: boolean;
  /** The address must be in this postal code area (quotes), if set. */
  requiredArea: string | null;
  /** Where the payment page's Cancel button goes. */
  cancelUrl: string;
};

/** The customer-facing side of an in-app payment: what the payment sheet needs. */
export type AppCheckout = {
  checkoutId: string;
  provider: "stripe" | "fake";
  paymentIntentId: string;
  clientSecret: string;
  /** Stripe's publishable key for the app (null with the test provider). */
  publishableKey: string | null;
  amountCents: number;
  capture: "now" | "hold";
  description: string;
};

type Opened = { checkoutId: string; url: string } | AppCheckout;

async function serviceTarget(deps: BookingDeps, serviceId: string): Promise<CheckoutTarget> {
  const { service, business, area, priceCents } = await bookableService(deps.db, serviceId);
  return {
    business,
    area,
    serviceId: service.id,
    quoteId: null,
    title: service.title,
    priceCents,
    workMinutes: service.durationMinutes,
    instantBook: isInstantBookable(business, service),
    requiredArea: null,
    cancelUrl: `${deps.config.siteUrl}/pros/${business.slug}/book?service=${service.id}`,
  };
}

async function quoteTarget(
  deps: BookingDeps,
  customerId: string,
  quoteId: string,
): Promise<CheckoutTarget> {
  const { quote, request, group, category } = await bookableQuote(
    deps.db,
    customerId,
    quoteId,
    deps.now(),
  );
  const [row] = await deps.db
    .select({ business: businesses, area: serviceAreas })
    .from(businesses)
    .innerJoin(serviceAreas, eq(serviceAreas.businessId, businesses.id))
    .where(eq(businesses.id, request.businessId))
    .limit(1);
  if (!row?.business.publishedAt || row.business.suspendedAt) {
    throw new TRPCError({ code: "NOT_FOUND", message: "This pro isn't on Nevile right now." });
  }
  return {
    business: row.business,
    area: row.area,
    serviceId: request.serviceId,
    quoteId: quote.id,
    title: `${category.name} (quoted)`,
    priceCents: quote.priceCents,
    workMinutes: quote.durationMinutes ?? 60,
    instantBook: true,
    requiredArea: group.postalCode,
    cancelUrl: `${deps.config.siteUrl}/quotes/${group.id}`,
  };
}

/**
 * Starts paying for a one-off booking (SPEC §19): validates the window and address,
 * prices it on the server, holds the time for 30 minutes and opens the provider's checkout.
 */
export async function startCheckout(
  deps: BookingDeps,
  customer: { id: string; email: string | null },
  input: CheckoutRequest,
): Promise<{ checkoutId: string; url: string }> {
  const target = await serviceTarget(deps, input.serviceId);
  return asPage(await openCheckout(deps, customer, input, target, "web"));
}

/** The same, paid inside the app with the payment sheet (SPEC §20). */
export async function startAppCheckout(
  deps: BookingDeps,
  customer: { id: string; email: string | null },
  input: CheckoutRequest,
): Promise<AppCheckout> {
  const target = await serviceTarget(deps, input.serviceId);
  return asSheet(await openCheckout(deps, customer, input, target, "app"));
}

export type QuoteCheckoutRequest = Omit<CheckoutRequest, "serviceId"> & { quoteId: string };

/**
 * Books an accepted quote (SPEC §20): the quoted price and duration, the business's
 * windows and notice rules, an address in the request's postal code area. Always confirmed
 * on payment: the business already agreed.
 */
export async function startQuoteCheckout(
  deps: BookingDeps,
  customer: { id: string; email: string | null },
  input: QuoteCheckoutRequest,
): Promise<{ checkoutId: string; url: string }> {
  const target = await quoteTarget(deps, customer.id, input.quoteId);
  return asPage(
    await openCheckout(deps, customer, { ...input, serviceId: target.serviceId }, target, "web"),
  );
}

/** Booking a quote inside the app. */
export async function startQuoteAppCheckout(
  deps: BookingDeps,
  customer: { id: string; email: string | null },
  input: QuoteCheckoutRequest,
): Promise<AppCheckout> {
  const target = await quoteTarget(deps, customer.id, input.quoteId);
  return asSheet(
    await openCheckout(deps, customer, { ...input, serviceId: target.serviceId }, target, "app"),
  );
}

function asPage(opened: Opened): { checkoutId: string; url: string } {
  if (!("url" in opened)) throw new Error("expected a payment page");
  return opened;
}

function asSheet(opened: Opened): AppCheckout {
  if ("url" in opened) throw new Error("expected an in-app payment");
  return opened;
}

async function openCheckout(
  deps: BookingDeps,
  customer: { id: string; email: string | null },
  input: CheckoutRequest,
  target: CheckoutTarget,
  channel: "web" | "app",
): Promise<Opened> {
  const now = deps.now();
  const { business, area, priceCents, instantBook } = target;
  if (target.requiredArea && !sameQuoteArea(target.requiredArea, input.address.postalCode)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `The quote is for ${postalAreaOf(target.requiredArea)}. Use an address with a postal code starting ${postalAreaOf(target.requiredArea)}, or ask for a new quote.`,
    });
  }
  if (
    !canTakeBookings({
      payoutsEnabled: business.payoutsEnabled,
      payoutSetupDueAt: business.payoutSetupDueAt,
      now,
    })
  ) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This pro isn't taking bookings right now.",
    });
  }
  const [member] = await deps.db
    .select({ id: businessMembers.id })
    .from(businessMembers)
    .where(
      and(eq(businessMembers.businessId, business.id), eq(businessMembers.userId, customer.id)),
    )
    .limit(1);
  if (member)
    throw new TRPCError({ code: "FORBIDDEN", message: "You can't book your own business." });

  // The job address's postal code area must be inside the service radius (SPEC §19).
  const lookup = await lookupPostalArea(deps.db, input.address.postalCode);
  if (lookup.kind !== "found") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "We can't place that postal code yet. Check it, or try a nearby one.",
    });
  }
  if (haversineKm(lookup.area.point, area) > area.radiusKm) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `That address is outside ${business.name}'s service area.`,
    });
  }

  const date = parseIsoDate(input.date);
  if (!date) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a day." });
  const charge = calculateCharge({
    priceCents,
    province: business.province,
    businessTaxRegistered: business.taxRegistered,
    at: now,
  });
  // A minute over Stripe's 30-minute minimum, so the session is always accepted.
  const expiresAt = new Date(now.getTime() + (CHECKOUT_HOLD_MINUTES + 1) * MS_PER_MINUTE);

  const { checkout, replaced } = await deps.db.transaction(async (tx) => {
    await lockBusinessCapacity(tx, business.id);
    // A new checkout for the same pro replaces the customer's earlier ones.
    const replaced = await tx
      .update(bookingCheckouts)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(bookingCheckouts.customerId, customer.id),
          eq(bookingCheckouts.businessId, business.id),
          eq(bookingCheckouts.status, "open"),
        ),
      )
      .returning({
        sessionId: bookingCheckouts.providerSessionId,
        paymentIntentId: bookingCheckouts.providerPaymentIntentId,
      });
    const open = await tx
      .select({ id: bookingCheckouts.id })
      .from(bookingCheckouts)
      .where(
        and(eq(bookingCheckouts.customerId, customer.id), eq(bookingCheckouts.status, "open")),
      );
    if (open.length >= MAX_OPEN_CHECKOUTS) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Finish or leave your other checkouts before starting another.",
      });
    }
    const schedule = await loadSchedule(tx, business, date, 1, now);
    const check = checkWindow({
      now,
      rules: noticeRules(business),
      windows: schedule.windows,
      members: schedule.members,
      placed: schedule.placed,
      workMinutes: target.workMinutes,
      date,
      startMinute: input.windowStart,
      timeZone: business.timezone,
    });
    if (!check.ok)
      throw new TRPCError({ code: "CONFLICT", message: WINDOW_MESSAGES[check.reason] });

    const [address] = await tx
      .insert(addresses)
      .values({
        userId: customer.id,
        line1: input.address.line1,
        line2: input.address.line2,
        city: input.address.city,
        province: business.province,
        postalCode: input.address.postalCode,
      })
      .returning({ id: addresses.id });
    const [row] = await tx
      .insert(bookingCheckouts)
      .values({
        customerId: customer.id,
        businessId: business.id,
        serviceId: target.serviceId,
        quoteId: target.quoteId,
        title: target.title,
        addressId: address?.id ?? "",
        startsAt: check.slot.startsAt,
        endsAt: check.slot.endsAt,
        workMinutes: target.workMinutes,
        timezone: business.timezone,
        instantBook,
        priceCents: charge.priceCents,
        serviceFeeCents: charge.serviceFeeCents,
        priceTaxCents: charge.taxOnPriceCents,
        feeTaxCents: charge.taxOnFeeCents,
        totalCents: charge.totalCents,
        businessFeeCents: charge.businessFeeCents,
        taxProvince: business.province,
        cancellationPolicy: business.cancellationPolicy,
        customerNotes: input.notes,
        provider: deps.payments.name,
        expiresAt,
      })
      .returning();
    if (!row) throw new Error("checkout insert returned nothing");
    return { checkout: row, replaced };
  });
  // Close the replaced payments too, so an old tab or payment sheet can't still be paid.
  for (const old of replaced) {
    if (old.sessionId) await deps.payments.expireCheckout(old.sessionId).catch(() => undefined);
    if (old.paymentIntentId) {
      await deps.payments.cancelPaymentIntent(old.paymentIntentId).catch(() => undefined);
    }
  }

  const when = whenLabel(checkout.startsAt, checkout.endsAt, checkout.timezone);
  const tax = checkout.priceTaxCents + checkout.feeTaxCents;
  const capture = instantBook ? "now" : "hold";
  const description = `${business.name}: ${target.title}, ${when}`;
  try {
    if (channel === "app") {
      if (deps.payments.name === "stripe" && !deps.config.stripePublishableKey) {
        throw new Error("STRIPE_PUBLISHABLE_KEY is not set");
      }
      const intent = await deps.payments.createPaymentIntent({
        reference: checkout.id,
        amountCents: checkout.totalCents,
        capture,
        customerEmail: customer.email,
        description,
        metadata: { checkoutId: checkout.id, businessId: business.id },
      });
      await deps.db
        .update(bookingCheckouts)
        .set({ providerPaymentIntentId: intent.id })
        .where(eq(bookingCheckouts.id, checkout.id));
      return {
        checkoutId: checkout.id,
        provider: deps.payments.name,
        paymentIntentId: intent.id,
        clientSecret: intent.clientSecret,
        publishableKey: deps.payments.name === "stripe" ? deps.config.stripePublishableKey : null,
        amountCents: checkout.totalCents,
        capture,
        description,
      };
    }
    const session = await deps.payments.createCheckout({
      reference: checkout.id,
      lines: [
        { name: `${target.title} · ${when}`, amountCents: checkout.priceCents },
        { name: "Service fee", amountCents: checkout.serviceFeeCents },
        ...(tax > 0 ? [{ name: "HST", amountCents: tax }] : []),
      ],
      capture,
      customerEmail: customer.email,
      description,
      successUrl: `${deps.config.siteUrl}/bookings/return?session={SESSION_ID}`,
      cancelUrl: target.cancelUrl,
      expiresAt,
      metadata: { checkoutId: checkout.id, businessId: business.id },
    });
    await deps.db
      .update(bookingCheckouts)
      .set({ providerSessionId: session.id })
      .where(eq(bookingCheckouts.id, checkout.id));
    return { checkoutId: checkout.id, url: session.url };
  } catch (error) {
    await deps.db
      .update(bookingCheckouts)
      .set({ status: "cancelled" })
      .where(eq(bookingCheckouts.id, checkout.id));
    console.error("[bookings] could not open checkout", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "We couldn't start the payment. Please try again.",
    });
  }
}

export type CheckoutOutcome =
  | { status: "booked" | "requested"; bookingId: string }
  | { status: "pending" | "expired" | "unknown" }
  | { status: "refunded"; message: string };

/**
 * Turns a paid (or, for approval requests, authorised) checkout into a booking, exactly
 * once. Called by the payment webhook and by the page the customer returns to, whichever
 * comes first.
 */
export async function completeCheckout(
  deps: BookingDeps,
  sessionId: string,
): Promise<CheckoutOutcome> {
  const [existing] = await deps.db
    .select()
    .from(bookingCheckouts)
    .where(eq(bookingCheckouts.providerSessionId, sessionId))
    .limit(1);
  if (!existing) return { status: "unknown" };
  if (existing.status === "completed" && existing.bookingId) {
    const [booking] = await deps.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, existing.bookingId));
    return {
      status: booking?.status === "requested" ? "requested" : "booked",
      bookingId: existing.bookingId,
    };
  }
  const state = await deps.payments.getCheckout(sessionId);
  if (state.status === "expired") {
    await deps.db
      .update(bookingCheckouts)
      .set({ status: "expired" })
      .where(and(eq(bookingCheckouts.id, existing.id), eq(bookingCheckouts.status, "open")));
    return { status: "expired" };
  }
  if (state.status !== "complete" || state.payment === "unpaid" || !state.paymentIntentId) {
    return { status: "pending" };
  }
  return finalizeCheckout(deps, existing, state.payment, state.paymentIntentId);
}

/**
 * Finishes an in-app checkout (SPEC §20) from its payment intent: called by the app after
 * the payment sheet, by the payment webhook, and by the test payment screen.
 */
export async function completeAppCheckout(
  deps: BookingDeps,
  checkoutId: string,
): Promise<CheckoutOutcome> {
  const [existing] = await deps.db
    .select()
    .from(bookingCheckouts)
    .where(eq(bookingCheckouts.id, checkoutId))
    .limit(1);
  if (!existing?.providerPaymentIntentId || existing.providerSessionId)
    return { status: "unknown" };
  if (existing.status === "completed" && existing.bookingId) {
    const [booking] = await deps.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, existing.bookingId));
    return {
      status: booking?.status === "requested" ? "requested" : "booked",
      bookingId: existing.bookingId,
    };
  }
  const state = await deps.payments.getPaymentIntent(existing.providerPaymentIntentId);
  if (state.payment === "canceled") {
    await deps.db
      .update(bookingCheckouts)
      .set({ status: "expired" })
      .where(and(eq(bookingCheckouts.id, existing.id), eq(bookingCheckouts.status, "open")));
    return { status: "expired" };
  }
  if (state.payment === "unpaid") return { status: "pending" };
  return finalizeCheckout(deps, existing, state.payment, state.id);
}

/** Turns a paid or authorised checkout into a booking, exactly once (both channels). */
async function finalizeCheckout(
  deps: BookingDeps,
  existing: BookingCheckout,
  paymentState: "paid" | "authorized",
  paymentIntentId: string,
): Promise<CheckoutOutcome> {
  const now = deps.now();
  const mail: Mail = [];

  const outcome = await deps.db.transaction(async (tx): Promise<CheckoutOutcome> => {
    await lockBusinessCapacity(tx, existing.businessId);
    const [checkout] = await tx
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, existing.id))
      .for("update");
    if (!checkout) return { status: "unknown" };
    if (checkout.status === "completed" && checkout.bookingId) {
      return { status: "booked", bookingId: checkout.bookingId };
    }
    const [business] = await tx
      .select()
      .from(businesses)
      .where(eq(businesses.id, checkout.businessId));
    const [service] = await tx.select().from(services).where(eq(services.id, checkout.serviceId));
    if (!business || !service) return { status: "unknown" };

    // A hold that lapsed here (but was paid at the provider) must still fit.
    if (checkout.status !== "open" && !(await checkoutStillFits(tx, checkout, business, now))) {
      await tx
        .update(bookingCheckouts)
        .set({ status: "cancelled" })
        .where(eq(bookingCheckouts.id, checkout.id));
      return { status: "refunded", message: "That time was taken while you paid." };
    }

    // A quote the business revised (or that closed) while the customer paid isn't booked.
    if (checkout.quoteId && !(await quoteStillPending(tx, checkout.quoteId))) {
      await tx
        .update(bookingCheckouts)
        .set({ status: "cancelled" })
        .where(eq(bookingCheckouts.id, checkout.id));
      return {
        status: "refunded",
        message: "The pro changed their quote while you were paying. Check the new quote.",
      };
    }

    const confirmed = paymentState === "paid";
    const [booking] = await tx
      .insert(bookings)
      .values({
        customerId: checkout.customerId,
        businessId: checkout.businessId,
        serviceId: checkout.serviceId,
        quoteId: checkout.quoteId,
        title: checkout.title,
        addressId: checkout.addressId,
        kind: "one_off",
        status: confirmed ? "confirmed" : "requested",
        // Timers (approval expiry) are measured from here, on the app's clock.
        createdAt: now,
        priceCents: checkout.priceCents,
        serviceFeeCents: checkout.serviceFeeCents,
        priceTaxCents: checkout.priceTaxCents,
        feeTaxCents: checkout.feeTaxCents,
        totalCents: checkout.totalCents,
        taxProvince: checkout.taxProvince,
        cancellationPolicy: checkout.cancellationPolicy,
        timezone: checkout.timezone,
        requestedStartsAt: checkout.startsAt,
        requestedEndsAt: checkout.endsAt,
        customerNotes: checkout.customerNotes,
        confirmedAt: confirmed ? now : null,
        approvalExpiresAt: confirmed
          ? null
          : new Date(
              Math.min(
                now.getTime() + APPROVAL_EXPIRY_HOURS * MS_PER_HOUR,
                checkout.startsAt.getTime(),
              ),
            ),
      })
      .returning();
    if (!booking) throw new Error("booking insert returned nothing");
    if (confirmed) {
      await tx.insert(visits).values({
        bookingId: booking.id,
        businessId: booking.businessId,
        startsAt: checkout.startsAt,
        endsAt: checkout.endsAt,
        workMinutes: checkout.workMinutes,
      });
    }
    const [payment] = await tx
      .insert(payments)
      .values({
        bookingId: booking.id,
        businessId: booking.businessId,
        provider: checkout.provider,
        stripePaymentIntentId: paymentIntentId,
        amountCents: checkout.totalCents,
        priceCents: checkout.priceCents,
        serviceFeeCents: checkout.serviceFeeCents,
        priceTaxCents: checkout.priceTaxCents,
        feeTaxCents: checkout.feeTaxCents,
        businessFeeCents: checkout.businessFeeCents,
        status: confirmed ? "succeeded" : "authorized",
        succeededAt: confirmed ? now : null,
      })
      .returning({ id: payments.id });
    await tx
      .update(bookingCheckouts)
      .set({
        status: "completed",
        completedAt: now,
        bookingId: booking.id,
        providerPaymentIntentId: paymentIntentId,
      })
      .where(eq(bookingCheckouts.id, checkout.id));
    await audit(
      tx,
      confirmed ? "payment.collected" : "payment.authorized",
      "payment",
      payment?.id ?? "",
      null,
      {
        bookingId: booking.id,
        amountCents: checkout.totalCents,
      },
    );

    // Chat carries on from the quote, or opens with the booking (SPEC §20).
    if (checkout.quoteId) {
      mail.push(...((await acceptQuoteInTx(tx, deps, checkout.quoteId, booking.id, now)) ?? []));
    } else {
      await openConversation(tx, {
        customerId: booking.customerId,
        businessId: booking.businessId,
        bookingId: booking.id,
      });
    }

    const parts: BookingParts = {
      booking,
      visit: null,
      payment: null,
      dispute: null,
      service,
      business,
    };
    const facts = mailFacts(parts, deps.config);
    const customer = await customerEmail(tx, booking.customerId);
    const team = await businessTeamEmails(tx, business.id);
    if (confirmed) {
      mail.push(...bookingEmails.bookedForCustomer(customer, facts, receiptText(booking)));
      mail.push(...bookingEmails.newBookingForBusiness(team, facts));
      const due = await startPayoutClock(tx, business, now);
      if (due)
        mail.push(
          ...businessEmails.payoutSetupStarted(
            team,
            deps.config.siteUrl,
            dueLabel(due, business.timezone),
          ),
        );
    } else {
      mail.push(...bookingEmails.requestedForCustomer(customer, facts));
      mail.push(...bookingEmails.newRequestForBusiness(team, facts));
    }
    return { status: confirmed ? "booked" : "requested", bookingId: booking.id };
  });

  if (outcome.status === "refunded") {
    // Nothing was booked: give the money back in full.
    if (paymentState === "paid") {
      await deps.payments.refund({
        paymentIntentId,
        amountCents: existing.totalCents,
        idempotencyKey: `checkout-refund-${existing.id}`,
      });
    } else {
      await deps.payments.release(paymentIntentId);
    }
  }
  await sendAll(deps.email, mail);
  await pushNotifications(deps);
  return outcome;
}

/** Whether a quote is still the pending one for an open request (locks both rows). */
async function quoteStillPending(tx: DbExecutor, quoteId: string): Promise<boolean> {
  const [quote] = await tx.select().from(quotes).where(eq(quotes.id, quoteId)).for("update");
  if (quote?.status !== "pending") return false;
  const [request] = await tx
    .select({ status: quoteRequests.status })
    .from(quoteRequests)
    .where(eq(quoteRequests.id, quote.quoteRequestId))
    .for("update");
  return request?.status === "quoted";
}

async function checkoutStillFits(
  tx: DbExecutor,
  checkout: BookingCheckout,
  business: Business,
  now: Date,
): Promise<boolean> {
  const local = toLocal(checkout.startsAt, checkout.timezone);
  const date = { year: local.year, month: local.month, day: local.day };
  const schedule = await loadSchedule(tx, business, date, 1, now, {
    excludeCheckoutId: checkout.id,
  });
  const plan = planDay({ date, ...schedule, timeZone: checkout.timezone });
  const slot = plan.find(
    (candidate) => candidate.startsAt.getTime() === checkout.startsAt.getTime(),
  );
  return slot !== undefined && fitsInWindow(plan, slot.index, checkout.workMinutes);
}

/** Closes checkouts that ran out of time, freeing their windows (scheduled job). */
export async function expireCheckouts(deps: BookingDeps): Promise<number> {
  const now = deps.now();
  const stale = await deps.db
    .select()
    .from(bookingCheckouts)
    .where(and(eq(bookingCheckouts.status, "open"), lte(bookingCheckouts.expiresAt, now)));
  let expired = 0;
  for (const checkout of stale) {
    if (checkout.providerSessionId) {
      // A session paid at the last moment becomes a booking instead.
      const outcome = await completeCheckout(deps, checkout.providerSessionId).catch(() => null);
      if (outcome && outcome.status !== "pending" && outcome.status !== "unknown") continue;
      await deps.payments.expireCheckout(checkout.providerSessionId).catch(() => undefined);
    } else if (checkout.providerPaymentIntentId) {
      // An in-app payment finished at the last moment becomes a booking instead.
      const outcome = await completeAppCheckout(deps, checkout.id).catch(() => null);
      if (outcome && outcome.status !== "pending" && outcome.status !== "unknown") continue;
      await deps.payments
        .cancelPaymentIntent(checkout.providerPaymentIntentId)
        .catch(() => undefined);
    }
    await deps.db
      .update(bookingCheckouts)
      .set({ status: "expired" })
      .where(and(eq(bookingCheckouts.id, checkout.id), eq(bookingCheckouts.status, "open")));
    expired += 1;
  }
  return expired;
}

// ---------------------------------------------------------------------------------------
// Requests (approval)
// ---------------------------------------------------------------------------------------

async function lockedParts(
  tx: DbExecutor,
  bookingId: string,
  businessId?: string,
): Promise<BookingParts> {
  const parts = await loadBookingParts(tx, bookingId, { lock: true });
  if (!parts || (businessId && parts.booking.businessId !== businessId)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
  }
  return parts;
}

/** Work minutes of a booking: its visit's, or the checkout's for a request. */
async function workMinutesOf(tx: DbExecutor, parts: BookingParts): Promise<number> {
  if (parts.visit) return parts.visit.workMinutes;
  const [checkout] = await tx
    .select({ workMinutes: bookingCheckouts.workMinutes })
    .from(bookingCheckouts)
    .where(eq(bookingCheckouts.bookingId, parts.booking.id))
    .limit(1);
  return checkout?.workMinutes ?? parts.service.durationMinutes;
}

/** The business accepts a request: re-checks capacity, charges the card, confirms (SPEC §19). */
export async function acceptRequest(
  deps: BookingDeps,
  actorUserId: string,
  businessId: string,
  bookingId: string,
): Promise<void> {
  const now = deps.now();
  const mail: Mail = [];
  await deps.db.transaction(async (tx) => {
    await lockBusinessCapacity(tx, businessId);
    const parts = await lockedParts(tx, bookingId, businessId);
    assertTransition(parts, "approve", now);
    const { booking, payment, business } = parts;
    const startsAt = booking.requestedStartsAt;
    const endsAt = booking.requestedEndsAt;
    if (payment?.status !== "authorized" || !startsAt || !endsAt) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This request has no card hold to charge.",
      });
    }
    const workMinutes = await workMinutesOf(tx, parts);
    const local = toLocal(startsAt, booking.timezone);
    const date = { year: local.year, month: local.month, day: local.day };
    const schedule = await loadSchedule(tx, business, date, 1, now);
    const plan = planDay({ date, ...schedule, timeZone: booking.timezone });
    const slot = plan.find((candidate) => candidate.startsAt.getTime() === startsAt.getTime());
    if (!slot || !fitsInWindow(plan, slot.index, workMinutes)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "That window is already full. Decline the request, or free up time first.",
      });
    }
    await deps.payments.capture(payment.stripePaymentIntentId);
    await tx
      .update(payments)
      .set({ status: "succeeded", succeededAt: now })
      .where(eq(payments.id, payment.id));
    const [updated] = await tx
      .update(bookings)
      .set({ status: "confirmed", confirmedAt: now, approvalExpiresAt: null })
      .where(eq(bookings.id, booking.id))
      .returning();
    await tx.insert(visits).values({
      bookingId: booking.id,
      businessId: booking.businessId,
      startsAt,
      endsAt,
      workMinutes,
    });
    await audit(tx, "payment.captured", "payment", payment.id, actorUserId, {
      bookingId: booking.id,
    });
    const facts = mailFacts(parts, deps.config);
    mail.push(
      ...bookingEmails.acceptedForCustomer(
        await customerEmail(tx, booking.customerId),
        facts,
        receiptText(updated ?? booking),
      ),
    );
    const due = await startPayoutClock(tx, business, now);
    if (due) {
      mail.push(
        ...businessEmails.payoutSetupStarted(
          await businessTeamEmails(tx, business.id),
          deps.config.siteUrl,
          dueLabel(due, business.timezone),
        ),
      );
    }
  });
  await sendAll(deps.email, mail);
}

/** Declines (business) or expires (system) a request and releases the card hold. */
export async function endRequest(
  deps: BookingDeps,
  bookingId: string,
  how: { by: "business"; actorUserId: string; businessId: string } | { by: "system" },
): Promise<void> {
  const now = deps.now();
  const mail: Mail = [];
  await deps.db.transaction(async (tx) => {
    const parts = await lockedParts(
      tx,
      bookingId,
      how.by === "business" ? how.businessId : undefined,
    );
    const event = how.by === "business" ? "decline" : "expire";
    assertTransition(parts, event, now);
    if (parts.payment?.status === "authorized") {
      await deps.payments.release(parts.payment.stripePaymentIntentId);
      await tx
        .update(payments)
        .set({ status: "cancelled" })
        .where(eq(payments.id, parts.payment.id));
    }
    await tx
      .update(bookings)
      .set({ status: how.by === "business" ? "declined" : "expired", approvalExpiresAt: null })
      .where(eq(bookings.id, bookingId));
    await audit(
      tx,
      "payment.released",
      "booking",
      bookingId,
      how.by === "business" ? how.actorUserId : null,
      {
        reason: event,
      },
    );
    mail.push(
      ...bookingEmails.declinedForCustomer(
        await customerEmail(tx, parts.booking.customerId),
        mailFacts(parts, deps.config),
        how.by === "business" ? "declined" : "expired",
      ),
    );
  });
  await sendAll(deps.email, mail);
}

// ---------------------------------------------------------------------------------------
// Cancellations and refunds
// ---------------------------------------------------------------------------------------

/** What the customer would get back if they cancelled now (null: nothing is charged). */
export function customerCancellationQuote(parts: BookingParts, now: Date): RefundBreakdown | null {
  const { booking, visit, payment } = parts;
  if (payment?.status !== "succeeded" || !visit) return null;
  return refundForCustomerCancellation({
    priceCents: payment.priceCents,
    serviceFeeCents: payment.serviceFeeCents,
    taxOnPriceCents: payment.priceTaxCents,
    taxOnFeeCents: payment.feeTaxCents,
    policy: booking.cancellationPolicy,
    jobStartsAt: visit.startsAt,
    jobTimeZone: booking.timezone,
    cancelledAt: now,
  });
}

/** Sends a refund to the provider and records it, split like the payment (SPEC §5). */
async function recordRefund(
  tx: DbExecutor,
  provider: PaymentProvider,
  payment: Payment,
  refund: RefundBreakdown,
  reason: "customer_cancellation" | "business_cancellation",
  actorUserId: string | null,
  now: Date,
): Promise<void> {
  const fullyRefunded = refund.totalRefundCents === payment.amountCents;
  if (refund.totalRefundCents > 0) {
    const { refundId } = await provider.refund({
      paymentIntentId: payment.stripePaymentIntentId,
      amountCents: refund.totalRefundCents,
      idempotencyKey: `refund-${payment.id}-${reason}`,
    });
    await tx.insert(refunds).values({
      paymentId: payment.id,
      stripeRefundId: refundId,
      amountCents: refund.totalRefundCents,
      priceCents: refund.priceRefundCents,
      serviceFeeCents: refund.serviceFeeRefundCents,
      priceTaxCents: refund.taxOnPriceRefundCents,
      feeTaxCents: refund.taxOnFeeRefundCents,
      businessFeeAdjustmentCents: payment.businessFeeCents - refund.businessFeeCents,
      reason,
      status: "succeeded",
      initiatedByUserId: actorUserId,
    });
    await audit(tx, "payment.refunded", "payment", payment.id, actorUserId, {
      amountCents: refund.totalRefundCents,
      reason,
    });
  }
  await tx
    .update(payments)
    .set({
      status: fullyRefunded
        ? "refunded"
        : refund.totalRefundCents > 0
          ? "partially_refunded"
          : payment.status,
      // Whatever the business keeps is paid out in the next batch.
      releasedAt: refund.retainedPriceCents > 0 ? now : null,
    })
    .where(eq(payments.id, payment.id));
}

/** The customer cancels a request (hold released) or a confirmed job (policy refund). */
export async function cancelByCustomer(
  deps: BookingDeps,
  customerId: string,
  bookingId: string,
): Promise<void> {
  const now = deps.now();
  const mail: Mail = [];
  await deps.db.transaction(async (tx) => {
    const parts = await lockedParts(tx, bookingId);
    if (parts.booking.customerId !== customerId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
    }
    assertTransition(parts, "cancel_by_customer", now);
    const { booking, visit, payment } = parts;
    let refundCents = 0;
    if (booking.status === "requested") {
      if (payment?.status === "authorized") {
        await deps.payments.release(payment.stripePaymentIntentId);
        await tx.update(payments).set({ status: "cancelled" }).where(eq(payments.id, payment.id));
      }
    } else if (payment) {
      const refund = customerCancellationQuote(parts, now);
      if (refund) {
        await recordRefund(
          tx,
          deps.payments,
          payment,
          refund,
          "customer_cancellation",
          customerId,
          now,
        );
        refundCents = refund.totalRefundCents;
      }
    }
    if (visit) {
      await tx
        .update(visits)
        .set({ status: "cancelled_by_customer", cancelledAt: now })
        .where(eq(visits.id, visit.id));
    }
    await tx
      .update(bookings)
      .set({ status: "cancelled_by_customer", cancelledAt: now, approvalExpiresAt: null })
      .where(eq(bookings.id, booking.id));
    const facts = mailFacts(parts, deps.config);
    mail.push(
      ...bookingEmails.cancelledForCustomer(
        await customerEmail(tx, booking.customerId),
        facts,
        "customer",
        refundCents,
      ),
    );
    if (booking.status === "confirmed") {
      mail.push(
        ...bookingEmails.cancelledForBusiness(
          await businessTeamEmails(tx, booking.businessId),
          facts,
        ),
      );
    }
  });
  await sendAll(deps.email, mail);
}

/**
 * The business (or Nevile, for missing payout setup) cancels a confirmed job: a full
 * refund including the service fee, counted on its reliability stats (SPEC §5).
 */
export async function cancelByBusiness(
  deps: BookingDeps,
  bookingId: string,
  how: { actorUserId: string | null; businessId?: string; reason: string },
): Promise<void> {
  const now = deps.now();
  const mail: Mail = [];
  await deps.db.transaction(async (tx) => {
    const parts = await lockedParts(tx, bookingId, how.businessId);
    assertTransition(parts, "cancel_by_business", now);
    const { booking, visit, payment } = parts;
    let refundCents = 0;
    if (payment && payment.status === "succeeded") {
      const refund = refundForBusinessCancellation({
        priceCents: payment.priceCents,
        serviceFeeCents: payment.serviceFeeCents,
        taxOnPriceCents: payment.priceTaxCents,
        taxOnFeeCents: payment.feeTaxCents,
      });
      await recordRefund(
        tx,
        deps.payments,
        payment,
        refund,
        "business_cancellation",
        how.actorUserId,
        now,
      );
      refundCents = refund.totalRefundCents;
    }
    if (visit) {
      await tx
        .update(visits)
        .set({ status: "cancelled_by_business", cancelledAt: now })
        .where(eq(visits.id, visit.id));
    }
    await tx
      .update(bookings)
      .set({ status: "cancelled_by_business", cancelledAt: now, cancellationReason: how.reason })
      .where(eq(bookings.id, booking.id));
    mail.push(
      ...bookingEmails.cancelledForCustomer(
        await customerEmail(tx, booking.customerId),
        mailFacts(parts, deps.config),
        "business",
        refundCents,
        how.reason,
      ),
    );
  });
  await sendAll(deps.email, mail);
}

// ---------------------------------------------------------------------------------------
// Completion and problems (SPEC §6)
// ---------------------------------------------------------------------------------------

/** The business marks a job done; the customer has 48 hours to confirm or report. */
export async function markDone(
  deps: BookingDeps,
  actorUserId: string,
  businessId: string,
  bookingId: string,
) {
  const now = deps.now();
  const mail: Mail = [];
  await deps.db.transaction(async (tx) => {
    const parts = await lockedParts(tx, bookingId, businessId);
    assertTransition(parts, "mark_complete", now);
    const autoConfirmAt = new Date(now.getTime() + COMPLETION_CONFIRMATION_HOURS * MS_PER_HOUR);
    await tx
      .update(visits)
      .set({
        status: "completed_pending_confirmation",
        completedAt: now,
        completedByUserId: actorUserId,
        autoConfirmAt,
      })
      .where(eq(visits.id, parts.visit?.id ?? ""));
    await tx
      .update(bookings)
      .set({ status: "completed_pending_confirmation" })
      .where(eq(bookings.id, bookingId));
    mail.push(
      ...bookingEmails.doneForCustomer(
        await customerEmail(tx, parts.booking.customerId),
        mailFacts(parts, deps.config),
      ),
    );
  });
  await sendAll(deps.email, mail);
}

/** Marks a job complete and releases its money for the next payout. */
async function completeJob(
  tx: DbExecutor,
  parts: BookingParts,
  now: Date,
  auto: boolean,
): Promise<void> {
  await tx
    .update(visits)
    .set({ status: "completed", confirmedAt: now, autoConfirmed: auto, autoConfirmAt: null })
    .where(eq(visits.id, parts.visit?.id ?? ""));
  await tx.update(bookings).set({ status: "completed" }).where(eq(bookings.id, parts.booking.id));
  if (parts.payment) {
    await tx.update(payments).set({ releasedAt: now }).where(eq(payments.id, parts.payment.id));
  }
  if (parts.dispute) {
    await tx
      .update(disputes)
      .set({ status: "resolved", resolution: "customer_confirmed", resolvedAt: now })
      .where(eq(disputes.id, parts.dispute.id));
  }
}

/** The customer confirms the job is done (also after a fix). */
export async function confirmDone(
  deps: BookingDeps,
  customerId: string,
  bookingId: string,
): Promise<void> {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const parts = await lockedParts(tx, bookingId);
    if (parts.booking.customerId !== customerId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
    }
    assertTransition(parts, "confirm_completion", now);
    await completeJob(tx, parts, now, false);
  });
}

/** Confirms jobs nobody answered within 48 hours (scheduled job). */
export async function autoConfirmJobs(deps: BookingDeps): Promise<number> {
  const now = deps.now();
  const due = await deps.db
    .select({ bookingId: visits.bookingId })
    .from(visits)
    .where(
      and(eq(visits.status, "completed_pending_confirmation"), lte(visits.autoConfirmAt, now)),
    );
  let confirmed = 0;
  for (const visit of due) {
    await deps.db.transaction(async (tx) => {
      const parts = await lockedParts(tx, visit.bookingId);
      if (!transition(snapshotOf(parts), { type: "auto_confirm", at: now }).ok) return;
      await completeJob(tx, parts, now, true);
      confirmed += 1;
    });
  }
  return confirmed;
}

/** The customer reports a problem: payment stays held, the business has 3 days to fix it. */
export async function reportProblem(
  deps: BookingDeps,
  customerId: string,
  bookingId: string,
  reason: string,
): Promise<void> {
  const now = deps.now();
  const mail: Mail = [];
  await deps.db.transaction(async (tx) => {
    const parts = await lockedParts(tx, bookingId);
    if (parts.booking.customerId !== customerId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
    }
    assertTransition(parts, "report_problem", now);
    await tx.insert(disputes).values({
      visitId: parts.visit?.id ?? "",
      openedByUserId: customerId,
      // The 3-day fix window is measured from here, on the app's clock.
      createdAt: now,
      updatedAt: now,
      reason,
      fixDeadline: new Date(now.getTime() + FIX_WINDOW_DAYS * MS_PER_DAY),
    });
    await tx
      .update(visits)
      .set({ status: "disputed", autoConfirmAt: null })
      .where(eq(visits.id, parts.visit?.id ?? ""));
    await tx.update(bookings).set({ status: "disputed" }).where(eq(bookings.id, bookingId));
    mail.push(
      ...bookingEmails.problemForBusiness(
        await businessTeamEmails(tx, parts.booking.businessId),
        mailFacts(parts, deps.config),
        reason,
      ),
    );
  });
  await sendAll(deps.email, mail);
}

/** The business says it will come back (disputed → fix scheduled). */
export async function scheduleFix(
  deps: BookingDeps,
  businessId: string,
  bookingId: string,
): Promise<void> {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const parts = await lockedParts(tx, bookingId, businessId);
    assertTransition(parts, "schedule_fix", now);
    await tx
      .update(visits)
      .set({ status: "fix_scheduled" })
      .where(eq(visits.id, parts.visit?.id ?? ""));
    await tx.update(bookings).set({ status: "fix_scheduled" }).where(eq(bookings.id, bookingId));
    if (parts.dispute) {
      await tx
        .update(disputes)
        .set({ status: "fix_scheduled" })
        .where(eq(disputes.id, parts.dispute.id));
    }
  });
}

/** The business fixed it: the customer gets a fresh 48 hours to confirm. */
export async function markFixed(
  deps: BookingDeps,
  businessId: string,
  bookingId: string,
): Promise<void> {
  const now = deps.now();
  const mail: Mail = [];
  await deps.db.transaction(async (tx) => {
    const parts = await lockedParts(tx, bookingId, businessId);
    assertTransition(parts, "mark_fixed", now);
    await tx
      .update(visits)
      .set({
        status: "completed_pending_confirmation",
        autoConfirmAt: new Date(now.getTime() + COMPLETION_CONFIRMATION_HOURS * MS_PER_HOUR),
      })
      .where(eq(visits.id, parts.visit?.id ?? ""));
    await tx
      .update(bookings)
      .set({ status: "completed_pending_confirmation" })
      .where(eq(bookings.id, bookingId));
    mail.push(
      ...bookingEmails.doneForCustomer(
        await customerEmail(tx, parts.booking.customerId),
        mailFacts(parts, deps.config),
      ),
    );
  });
  await sendAll(deps.email, mail);
}
