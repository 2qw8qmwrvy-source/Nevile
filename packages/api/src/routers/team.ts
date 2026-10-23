import { createHash, randomBytes } from "node:crypto";
import { contactEmail } from "@nevile/auth";
import {
  arrivalWindowsSchema,
  BOOKING_NOTICE_LIMITS,
  bookingNoticeSchema,
  CREW_INVITE_DAYS,
  DEFAULT_ARRIVAL_WINDOWS,
  emailSchema,
  formatArrivalWindow,
  MS_PER_DAY,
  workingHoursSchema,
} from "@nevile/core";
import {
  and,
  arrivalWindows,
  asc,
  availabilityRules,
  businesses,
  businessInvites,
  businessMembers,
  eq,
  gt,
  inArray,
  isNull,
  notInArray,
  timeOff,
  user,
  visits,
} from "@nevile/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { businessEmails } from "../bookings/emails.ts";
import { addDefaultHours, FREED_VISIT_STATES, windowsFor } from "../bookings/schedule.ts";
import { LISTING_EDITOR_ROLES } from "../listing-state.ts";
import { sendAll } from "../notify.ts";
import { businessMemberProcedure, publicProcedure, router, verifiedProcedure } from "../trpc.ts";

const member = businessMemberProcedure();
const editor = businessMemberProcedure(LISTING_EDITOR_ROLES);
const memberIdInput = z.object({ memberId: z.uuid() });

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const ROLE_LABELS = { owner: "Owner", manager: "Manager", crew: "Crew" } as const;

/** Owners and managers edit anyone's hours; crew edit their own. */
function assertCanEditMember(membership: { id: string; role: string }, memberId: string): void {
  if (membership.role === "crew" && membership.id !== memberId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You can only change your own hours." });
  }
}

/** The team, their hours and time off; invites; booking windows (SPEC §19). */
export const teamRouter = router({
  members: member.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ member: businessMembers, name: user.name, email: user.email })
      .from(businessMembers)
      .innerJoin(user, eq(user.id, businessMembers.userId))
      .where(eq(businessMembers.businessId, ctx.business.id))
      .orderBy(asc(user.name));
    const ids = rows.map((row) => row.member.id);
    const hours = ids.length
      ? await ctx.db
          .select()
          .from(availabilityRules)
          .where(inArray(availabilityRules.memberId, ids))
      : [];
    const offs = ids.length
      ? await ctx.db
          .select()
          .from(timeOff)
          .where(and(inArray(timeOff.memberId, ids), gt(timeOff.endsAt, ctx.now())))
          .orderBy(asc(timeOff.startsAt))
      : [];
    return rows.map(({ member: row, name, email }) => ({
      id: row.id,
      name,
      email: ctx.membership.role === "crew" ? null : contactEmail(email),
      role: row.role,
      roleLabel: ROLE_LABELS[row.role],
      active: row.active,
      isYou: row.id === ctx.membership.id,
      hours: hours
        .filter((rule) => rule.memberId === row.id)
        .map(({ weekday, startMinute, endMinute }) => ({ weekday, startMinute, endMinute }))
        .sort((a, b) => a.weekday - b.weekday),
      timeOff: offs
        .filter((block) => block.memberId === row.id)
        .map(({ id, startsAt, endsAt, reason }) => ({ id, startsAt, endsAt, reason })),
    }));
  }),

  /** Replaces a member's weekly hours (an empty list means not bookable). */
  setHours: member
    .input(memberIdInput.extend({ hours: workingHoursSchema }))
    .mutation(async ({ ctx, input }) => {
      assertCanEditMember(ctx.membership, input.memberId);
      await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .select({ id: businessMembers.id })
          .from(businessMembers)
          .where(
            and(
              eq(businessMembers.id, input.memberId),
              eq(businessMembers.businessId, ctx.business.id),
            ),
          );
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Team member not found." });
        await tx.delete(availabilityRules).where(eq(availabilityRules.memberId, input.memberId));
        if (input.hours.length > 0) {
          await tx
            .insert(availabilityRules)
            .values(input.hours.map((hours) => ({ memberId: input.memberId, ...hours })));
        }
      });
      return { ok: true as const };
    }),

  addTimeOff: member
    .input(
      memberIdInput
        .extend({
          startsAt: z.date(),
          endsAt: z.date(),
          reason: z.string().trim().max(120).optional(),
        })
        .refine((value) => value.endsAt > value.startsAt, {
          message: "The end must be after the start",
        }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCanEditMember(ctx.membership, input.memberId);
      const [row] = await ctx.db
        .select({ id: businessMembers.id })
        .from(businessMembers)
        .where(
          and(
            eq(businessMembers.id, input.memberId),
            eq(businessMembers.businessId, ctx.business.id),
          ),
        );
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Team member not found." });
      if (input.endsAt.getTime() - input.startsAt.getTime() > 366 * MS_PER_DAY) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Time off can be up to a year at once.",
        });
      }
      await ctx.db.insert(timeOff).values({
        memberId: input.memberId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        reason: input.reason || null,
      });
      return { ok: true as const };
    }),

  removeTimeOff: member
    .input(z.object({ timeOffId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ memberId: timeOff.memberId })
        .from(timeOff)
        .innerJoin(businessMembers, eq(businessMembers.id, timeOff.memberId))
        .where(
          and(eq(timeOff.id, input.timeOffId), eq(businessMembers.businessId, ctx.business.id)),
        );
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Time off not found." });
      assertCanEditMember(ctx.membership, row.memberId);
      await ctx.db.delete(timeOff).where(eq(timeOff.id, input.timeOffId));
      return { ok: true as const };
    }),

  /** Removes someone from the team; their upcoming jobs go back to unassigned. */
  deactivate: editor.input(memberIdInput).mutation(async ({ ctx, input }) => {
    await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(businessMembers)
        .where(
          and(
            eq(businessMembers.id, input.memberId),
            eq(businessMembers.businessId, ctx.business.id),
          ),
        );
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Team member not found." });
      if (row.role === "owner")
        throw new TRPCError({ code: "FORBIDDEN", message: "The owner can't be removed." });
      if (row.role === "manager" && ctx.membership.role !== "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can remove a manager." });
      }
      await tx
        .update(visits)
        .set({ assignedMemberId: null })
        .where(
          and(
            eq(visits.assignedMemberId, row.id),
            gt(visits.startsAt, ctx.now()),
            notInArray(visits.status, [...FREED_VISIT_STATES]),
          ),
        );
      await tx.update(businessMembers).set({ active: false }).where(eq(businessMembers.id, row.id));
    });
    return { ok: true as const };
  }),

  invites: editor.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(businessInvites)
      .where(
        and(
          eq(businessInvites.businessId, ctx.business.id),
          isNull(businessInvites.acceptedAt),
          isNull(businessInvites.revokedAt),
          gt(businessInvites.expiresAt, ctx.now()),
        ),
      )
      .orderBy(asc(businessInvites.createdAt));
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      roleLabel: ROLE_LABELS[row.role],
      expiresAt: row.expiresAt,
    }));
  }),

  /** Emails an invite link (SPEC §19). Owners invite managers or crew; managers invite crew. */
  invite: editor
    .input(z.object({ email: emailSchema, role: z.enum(["manager", "crew"]) }))
    .mutation(async ({ ctx, input }) => {
      if (input.role === "manager" && ctx.membership.role !== "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can invite a manager." });
      }
      const email = input.email.toLowerCase();
      const existing = await ctx.db
        .select({ id: businessMembers.id })
        .from(businessMembers)
        .innerJoin(user, eq(user.id, businessMembers.userId))
        .where(
          and(
            eq(businessMembers.businessId, ctx.business.id),
            eq(businessMembers.active, true),
            eq(user.email, email),
          ),
        );
      if (existing.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "That person is already on your team." });
      }
      const token = randomBytes(32).toString("base64url");
      await ctx.db.transaction(async (tx) => {
        // A new invite to the same address replaces the old one.
        await tx
          .update(businessInvites)
          .set({ revokedAt: ctx.now() })
          .where(
            and(
              eq(businessInvites.businessId, ctx.business.id),
              eq(businessInvites.email, email),
              isNull(businessInvites.acceptedAt),
              isNull(businessInvites.revokedAt),
            ),
          );
        await tx.insert(businessInvites).values({
          businessId: ctx.business.id,
          invitedByUserId: ctx.user.id,
          email,
          role: input.role,
          tokenHash: hashToken(token),
          expiresAt: new Date(ctx.now().getTime() + CREW_INVITE_DAYS * MS_PER_DAY),
        });
      });
      await sendAll(
        ctx.email,
        businessEmails.invite(
          email,
          ctx.config.siteUrl,
          ctx.business.name,
          ROLE_LABELS[input.role].toLowerCase(),
          token,
        ),
      );
      return { ok: true as const };
    }),

  revokeInvite: editor.input(z.object({ inviteId: z.uuid() })).mutation(async ({ ctx, input }) => {
    await ctx.db
      .update(businessInvites)
      .set({ revokedAt: ctx.now() })
      .where(
        and(
          eq(businessInvites.id, input.inviteId),
          eq(businessInvites.businessId, ctx.business.id),
        ),
      );
    return { ok: true as const };
  }),

  /** What an invite link is for, before signing in (no personal details). */
  inviteInfo: publicProcedure
    .input(z.object({ token: z.string().min(20).max(100) }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ invite: businessInvites, businessName: businesses.name })
        .from(businessInvites)
        .innerJoin(businesses, eq(businesses.id, businessInvites.businessId))
        .where(eq(businessInvites.tokenHash, hashToken(input.token)));
      const usable =
        row &&
        !row.invite.acceptedAt &&
        !row.invite.revokedAt &&
        row.invite.expiresAt.getTime() > ctx.now().getTime();
      if (!row || !usable) return { valid: false as const };
      return {
        valid: true as const,
        businessName: row.businessName,
        roleLabel: ROLE_LABELS[row.invite.role],
      };
    }),

  /** Joins the team with an invite sent to the caller's confirmed email address. */
  acceptInvite: verifiedProcedure
    .input(z.object({ token: z.string().min(20).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const email = ctx.user.emailVerified ? contactEmail(ctx.user.email)?.toLowerCase() : null;
      return ctx.db.transaction(async (tx) => {
        const [invite] = await tx
          .select()
          .from(businessInvites)
          .where(eq(businessInvites.tokenHash, hashToken(input.token)))
          .for("update");
        if (
          !invite ||
          invite.acceptedAt ||
          invite.revokedAt ||
          invite.expiresAt.getTime() <= ctx.now().getTime()
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This invite has expired or was already used.",
          });
        }
        if (!email || invite.email?.toLowerCase() !== email) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `This invite is for ${invite.email}. Sign in with that confirmed email address to accept it.`,
          });
        }
        const [existing] = await tx
          .select()
          .from(businessMembers)
          .where(
            and(
              eq(businessMembers.businessId, invite.businessId),
              eq(businessMembers.userId, ctx.user.id),
            ),
          );
        let memberId: string;
        if (existing?.active) {
          throw new TRPCError({ code: "CONFLICT", message: "You're already on this team." });
        } else if (existing) {
          await tx
            .update(businessMembers)
            .set({ active: true, role: invite.role })
            .where(eq(businessMembers.id, existing.id));
          memberId = existing.id;
        } else {
          const [created] = await tx
            .insert(businessMembers)
            .values({ businessId: invite.businessId, userId: ctx.user.id, role: invite.role })
            .returning({ id: businessMembers.id });
          memberId = created?.id ?? "";
        }
        await addDefaultHours(tx, memberId);
        await tx
          .update(businessInvites)
          .set({ acceptedAt: ctx.now(), acceptedByUserId: ctx.user.id })
          .where(eq(businessInvites.id, invite.id));
        return { businessId: invite.businessId };
      });
    }),

  /** Arrival windows and how soon / how far ahead customers can book. */
  settings: member.query(async ({ ctx }) => {
    const windows = await windowsFor(ctx.db, ctx.business.id);
    return {
      windows: windows.map((window) => ({ ...window, label: formatArrivalWindow(window) })),
      usingDefaultWindows: JSON.stringify(windows) === JSON.stringify(DEFAULT_ARRIVAL_WINDOWS),
      minNoticeDays: ctx.business.minNoticeDays,
      maxDaysAhead: ctx.business.maxDaysAhead,
      limits: BOOKING_NOTICE_LIMITS,
      timezone: ctx.business.timezone,
    };
  }),

  updateSettings: editor
    .input(bookingNoticeSchema.extend({ windows: arrivalWindowsSchema }))
    .mutation(async ({ ctx, input }) => {
      if (input.minNoticeDays >= input.maxDaysAhead) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The latest day must be after the earliest.",
        });
      }
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(businesses)
          .set({ minNoticeDays: input.minNoticeDays, maxDaysAhead: input.maxDaysAhead })
          .where(eq(businesses.id, ctx.business.id));
        await tx.delete(arrivalWindows).where(eq(arrivalWindows.businessId, ctx.business.id));
        await tx
          .insert(arrivalWindows)
          .values(input.windows.map((window) => ({ businessId: ctx.business.id, ...window })));
      });
      return { ok: true as const };
    }),
});
