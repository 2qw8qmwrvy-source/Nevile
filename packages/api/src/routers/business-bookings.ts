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
  eq,
  gte,
  inArray,
  lt,
  or,
  user,
  visits,
} from "@nevile/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  acceptRequest,
  cancelByBusiness,
  endRequest,
  loadBookingParts,
  markDone,
  markFixed,
  scheduleFix,
} from "../bookings/flows.ts";
import { dayRange, loadSchedule } from "../bookings/schedule.ts";
import { businessBookingView, checkoutWorkMinutes } from "../bookings/views.ts";
import type { Context } from "../context.ts";
import { LISTING_EDITOR_ROLES } from "../listing-state.ts";
import { businessMemberProcedure, router } from "../trpc.ts";
import { bookingDeps } from "./bookings.ts";

const member = businessMemberProcedure();
const editor = businessMemberProcedure(LISTING_EDITOR_ROLES);
const bookingIdInput = z.object({ bookingId: z.uuid() });
const isoDate = z
  .string()
  .refine((value) => parseIsoDate(value) !== null, { message: "Pick a day" });

type MemberCtx = Context & {
  business: { id: string; timezone: string };
  membership: { id: string; role: string };
};

/** Bookings starting in [from, to) (requests by their requested window). */
async function bookingIdsInRange(ctx: MemberCtx, from: Date, to: Date): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.businessId, ctx.business.id),
        gte(bookings.requestedStartsAt, from),
        lt(bookings.requestedStartsAt, to),
      ),
    )
    .orderBy(asc(bookings.requestedStartsAt));
  return rows.map((row) => row.id);
}

/** The calendar view of bookings (crew only see the jobs assigned to them). */
async function viewsFor(ctx: MemberCtx, bookingIds: string[]) {
  const now = ctx.now();
  const members = await ctx.db
    .select({ id: businessMembers.id, name: user.name })
    .from(businessMembers)
    .innerJoin(user, eq(user.id, businessMembers.userId))
    .where(eq(businessMembers.businessId, ctx.business.id));
  const names = new Map(members.map((row) => [row.id, row.name]));
  const minutes = await checkoutWorkMinutes(ctx.db, bookingIds);
  const result = [];
  for (const id of bookingIds) {
    const parts = await loadBookingParts(ctx.db, id);
    if (!parts) continue;
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
    result.push(
      businessBookingView(
        parts,
        {
          address,
          customer,
          assignee: assigneeId
            ? { id: assigneeId, name: names.get(assigneeId) ?? "Crew member" }
            : null,
          workMinutes: parts.visit?.workMinutes ?? minutes.get(id) ?? parts.service.durationMinutes,
        },
        now,
      ),
    );
  }
  return result;
}

/** Owners and managers act on any job; crew only on jobs assigned to them. */
async function assertCanWork(ctx: MemberCtx, bookingId: string): Promise<void> {
  if (ctx.membership.role !== "crew") return;
  const [visit] = await ctx.db
    .select({ assignedMemberId: visits.assignedMemberId })
    .from(visits)
    .where(eq(visits.bookingId, bookingId));
  if (visit?.assignedMemberId !== ctx.membership.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This job isn't assigned to you." });
  }
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
      const jobs = await viewsFor(ctx, await bookingIdsInRange(ctx, from, to));
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
              day.windows.some((window) => window.jobs.some((listed) => listed.id === job.id)),
            ),
        ),
        canManage: ctx.membership.role !== "crew",
      };
    }),

  /** Requests waiting for an answer, and jobs that need attention (all dates). */
  inbox: member.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.businessId, ctx.business.id),
          or(
            eq(bookings.status, "requested"),
            eq(bookings.status, "disputed"),
            eq(bookings.status, "fix_scheduled"),
          ),
        ),
      )
      .orderBy(asc(bookings.requestedStartsAt));
    const unassigned = await ctx.db
      .select({ id: visits.bookingId })
      .from(visits)
      .where(
        and(
          eq(visits.businessId, ctx.business.id),
          eq(visits.status, "confirmed"),
          gte(visits.endsAt, ctx.now()),
        ),
      );
    const views = await viewsFor(
      ctx,
      rows.map((row) => row.id),
    );
    const upcoming = await viewsFor(
      ctx,
      unassigned.map((row) => row.id),
    );
    return {
      requests: views.filter((view) => view.status === "requested"),
      problems: views.filter(
        (view) => view.status === "disputed" || view.status === "fix_scheduled",
      ),
      unassigned: upcoming.filter((view) => view.assignee === null),
    };
  }),

  get: member.input(bookingIdInput).query(async ({ ctx, input }) => {
    const [view] = await viewsFor(ctx, [input.bookingId]);
    const parts = await loadBookingParts(ctx.db, input.bookingId);
    if (!view || parts?.booking.businessId !== ctx.business.id) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
    }
    return view;
  }),

  accept: editor.input(bookingIdInput).mutation(async ({ ctx, input }) => {
    await acceptRequest(bookingDeps(ctx), ctx.user.id, ctx.business.id, input.bookingId);
    return { ok: true as const };
  }),

  decline: editor.input(bookingIdInput).mutation(async ({ ctx, input }) => {
    await endRequest(bookingDeps(ctx), input.bookingId, {
      by: "business",
      actorUserId: ctx.user.id,
      businessId: ctx.business.id,
    });
    return { ok: true as const };
  }),

  /** Assigns (or unassigns, with null) the crew member for a job. */
  assign: editor
    .input(bookingIdInput.extend({ memberId: z.uuid().nullable() }))
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
      await ctx.db
        .update(bookings)
        .set({ assignedMemberId: input.memberId })
        .where(and(eq(bookings.id, input.bookingId), eq(bookings.businessId, ctx.business.id)));
      return { ok: true as const };
    }),

  markDone: member.input(bookingIdInput).mutation(async ({ ctx, input }) => {
    await assertCanWork(ctx, input.bookingId);
    await markDone(bookingDeps(ctx), ctx.user.id, ctx.business.id, input.bookingId);
    return { ok: true as const };
  }),

  cancel: editor
    .input(
      bookingIdInput.extend({
        reason: z.string().trim().min(3, { message: "Tell the customer why" }).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await cancelByBusiness(bookingDeps(ctx), input.bookingId, {
        actorUserId: ctx.user.id,
        businessId: ctx.business.id,
        reason: input.reason,
      });
      return { ok: true as const };
    }),

  scheduleFix: member.input(bookingIdInput).mutation(async ({ ctx, input }) => {
    await assertCanWork(ctx, input.bookingId);
    await scheduleFix(bookingDeps(ctx), ctx.business.id, input.bookingId);
    return { ok: true as const };
  }),

  markFixed: member.input(bookingIdInput).mutation(async ({ ctx, input }) => {
    await assertCanWork(ctx, input.bookingId);
    await markFixed(bookingDeps(ctx), ctx.business.id, input.bookingId);
    return { ok: true as const };
  }),
});
