import { contactEmail } from "@nevile/auth";
import {
  availableDays,
  bookableRange,
  bookingRequestSchema,
  CANCELLATION_POLICIES,
  calculateCharge,
  canTakeBookings,
  formatArrivalWindow,
  formatDurationMinutes,
  formatIsoDate,
  hasDisallowedControlCharacters,
  parseIsoDate,
  priceSummary,
} from "@nevile/core";
import { addresses, type Business, bookingCheckouts, bookings, desc, eq } from "@nevile/db";
import { FakePaymentProvider, getPaymentProvider, lazyPaymentProvider } from "@nevile/payments";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  type BookingDeps,
  bookableService,
  cancelByCustomer,
  completeAppCheckout,
  completeCheckout,
  confirmDone,
  loadBookingParts,
  reportProblem,
  startAppCheckout,
  startCheckout,
} from "../bookings/flows.ts";
import { handlePaymentEvent } from "../bookings/payouts.ts";
import { loadSchedule, noticeRules } from "../bookings/schedule.ts";
import { customerBookingView } from "../bookings/views.ts";
import type { Context } from "../context.ts";
import { isInstantBookable } from "../listing-state.ts";
import { endSeries } from "../ongoing/recurring.ts";
import { endContract } from "../ongoing/snow.ts";
import { ongoingDetails } from "../ongoing/views.ts";
import { protectedProcedure, publicProcedure, router, verifiedProcedure } from "../trpc.ts";

const isoDate = z
  .string()
  .refine((value) => parseIsoDate(value) !== null, { message: "Pick a day" });
const bookingIdInput = z.object({ bookingId: z.uuid() });
/** A booking, or one visit of a recurring series or snow contract (SPEC §21). */
const jobInput = bookingIdInput.extend({ visitId: z.uuid().optional() });

export function bookingDeps(ctx: Context): BookingDeps {
  return {
    db: ctx.db,
    payments: ctx.payments,
    email: ctx.email,
    push: ctx.push,
    config: ctx.config,
    now: ctx.now,
  };
}

/** The signed-in customer's own checkout, or NOT_FOUND. */
async function ownCheckout(ctx: Context & { user: { id: string } }, checkoutId: string) {
  const [checkout] = await ctx.db
    .select()
    .from(bookingCheckouts)
    .where(eq(bookingCheckouts.id, checkoutId))
    .limit(1);
  if (!checkout || checkout.customerId !== ctx.user.id) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Checkout not found." });
  }
  return checkout;
}

/** The test payment provider, when this environment uses it (never in production). */
export function testProvider(ctx: Context): FakePaymentProvider | null {
  if (process.env.NODE_ENV === "production") return null;
  const provider = ctx.payments === lazyPaymentProvider ? getPaymentProvider() : ctx.payments;
  return provider instanceof FakePaymentProvider ? provider : null;
}

/** The signed-in customer's booking, or NOT_FOUND (never someone else's). */
async function ownBooking(ctx: Context & { user: { id: string } }, bookingId: string) {
  const parts = await loadBookingParts(ctx.db, bookingId);
  if (!parts || parts.booking.customerId !== ctx.user.id) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
  }
  const [address] = await ctx.db
    .select()
    .from(addresses)
    .where(eq(addresses.id, parts.booking.addressId));
  if (!address) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
  const ongoing = await ongoingDetails(ctx.db, parts, "customer", ctx.now());
  return customerBookingView(ctx.db, parts, address, ctx.now(), ongoing);
}

/** Open arrival windows for a job of `workMinutes` at a business, from a day (or its first). */
export async function openWindows(
  ctx: Pick<Context, "db" | "now">,
  business: Business,
  workMinutes: number,
  input: { from?: string; days: number },
) {
  const now = ctx.now();
  const rules = noticeRules(business);
  const range = bookableRange(now, rules, business.timezone);
  const requested = input.from ? parseIsoDate(input.from) : null;
  const from = requested ?? range.first;
  const schedule = await loadSchedule(ctx.db, business, from, input.days, now);
  const days = availableDays({
    now,
    rules,
    windows: schedule.windows,
    members: schedule.members,
    placed: schedule.placed,
    workMinutes,
    from,
    days: input.days,
    timeZone: business.timezone,
  });
  return {
    firstDate: formatIsoDate(range.first),
    lastDate: formatIsoDate(range.last),
    days: days.map((day) => ({
      date: day.date,
      windows: day.windows.map((window) => ({
        startMinute: window.startMinute,
        label: formatArrivalWindow(window),
        available: window.available,
      })),
    })),
  };
}

/** Booking one-off, fixed-price jobs as a customer (SPEC §19). */
export const bookingsRouter = router({
  /** Which arrival windows are open for a service, plus the price breakdown. Public. */
  availability: publicProcedure
    .input(
      z.object({
        serviceId: z.uuid(),
        from: isoDate.optional(),
        days: z.number().int().min(1).max(14).default(7),
      }),
    )
    .query(async ({ ctx, input }) => {
      const now = ctx.now();
      const { service, business, priceCents } = await bookableService(ctx.db, input.serviceId);
      const windows = await openWindows(ctx, business, service.durationMinutes, input);
      const charge = calculateCharge({
        priceCents,
        province: business.province,
        businessTaxRegistered: business.taxRegistered,
        at: now,
      });
      const policy = CANCELLATION_POLICIES[business.cancellationPolicy];
      return {
        service: {
          id: service.id,
          title: service.title,
          description: service.description ?? "",
          duration: formatDurationMinutes(service.durationMinutes),
          priceText: priceSummary({ pricingType: "fixed", priceCents }),
          /** Recurring schedules the customer can pick from (SPEC §21). */
          recurrenceFrequencies: service.recurrenceFrequencies,
        },
        business: { name: business.name, slug: business.slug },
        instantBook: isInstantBookable(business, service),
        bookingOpen: canTakeBookings({
          payoutsEnabled: business.payoutsEnabled,
          payoutSetupDueAt: business.payoutSetupDueAt,
          now,
        }),
        cancellationPolicy: { label: policy.label, description: policy.description },
        price: {
          priceCents: charge.priceCents,
          serviceFeeCents: charge.serviceFeeCents,
          taxCents: charge.taxCents,
          totalCents: charge.totalCents,
        },
        ...windows,
      };
    }),

  /** Holds the window and opens the payment page; returns where to send the customer. */
  checkout: verifiedProcedure
    .input(bookingRequestSchema)
    .mutation(({ ctx, input }) =>
      startCheckout(
        bookingDeps(ctx),
        { id: ctx.user.id, email: contactEmail(ctx.user.email) },
        input,
      ),
    ),

  /** The same, paid inside the app with the payment sheet (SPEC §20). */
  appCheckout: verifiedProcedure
    .input(bookingRequestSchema)
    .mutation(({ ctx, input }) =>
      startAppCheckout(
        bookingDeps(ctx),
        { id: ctx.user.id, email: contactEmail(ctx.user.email) },
        input,
      ),
    ),

  /** After the app's payment sheet: turns the checkout into a booking (if the webhook hasn't). */
  finishAppCheckout: protectedProcedure
    .input(z.object({ checkoutId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ownCheckout(ctx, input.checkoutId);
      return completeAppCheckout(bookingDeps(ctx), input.checkoutId);
    }),

  /**
   * Development only: pays an in-app checkout on the test provider, like finishing the
   * payment sheet. NOT_FOUND in production and with Stripe.
   */
  payTestCheckout: protectedProcedure
    .input(z.object({ checkoutId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const fake = testProvider(ctx);
      if (!fake) throw new TRPCError({ code: "NOT_FOUND", message: "Not available." });
      const checkout = await ownCheckout(ctx, input.checkoutId);
      if (!checkout.providerPaymentIntentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This checkout isn't paid in the app.",
        });
      }
      try {
        await handlePaymentEvent(
          bookingDeps(ctx),
          fake.payIntent(checkout.providerPaymentIntentId),
        );
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: "BAD_REQUEST", message: "This payment is closed." });
      }
      return completeAppCheckout(bookingDeps(ctx), input.checkoutId);
    }),

  /** After paying: turns the checkout into a booking (if the webhook hasn't yet). */
  finishCheckout: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const [checkout] = await ctx.db
        .select({ customerId: bookingCheckouts.customerId })
        .from(bookingCheckouts)
        .where(eq(bookingCheckouts.providerSessionId, input.sessionId))
        .limit(1);
      if (!checkout || checkout.customerId !== ctx.user.id) return { status: "unknown" as const };
      return completeCheckout(bookingDeps(ctx), input.sessionId);
    }),

  /** The customer's bookings, newest first. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.customerId, ctx.user.id))
      .orderBy(desc(bookings.createdAt))
      .limit(100);
    const views = [];
    for (const row of rows) views.push(await ownBooking(ctx, row.id));
    const now = ctx.now().getTime();
    // A running series stays upcoming until it ends; one-off jobs until their window ends.
    const upcoming = views
      .filter(
        (view) =>
          ["requested", "confirmed"].includes(view.status) &&
          (view.ongoing !== null || view.window.endsAt.getTime() >= now),
      )
      .sort((a, b) => a.window.startsAt.getTime() - b.window.startsAt.getTime());
    const needsYou = views.filter((view) => view.needsAttention);
    const ids = new Set([...upcoming, ...needsYou].map((view) => view.id));
    return { needsYou, upcoming, past: views.filter((view) => !ids.has(view.id)) };
  }),

  get: protectedProcedure
    .input(bookingIdInput)
    .query(({ ctx, input }) => ownBooking(ctx, input.bookingId)),

  /** Cancels a one-off job or a request; ends a running series or snow contract (SPEC §21). */
  cancel: verifiedProcedure.input(bookingIdInput).mutation(async ({ ctx, input }) => {
    const [booking] = await ctx.db
      .select({ kind: bookings.kind, customerId: bookings.customerId })
      .from(bookings)
      .where(eq(bookings.id, input.bookingId));
    if (booking?.kind === "recurring") {
      await endSeries(bookingDeps(ctx), input.bookingId, {
        by: "customer",
        customerId: ctx.user.id,
      });
    } else if (booking?.kind === "snow_contract") {
      await endContract(bookingDeps(ctx), input.bookingId, {
        by: "customer",
        customerId: ctx.user.id,
      });
    } else {
      await cancelByCustomer(bookingDeps(ctx), ctx.user.id, input.bookingId);
    }
    return ownBooking(ctx, input.bookingId);
  }),

  confirmDone: verifiedProcedure.input(jobInput).mutation(async ({ ctx, input }) => {
    await confirmDone(bookingDeps(ctx), ctx.user.id, input.bookingId, input.visitId);
    return ownBooking(ctx, input.bookingId);
  }),

  reportProblem: verifiedProcedure
    .input(
      jobInput.extend({
        reason: z
          .string()
          .trim()
          .min(10, { message: "Tell the pro what's wrong in a sentence or two" })
          .max(1000)
          .refine((text) => !hasDisallowedControlCharacters(text), {
            message: "Remove special characters",
          }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await reportProblem(
        bookingDeps(ctx),
        ctx.user.id,
        input.bookingId,
        input.reason,
        input.visitId,
      );
      return ownBooking(ctx, input.bookingId);
    }),
});
