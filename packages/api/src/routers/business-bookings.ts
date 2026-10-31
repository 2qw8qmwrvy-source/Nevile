import { contactEmail } from "@nevile/auth";
import {
  type BookingState,
  formatArrivalWindow,
  formatIsoDate,
  parseIsoDate,
  planDay,
  toLocal,
} from "@nevile/core";
import {
  addresses,
  and,
  asc,
  bookings,
  businessMembers,
  conversations,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  or,
  snowContracts,
  user,
  visits,
} from "@nevile/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  acceptRequest,
  cancelByBusiness,
  endRequest,
  isOngoing,
  loadBookingParts,
  markDone,
  markFixed,
  scheduleFix,
} from "../bookings/flows.ts";
import { dayRange, loadSchedule } from "../bookings/schedule.ts";
import {
  addressLines,
  BUSINESS_STATUS_LABELS,
  businessBookingView,
  checkoutWorkMinutes,
  firstName,
} from "../bookings/views.ts";
import type { Context } from "../context.ts";
import { LISTING_EDITOR_ROLES } from "../listing-state.ts";
import {
  acceptSeries,
  cancelVisit,
  endSeries,
  moveOptions,
  moveVisit,
} from "../ongoing/recurring.ts";
import {
  acceptContract,
  endContract,
  markCleared,
  reorderRoute,
  seasonLabel,
  snowRoute,
} from "../ongoing/snow.ts";
import { ongoingDetails, seriesBadge } from "../ongoing/views.ts";
import { businessMemberProcedure, router } from "../trpc.ts";
import { bookingDeps } from "./bookings.ts";

const member = businessMemberProcedure();
const editor = businessMemberProcedure(LISTING_EDITOR_ROLES);
const bookingIdInput = z.object({ bookingId: z.uuid() });
/** A job: a one-off booking, or one visit of a recurring series or snow contract. */
const jobInput = bookingIdInput.extend({ visitId: z.uuid().optional() });
const reasonInput = z.string().trim().min(3, { message: "Tell the customer why" }).max(500);
const isoDate = z
  .string()
  .refine((value) => parseIsoDate(value) !== null, { message: "Pick a day" });

type MemberCtx = Context & {
  business: { id: string; timezone: string };
  membership: { id: string; role: string };
};

type JobRef = { bookingId: string; visitId?: string };

/**
 * Jobs starting in [from, to): one-off bookings and requests by their window, and each
 * visit of a recurring series or snow contract on its own (SPEC §21).
 */
async function jobsInRange(ctx: MemberCtx, from: Date, to: Date): Promise<JobRef[]> {
  const single = await ctx.db
    .select({ id: bookings.id, startsAt: bookings.requestedStartsAt })
    .from(bookings)
    .where(
      and(
        eq(bookings.businessId, ctx.business.id),
        gte(bookings.requestedStartsAt, from),
        lt(bookings.requestedStartsAt, to),
        // A snow contract sign-up has no time of its own: it waits in "Needs you".
        or(
          eq(bookings.kind, "one_off"),
          and(eq(bookings.kind, "recurring"), eq(bookings.status, "requested")),
        ),
      ),
    );
  const ongoing = await ctx.db
    .select({ bookingId: visits.bookingId, visitId: visits.id, startsAt: visits.startsAt })
    .from(visits)
    .innerJoin(bookings, eq(bookings.id, visits.bookingId))
    .where(
      and(
        eq(visits.businessId, ctx.business.id),
        gte(visits.startsAt, from),
        lt(visits.startsAt, to),
        inArray(bookings.kind, ["recurring", "snow_contract"]),
      ),
    );
  return [
    ...single.map((row) => ({ ref: { bookingId: row.id }, at: row.startsAt?.getTime() ?? 0 })),
    ...ongoing.map((row) => ({
      ref: { bookingId: row.bookingId, visitId: row.visitId },
      at: row.startsAt.getTime(),
    })),
  ]
    .sort((a, b) => a.at - b.at)
    .map((row) => row.ref);
}

async function memberNames(ctx: MemberCtx): Promise<Map<string, string>> {
  const members = await ctx.db
    .select({ id: businessMembers.id, name: user.name })
    .from(businessMembers)
    .innerJoin(user, eq(user.id, businessMembers.userId))
    .where(eq(businessMembers.businessId, ctx.business.id));
  return new Map(members.map((row) => [row.id, row.name]));
}

/** The calendar view of jobs (crew only see the ones assigned to them). */
async function viewsFor(ctx: MemberCtx, refs: JobRef[]) {
  const now = ctx.now();
  const names = await memberNames(ctx);
  const bookingIds = [...new Set(refs.map((ref) => ref.bookingId))];
  const minutes = await checkoutWorkMinutes(ctx.db, bookingIds);
  const chats =
    ctx.membership.role === "crew" || bookingIds.length === 0
      ? new Map<string, string>()
      : new Map(
          (
            await ctx.db
              .select({ id: conversations.id, bookingId: conversations.bookingId })
              .from(conversations)
              .where(inArray(conversations.bookingId, bookingIds))
          ).map((row) => [row.bookingId ?? "", row.id]),
        );
  const result = [];
  for (const ref of refs) {
    const parts = await loadBookingParts(ctx.db, ref.bookingId, { visitId: ref.visitId });
    if (!parts || parts.booking.businessId !== ctx.business.id) continue;
    const assigneeId = parts.visit?.assignedMemberId ?? null;
    if (ctx.membership.role === "crew" && assigneeId !== ctx.membership.id) continue;
    const [address] = await ctx.db
      .select()
      .from(addresses)
      .where(eq(addresses.id, parts.booking.addressId));
    const [customer] = await ctx.db
      .select({ name: user.name, email: user.email, phoneNumber: user.phoneNumber })
      .from(user)
      .where(eq(user.id, parts.booking.customerId));
    if (!address || !customer) continue;
    // A snow contract sign-up is for the season, not a time window.
    const [contract] =
      parts.booking.kind === "snow_contract" && !parts.visit
        ? await ctx.db
            .select({ start: snowContracts.seasonStart, end: snowContracts.seasonEnd })
            .from(snowContracts)
            .where(eq(snowContracts.bookingId, parts.booking.id))
        : [];
    result.push(
      businessBookingView(
        parts,
        {
          address,
          customer,
          assignee: assigneeId
            ? { id: assigneeId, name: names.get(assigneeId) ?? "Crew member" }
            : null,
          workMinutes:
            parts.visit?.workMinutes ?? minutes.get(ref.bookingId) ?? parts.service.durationMinutes,
          conversationId: chats.get(ref.bookingId) ?? null,
          series: await seriesBadge(ctx.db, parts.booking, parts.visit),
          windowLabel: contract ? `Season: ${seasonLabel(contract.start, contract.end)}` : null,
        },
        now,
      ),
    );
  }
  return result;
}

/** Owners and managers act on any job; crew only on jobs assigned to them. */
async function assertCanWork(ctx: MemberCtx, bookingId: string, visitId?: string): Promise<void> {
  if (ctx.membership.role !== "crew") return;
  const [visit] = await ctx.db
    .select({ assignedMemberId: visits.assignedMemberId })
    .from(visits)
    .where(and(eq(visits.bookingId, bookingId), visitId ? eq(visits.id, visitId) : undefined))
    .orderBy(asc(visits.sequence))
    .limit(1);
  if (visit?.assignedMemberId !== ctx.membership.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This job isn't assigned to you." });
  }
}

/** The business's booking; visit-level actions on an ongoing booking must name the visit. */
async function bookingOf(
  ctx: MemberCtx,
  input: { bookingId: string; visitId?: string },
  scope: "visit" | "booking" = "visit",
) {
  const [booking] = await ctx.db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.businessId, ctx.business.id)));
  if (!booking) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
  if (scope === "visit" && isOngoing(booking) && booking.status !== "requested" && !input.visitId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the visit." });
  }
  return booking;
}

/** Business mode: the calendar and every action on a booking (SPEC §19). */
export const businessBookingsRouter = router({
  /** A week (or less) by day and window: capacity, jobs and requests. */
  calendar: member
    .input(z.object({ from: isoDate, days: z.number().int().min(1).max(14).default(7) }))
    .query(async ({ ctx, input }) => {
      const now = ctx.now();
      const first = parseIsoDate(input.from);
      if (!first) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a day." });
      const { from, to } = dayRange(first, input.days, ctx.business.timezone);
      const schedule = await loadSchedule(ctx.db, ctx.business, first, input.days, now);
      const jobs = await viewsFor(ctx, await jobsInRange(ctx, from, to));
      const live = (status: BookingState) =>
        ![
          "cancelled_by_customer",
          "cancelled_by_business",
          "declined",
          "expired",
          "refunded",
        ].includes(status);
      const days = Array.from({ length: input.days }, (_, offset) => {
        const date = { ...first, day: first.day + offset };
        const day = toLocal(dayRange(date, 1, ctx.business.timezone).from, ctx.business.timezone);
        const calendarDate = { year: day.year, month: day.month, day: day.day };
        const plan = planDay({ date: calendarDate, ...schedule, timeZone: ctx.business.timezone });
        return {
          date: formatIsoDate(calendarDate),
          weekday: day.weekday,
          windows: plan.map((slot) => ({
            startMinute: slot.startMinute,
            label: formatArrivalWindow(slot),
            capacityMinutes: slot.capacityMinutes,
            freeMinutes: slot.freeMinutes,
            jobs: jobs.filter(
              (job) =>
                live(job.status) && job.window.startsAt.getTime() === slot.startsAt.getTime(),
            ),
          })),
        };
      });
      const members = await ctx.db
        .select({ id: businessMembers.id, name: user.name, role: businessMembers.role })
        .from(businessMembers)
        .innerJoin(user, eq(user.id, businessMembers.userId))
        .where(
          and(eq(businessMembers.businessId, ctx.business.id), eq(businessMembers.active, true)),
        )
        .orderBy(asc(user.name));
      return {
        days,
        members,
        // Jobs whose window no longer matches the business's windows still show here.
        other: jobs.filter(
          (job) =>
            live(job.status) &&
            !days.some((day) =>
              day.windows.some((window) => window.jobs.some((listed) => listed.key === job.key)),
            ),
        ),
        canManage: ctx.membership.role !== "crew",
      };
    }),

  /** Requests waiting for an answer, and jobs that need attention (all dates). */
  inbox: member.query(async ({ ctx }) => {
    const requested = await ctx.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.businessId, ctx.business.id), eq(bookings.status, "requested")))
      .orderBy(asc(bookings.requestedStartsAt));
    const problems = await ctx.db
      .select({ bookingId: visits.bookingId, visitId: visits.id })
      .from(visits)
      .where(
        and(
          eq(visits.businessId, ctx.business.id),
          inArray(visits.status, ["disputed", "fix_scheduled"]),
        ),
      )
      .orderBy(asc(visits.startsAt));
    // Unassigned upcoming work: each one-off job, and only the next visit of a series.
    const unassigned = await ctx.db
      .select({ bookingId: visits.bookingId, visitId: visits.id, kind: bookings.kind })
      .from(visits)
      .innerJoin(bookings, eq(bookings.id, visits.bookingId))
      .where(
        and(
          eq(visits.businessId, ctx.business.id),
          eq(visits.status, "confirmed"),
          isNull(visits.assignedMemberId),
          gte(visits.endsAt, ctx.now()),
        ),
      )
      .orderBy(asc(visits.startsAt));
    const seen = new Set<string>();
    const nextUnassigned = unassigned.filter((row) => {
      if (row.kind === "one_off") return true;
      if (seen.has(row.bookingId)) return false;
      seen.add(row.bookingId);
      return true;
    });
    return {
      requests: await viewsFor(
        ctx,
        requested.map((row) => ({ bookingId: row.id })),
      ),
      problems: await viewsFor(ctx, problems),
      unassigned: (await viewsFor(ctx, nextUnassigned)).filter((view) => view.assignee === null),
    };
  }),

  get: member.input(jobInput).query(async ({ ctx, input }) => {
    const [view] = await viewsFor(ctx, [input]);
    if (!view) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
    return view;
  }),

  /**
   * A recurring series or snow contract with all its visits (SPEC §21). Crew see their
   * own visits.
   */
  ongoing: member.input(bookingIdInput).query(async ({ ctx, input }) => {
    const now = ctx.now();
    const parts = await loadBookingParts(ctx.db, input.bookingId);
    if (!parts || parts.booking.businessId !== ctx.business.id || !isOngoing(parts.booking)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
    }
    const { booking } = parts;
    const crew = ctx.membership.role === "crew";
    const ongoing = await ongoingDetails(ctx.db, parts, "business", now, await memberNames(ctx));
    if (!ongoing) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
    const visible = crew
      ? ongoing.visits.filter((visit) => visit.assignee?.id === ctx.membership.id)
      : ongoing.visits;
    if (crew && visible.length === 0) {
      throw new TRPCError({ code: "FORBIDDEN", message: "This job isn't assigned to you." });
    }
    const [address] = await ctx.db
      .select()
      .from(addresses)
      .where(eq(addresses.id, booking.addressId));
    const [customer] = await ctx.db
      .select({ name: user.name, email: user.email, phoneNumber: user.phoneNumber })
      .from(user)
      .where(eq(user.id, booking.customerId));
    const [chat] = crew
      ? []
      : await ctx.db
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.bookingId, booking.id));
    // Contact details once a visit has been paid (SPEC §7).
    const paid = ongoing.visits.some((visit) =>
      ["charged", "partly_refunded"].includes(visit.charge.state),
    );
    const open =
      booking.status === "requested" && (booking.approvalExpiresAt?.getTime() ?? 0) > now.getTime();
    return {
      id: booking.id,
      kind: booking.kind,
      title: booking.title,
      status: booking.status,
      statusLabel:
        ongoing.paused && booking.status === "confirmed"
          ? "Paused"
          : BUSINESS_STATUS_LABELS[booking.status],
      customer: {
        firstName: firstName(customer?.name),
        email: paid ? contactEmail(customer?.email) : null,
        phone: paid ? (customer?.phoneNumber ?? null) : null,
      },
      address: address ? addressLines(address) : [],
      notes: booking.customerNotes,
      approvalExpiresAt: booking.status === "requested" ? booking.approvalExpiresAt : null,
      cancellationReason: booking.cancellationReason,
      conversationId: chat?.id ?? null,
      ongoing: { ...ongoing, visits: visible, nextVisit: crew ? null : ongoing.nextVisit },
      actions: {
        accept: open && !crew,
        decline: open && !crew,
        end: booking.status === "confirmed" && !crew,
      },
    };
  }),

  /** Open windows a recurring visit could move to (SPEC §21). */
  moveOptions: editor
    .input(
      jobInput.extend({
        visitId: z.uuid(),
        from: isoDate.optional(),
        days: z.number().int().min(1).max(14).default(7),
      }),
    )
    .query(async ({ ctx, input }) => {
      const parts = await loadBookingParts(ctx.db, input.bookingId, { visitId: input.visitId });
      if (!parts?.visit || parts.booking.businessId !== ctx.business.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
      }
      return moveOptions(ctx.db, parts.business, parts.visit, input, ctx.now());
    }),

  /** Accepts a request; a recurring series reports dates that no longer fit (skipped). */
  accept: editor.input(bookingIdInput).mutation(async ({ ctx, input }) => {
    const booking = await bookingOf(ctx, input, "booking");
    if (booking.kind === "snow_contract") {
      await acceptContract(
        { ...bookingDeps(ctx), storage: ctx.storage },
        ctx.user.id,
        ctx.business.id,
        input.bookingId,
      );
      return { ok: true as const, visits: 0, skipped: [] as string[] };
    }
    if (booking.kind === "recurring") {
      const outcome = await acceptSeries(
        bookingDeps(ctx),
        ctx.user.id,
        ctx.business.id,
        input.bookingId,
      );
      return { ok: true as const, ...outcome };
    }
    await acceptRequest(bookingDeps(ctx), ctx.user.id, ctx.business.id, input.bookingId);
    return { ok: true as const, visits: 1, skipped: [] as string[] };
  }),

  decline: editor.input(bookingIdInput).mutation(async ({ ctx, input }) => {
    await endRequest(bookingDeps(ctx), input.bookingId, {
      by: "business",
      actorUserId: ctx.user.id,
      businessId: ctx.business.id,
    });
    return { ok: true as const };
  }),

  /**
   * Assigns (or unassigns, with null) the crew member for a job. With a visit: that visit
   * only. Without: every live visit of the booking, and the series' default for any later.
   */
  assign: editor
    .input(jobInput.extend({ memberId: z.uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      if (input.memberId) {
        const [row] = await ctx.db
          .select({ id: businessMembers.id })
          .from(businessMembers)
          .where(
            and(
              eq(businessMembers.id, input.memberId),
              eq(businessMembers.businessId, ctx.business.id),
              eq(businessMembers.active, true),
            ),
          );
        if (!row)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Pick someone on your team." });
      }
      const updated = await ctx.db
        .update(visits)
        .set({ assignedMemberId: input.memberId })
        .where(
          and(
            eq(visits.bookingId, input.bookingId),
            eq(visits.businessId, ctx.business.id),
            input.visitId ? eq(visits.id, input.visitId) : undefined,
            inArray(visits.status, [
              "confirmed",
              "completed_pending_confirmation",
              "disputed",
              "fix_scheduled",
            ]),
          ),
        )
        .returning({ id: visits.id });
      if (updated.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This job can't be assigned." });
      }
      if (!input.visitId) {
        await ctx.db
          .update(bookings)
          .set({ assignedMemberId: input.memberId })
          .where(and(eq(bookings.id, input.bookingId), eq(bookings.businessId, ctx.business.id)));
      }
      return { ok: true as const };
    }),

  markDone: member.input(jobInput).mutation(async ({ ctx, input }) => {
    await bookingOf(ctx, input);
    await assertCanWork(ctx, input.bookingId, input.visitId);
    await markDone(bookingDeps(ctx), ctx.user.id, ctx.business.id, input.bookingId, input.visitId);
    return { ok: true as const };
  }),

  /** Cancels a one-off job, or one visit of a series (full refund either way). */
  cancel: editor
    .input(jobInput.extend({ reason: reasonInput }))
    .mutation(async ({ ctx, input }) => {
      const booking = await bookingOf(ctx, input);
      if (booking.kind === "recurring" && input.visitId) {
        await cancelVisit(
          bookingDeps(ctx),
          ctx.user.id,
          ctx.business.id,
          input.bookingId,
          input.visitId,
          input.reason,
        );
        return { ok: true as const };
      }
      if (isOngoing(booking)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "End the series instead." });
      }
      await cancelByBusiness(bookingDeps(ctx), input.bookingId, {
        actorUserId: ctx.user.id,
        businessId: ctx.business.id,
        reason: input.reason,
      });
      return { ok: true as const };
    }),

  /** Moves one upcoming visit of a series to another window or day (SPEC §21). */
  moveVisit: editor
    .input(
      jobInput.extend({
        visitId: z.uuid(),
        date: isoDate,
        windowStart: z.number().int().min(0).max(1439),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await moveVisit(
        bookingDeps(ctx),
        ctx.user.id,
        ctx.business.id,
        input.bookingId,
        input.visitId,
        input,
      );
      return { ok: true as const };
    }),

  /**
   * Ends a recurring series (upcoming visits refunded in full) or a snow contract (the
   * rest of a season price refunded day by day) early (SPEC §21).
   */
  endOngoing: editor
    .input(bookingIdInput.extend({ reason: reasonInput }))
    .mutation(async ({ ctx, input }) => {
      const booking = await bookingOf(ctx, input, "booking");
      const how = {
        by: "business" as const,
        actorUserId: ctx.user.id,
        businessId: ctx.business.id,
        reason: input.reason,
      };
      if (booking.kind === "snow_contract") {
        const { refundCents } = await endContract(bookingDeps(ctx), input.bookingId, how);
        return { refundCents };
      }
      if (booking.kind !== "recurring") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cancel the job instead." });
      }
      const { refundCents } = await endSeries(bookingDeps(ctx), input.bookingId, how);
      return { refundCents };
    }),

  /** Active snow contracts in route order (SPEC §21). */
  snowRoute: member.query(({ ctx }) => snowRoute(ctx.db, ctx.business, ctx.now())),

  /** Puts the snow route in a new order: every active contract, each once. */
  reorderRoute: editor
    .input(z.object({ bookingIds: z.array(z.uuid()).max(500) }))
    .mutation(async ({ ctx, input }) => {
      await reorderRoute(ctx.db, ctx.business.id, input.bookingIds);
      return { ok: true as const };
    }),

  /** Marks an address on the snow route Cleared, with optional photos (SPEC §21). */
  markCleared: member
    .input(bookingIdInput.extend({ photoIds: z.array(z.uuid()).max(3).default([]) }))
    .mutation(({ ctx, input }) =>
      markCleared(
        bookingDeps(ctx),
        { userId: ctx.user.id, memberId: ctx.membership.id },
        ctx.business.id,
        input.bookingId,
        input.photoIds,
      ),
    ),

  scheduleFix: member.input(jobInput).mutation(async ({ ctx, input }) => {
    await bookingOf(ctx, input);
    await assertCanWork(ctx, input.bookingId, input.visitId);
    await scheduleFix(bookingDeps(ctx), ctx.business.id, input.bookingId, input.visitId);
    return { ok: true as const };
  }),

  markFixed: member.input(jobInput).mutation(async ({ ctx, input }) => {
    await bookingOf(ctx, input);
    await assertCanWork(ctx, input.bookingId, input.visitId);
    await markFixed(bookingDeps(ctx), ctx.business.id, input.bookingId, input.visitId);
    return { ok: true as const };
  }),
});
