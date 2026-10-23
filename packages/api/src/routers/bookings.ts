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
import { addresses, bookingCheckouts, bookings, desc, eq } from "@nevile/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  type BookingDeps,
  bookableService,
  cancelByCustomer,
  completeCheckout,
  confirmDone,
  loadBookingParts,
  reportProblem,
  startCheckout,
} from "../bookings/flows.ts";
import { loadSchedule, noticeRules } from "../bookings/schedule.ts";
import { customerBookingView } from "../bookings/views.ts";
import type { Context } from "../context.ts";
import { isInstantBookable } from "../listing-state.ts";
import { protectedProcedure, publicProcedure, router, verifiedProcedure } from "../trpc.ts";

const isoDate = z
  .string()
  .refine((value) => parseIsoDate(value) !== null, { message: "Pick a day" });
const bookingIdInput = z.object({ bookingId: z.uuid() });

export function bookingDeps(ctx: Context): BookingDeps {
  return { db: ctx.db, payments: ctx.payments, email: ctx.email, config: ctx.config, now: ctx.now };
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
  return customerBookingView(ctx.db, parts, address, ctx.now());
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
        workMinutes: service.durationMinutes,
        from,
        days: input.days,
        timeZone: business.timezone,
      });
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
    const upcoming = views
      .filter(
        (view) =>
          ["requested", "confirmed"].includes(view.status) && view.window.endsAt.getTime() >= now,
      )
      .sort((a, b) => a.window.startsAt.getTime() - b.window.startsAt.getTime());
    const needsYou = views.filter((view) => view.actions.confirmDone || view.actions.reportProblem);
    const ids = new Set([...upcoming, ...needsYou].map((view) => view.id));
    return { needsYou, upcoming, past: views.filter((view) => !ids.has(view.id)) };
  }),

  get: protectedProcedure
    .input(bookingIdInput)
    .query(({ ctx, input }) => ownBooking(ctx, input.bookingId)),

  cancel: verifiedProcedure.input(bookingIdInput).mutation(async ({ ctx, input }) => {
    await cancelByCustomer(bookingDeps(ctx), ctx.user.id, input.bookingId);
    return ownBooking(ctx, input.bookingId);
  }),

  confirmDone: verifiedProcedure.input(bookingIdInput).mutation(async ({ ctx, input }) => {
    await confirmDone(bookingDeps(ctx), ctx.user.id, input.bookingId);
    return ownBooking(ctx, input.bookingId);
  }),

  reportProblem: verifiedProcedure
    .input(
      bookingIdInput.extend({
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
      await reportProblem(bookingDeps(ctx), ctx.user.id, input.bookingId, input.reason);
      return ownBooking(ctx, input.bookingId);
    }),
});
