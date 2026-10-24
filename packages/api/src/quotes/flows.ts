import type { EmailMessage } from "@nevile/auth";
import {
  calculateCharge,
  canTakeBookings,
  formatDurationMinutes,
  haversineKm,
  isCategorySlug,
  normalizePostalCode,
  QUOTE_REQUEST_LIMITS,
  type QuoteReplyInput,
  type QuoteRequestInput,
  type QuoteTiming,
  quoteDeclineSchema,
  quoteExpiresAt,
  quoteReplyDeadline,
  quoteReplySchema,
  quoteRequestInputSchema,
  quoteTimingLabel,
} from "@nevile/core";
import {
  and,
  asc,
  type Business,
  businesses,
  businessMembers,
  conversations,
  type DbExecutor,
  desc,
  eq,
  gte,
  inArray,
  lte,
  ne,
  type Quote,
  type QuoteRequest,
  type QuoteRequestCloseReason,
  type QuoteRequestGroup,
  quoteRequestGroups,
  quoteRequests,
  quotes,
  serviceAreas,
  serviceCategories,
  services,
  user,
} from "@nevile/db";
import { TRPCError } from "@trpc/server";
import { businessTeamEmails, customerEmail } from "../bookings/emails.ts";
import type { BookingDeps } from "../bookings/flows.ts";
import { firstName } from "../bookings/views.ts";
import { openConversation } from "../chat/flows.ts";
import { businessTeamUserIds, NOTIFICATION_TYPES, notify } from "../inbox.ts";
import { sendAll } from "../notify.ts";
import { attachPhotos, photosFor } from "../photos.ts";
import { lookupPostalArea } from "../postal.ts";
import { type QuoteMailFacts, quoteEmails } from "./emails.ts";

type Mail = EmailMessage[];

const dayLabel = (date: Date, timeZone = "America/Halifax") =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

/** "B3H · Halifax (South End)": what a business sees of the job's location. */
export function areaLabel(code: string, placeName: string | null | undefined): string {
  return placeName ? `${code} · ${placeName}` : code;
}

// ---------------------------------------------------------------------------------------
// Who can be asked
// ---------------------------------------------------------------------------------------

export type QuoteTarget = {
  business: Business;
  serviceId: string;
  /** Why it can't be asked, or null when it can. */
  problem: string | null;
};

/**
 * Checks each business can be asked for a quote in a category at a postal code (SPEC §20):
 * published, taking bookings and quote requests, with an active service in the category
 * and a service area covering the job's postal code area; not the customer's own.
 */
export async function quoteTargets(
  db: DbExecutor,
  input: {
    customerId: string | null;
    categorySlug: string;
    postalCode: string;
    businessIds: string[];
  },
  now: Date,
): Promise<{
  categoryId: string;
  categoryName: string;
  area: { code: string; placeName: string };
  targets: QuoteTarget[];
}> {
  if (!isCategorySlug(input.categorySlug)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a service." });
  }
  const [category] = await db
    .select()
    .from(serviceCategories)
    .where(and(eq(serviceCategories.slug, input.categorySlug), eq(serviceCategories.active, true)));
  if (!category) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a service." });
  const lookup = await lookupPostalArea(db, input.postalCode);
  if (lookup.kind !== "found") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        lookup.kind === "outside"
          ? "Nevile is only in Nova Scotia for now."
          : "We can't place that postal code yet. Check it, or try a nearby one.",
    });
  }
  const area = lookup.area;
  const rows =
    input.businessIds.length === 0
      ? []
      : await db
          .select({ business: businesses, area: serviceAreas })
          .from(businesses)
          .leftJoin(serviceAreas, eq(serviceAreas.businessId, businesses.id))
          .where(inArray(businesses.id, input.businessIds));
  const offered = input.businessIds.length
    ? await db
        .select({
          id: services.id,
          businessId: services.businessId,
          pricingType: services.pricingType,
        })
        .from(services)
        .where(
          and(
            inArray(services.businessId, input.businessIds),
            eq(services.categoryId, category.id),
            eq(services.active, true),
          ),
        )
        .orderBy(asc(services.createdAt))
    : [];
  const ownBusinesses = input.customerId
    ? (
        await db
          .select({ businessId: businessMembers.businessId })
          .from(businessMembers)
          .where(
            and(eq(businessMembers.userId, input.customerId), eq(businessMembers.active, true)),
          )
      ).map((row) => row.businessId)
    : [];

  const targets: QuoteTarget[] = [];
  for (const id of input.businessIds) {
    const row = rows.find((candidate) => candidate.business.id === id);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "That pro isn't on Nevile." });
    const { business } = row;
    const matching = offered.filter((service) => service.businessId === id);
    const service =
      matching.find((candidate) => candidate.pricingType === "quote") ?? matching[0] ?? null;
    let problem: string | null = null;
    if (!business.publishedAt || business.suspendedAt)
      problem = `${business.name} isn't on Nevile right now.`;
    else if (ownBusinesses.includes(id)) problem = "You can't ask your own business for a quote.";
    else if (!business.acceptsQuoteRequests)
      problem = `${business.name} isn't taking quote requests.`;
    else if (
      !canTakeBookings({
        payoutsEnabled: business.payoutsEnabled,
        payoutSetupDueAt: business.payoutSetupDueAt,
        now,
      })
    )
      problem = `${business.name} isn't taking new work right now.`;
    else if (!service) problem = `${business.name} doesn't offer ${category.name.toLowerCase()}.`;
    else if (!row.area || haversineKm(area.point, row.area) > row.area.radiusKm)
      problem = `${business.name} doesn't serve ${area.code}.`;
    targets.push({ business, serviceId: service?.id ?? "", problem });
  }
  return {
    categoryId: category.id,
    categoryName: category.name,
    area: { code: area.requested, placeName: area.placeName },
    targets,
  };
}

// ---------------------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------------------

/** Sends one request to up to 3 pros (SPEC §20). Returns the request's id. */
export async function requestQuotes(
  deps: BookingDeps,
  customer: { id: string; name: string | null },
  raw: QuoteRequestInput,
): Promise<{ groupId: string }> {
  const input = quoteRequestInputSchema.parse(raw);
  const now = deps.now();
  const { categoryId, categoryName, area, targets } = await quoteTargets(
    deps.db,
    { customerId: customer.id, ...input },
    now,
  );
  const blocked = targets.find((target) => target.problem);
  if (blocked?.problem) throw new TRPCError({ code: "BAD_REQUEST", message: blocked.problem });
  const postalCode = normalizePostalCode(input.postalCode) ?? input.postalCode;
  const replyBy = quoteReplyDeadline(now);
  const mail: Mail = [];

  const groupId = await deps.db.transaction(async (tx) => {
    // Serialise this customer's requests so the open-request limit holds.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, customer.id)).for("update");
    const open = await tx
      .selectDistinct({ groupId: quoteRequests.groupId })
      .from(quoteRequests)
      .where(
        and(
          eq(quoteRequests.customerId, customer.id),
          inArray(quoteRequests.status, ["open", "quoted"]),
        ),
      );
    if (open.length >= QUOTE_REQUEST_LIMITS.maxOpenRequests) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `You have ${QUOTE_REQUEST_LIMITS.maxOpenRequests} open quote requests. Book or close one before asking again.`,
      });
    }
    const [group] = await tx
      .insert(quoteRequestGroups)
      .values({
        customerId: customer.id,
        categoryId,
        details: input.details,
        postalCode,
        postalArea: area.code,
        timing: input.timing,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!group) throw new Error("quote request insert returned nothing");
    await attachPhotos(tx, customer.id, input.photoIds, { quoteRequestGroupId: group.id });
    for (const target of targets) {
      const [request] = await tx
        .insert(quoteRequests)
        .values({
          groupId: group.id,
          customerId: customer.id,
          businessId: target.business.id,
          serviceId: target.serviceId,
          expiresAt: replyBy,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: quoteRequests.id });
      if (!request) throw new Error("quote request insert returned nothing");
      await openConversation(tx, {
        customerId: customer.id,
        businessId: target.business.id,
        quoteRequestId: request.id,
      });
      const facts: QuoteMailFacts = {
        businessName: target.business.name,
        categoryName,
        siteUrl: deps.config.siteUrl,
        groupId: group.id,
        requestId: request.id,
      };
      await notify(
        tx,
        await businessTeamUserIds(tx, target.business.id),
        NOTIFICATION_TYPES.quoteRequested,
        {
          text: `${firstName(customer.name)} asked for a quote: ${categoryName} near ${area.code}`,
          path: `/business/quotes/${request.id}`,
        },
      );
      mail.push(
        ...quoteEmails.newRequestForBusiness(await businessTeamEmails(tx, target.business.id), {
          ...facts,
          customerFirstName: firstName(customer.name),
          area: areaLabel(area.code, area.placeName),
          replyBy: dayLabel(replyBy, target.business.timezone),
        }),
      );
    }
    return group.id;
  });
  await sendAll(deps.email, mail);
  return { groupId };
}

// ---------------------------------------------------------------------------------------
// Replying (business)
// ---------------------------------------------------------------------------------------

async function lockedRequest(tx: DbExecutor, requestId: string, businessId: string) {
  const [request] = await tx
    .select()
    .from(quoteRequests)
    .where(and(eq(quoteRequests.id, requestId), eq(quoteRequests.businessId, businessId)))
    .for("update");
  if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Quote request not found." });
  const [group] = await tx
    .select()
    .from(quoteRequestGroups)
    .where(eq(quoteRequestGroups.id, request.groupId));
  const [category] = group
    ? await tx.select().from(serviceCategories).where(eq(serviceCategories.id, group.categoryId))
    : [];
  const [business] = await tx.select().from(businesses).where(eq(businesses.id, businessId));
  if (!group || !category || !business) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Quote request not found." });
  }
  return { request, group, category, business };
}

async function withdrawPendingQuotes(tx: DbExecutor, requestId: string, now: Date) {
  await tx
    .update(quotes)
    .set({ status: "withdrawn", respondedAt: now, updatedAt: now })
    .where(and(eq(quotes.quoteRequestId, requestId), eq(quotes.status, "pending")));
}

/** Sends (or revises) the business's quote: one price, a duration and a note. */
export async function sendQuote(
  deps: BookingDeps,
  actorUserId: string,
  businessId: string,
  requestId: string,
  raw: QuoteReplyInput,
): Promise<void> {
  const input = quoteReplySchema.parse(raw);
  const now = deps.now();
  const mail: Mail = [];
  await deps.db.transaction(async (tx) => {
    const { request, group, category, business } = await lockedRequest(tx, requestId, businessId);
    const replyable =
      (request.status === "open" && request.expiresAt.getTime() > now.getTime()) ||
      request.status === "quoted";
    if (!replyable) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This request is closed, so it can't get a quote any more.",
      });
    }
    const revised = request.status === "quoted";
    await withdrawPendingQuotes(tx, request.id, now);
    const expiresAt = quoteExpiresAt(now);
    await tx.insert(quotes).values({
      quoteRequestId: request.id,
      kind: request.kind,
      createdByUserId: actorUserId,
      priceCents: input.priceCents,
      durationMinutes: input.durationMinutes,
      message: input.note || null,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    await tx
      .update(quoteRequests)
      .set({
        status: "quoted",
        expiresAt,
        respondedAt: request.respondedAt ?? now,
        updatedAt: now,
      })
      .where(eq(quoteRequests.id, request.id));
    const facts: QuoteMailFacts = {
      businessName: business.name,
      categoryName: category.name,
      siteUrl: deps.config.siteUrl,
      groupId: group.id,
      requestId: request.id,
    };
    await notify(tx, [request.customerId], NOTIFICATION_TYPES.quoteReceived, {
      text: `${business.name} ${revised ? "updated their quote" : "sent you a quote"}: ${category.name}`,
      path: `/quotes/${group.id}`,
    });
    mail.push(
      ...quoteEmails.quoteForCustomer(await customerEmail(tx, request.customerId), {
        ...facts,
        priceCents: input.priceCents,
        durationMinutes: input.durationMinutes,
        revised,
      }),
    );
  });
  await sendAll(deps.email, mail);
}

/** Tells the customer when every pro on a request closed without ever quoting. */
async function noQuotesMail(
  tx: DbExecutor,
  deps: BookingDeps,
  group: QuoteRequestGroup,
  categoryName: string,
): Promise<Mail> {
  const copies = await tx
    .select({
      id: quoteRequests.id,
      status: quoteRequests.status,
      closeReason: quoteRequests.closeReason,
    })
    .from(quoteRequests)
    .where(eq(quoteRequests.groupId, group.id));
  const stillOpen = copies.some((copy) => ["open", "quoted", "accepted"].includes(copy.status));
  if (stillOpen || copies.some((copy) => copy.closeReason === "customer_closed")) return [];
  const quoted = await tx
    .select({ id: quotes.id })
    .from(quotes)
    .where(
      inArray(
        quotes.quoteRequestId,
        copies.map((copy) => copy.id),
      ),
    )
    .limit(1);
  if (quoted.length > 0) return [];
  await notify(tx, [group.customerId], NOTIFICATION_TYPES.noQuotes, {
    text: `No quotes came in for your ${categoryName.toLowerCase()} request`,
    path: `/quotes/${group.id}`,
  });
  return quoteEmails.noQuotesForCustomer(await customerEmail(tx, group.customerId), {
    categoryName,
    siteUrl: deps.config.siteUrl,
    groupId: group.id,
    requestId: "",
  });
}

/** The business turns the request down with a short reason. */
export async function declineRequest(
  deps: BookingDeps,
  businessId: string,
  requestId: string,
  raw: { reason: string },
): Promise<void> {
  const { reason } = quoteDeclineSchema.parse(raw);
  const now = deps.now();
  const mail: Mail = [];
  await deps.db.transaction(async (tx) => {
    const { request, group, category, business } = await lockedRequest(tx, requestId, businessId);
    if (request.status !== "open" && request.status !== "quoted") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This request is already closed." });
    }
    await withdrawPendingQuotes(tx, request.id, now);
    await tx
      .update(quoteRequests)
      .set({
        status: "declined",
        declineReason: reason,
        closedAt: now,
        respondedAt: request.respondedAt ?? now,
        updatedAt: now,
      })
      .where(eq(quoteRequests.id, request.id));
    await notify(tx, [request.customerId], NOTIFICATION_TYPES.quoteDeclined, {
      text: `${business.name} can't quote your ${category.name.toLowerCase()} job`,
      path: `/quotes/${group.id}`,
    });
    mail.push(
      ...quoteEmails.declinedForCustomer(await customerEmail(tx, request.customerId), {
        businessName: business.name,
        categoryName: category.name,
        siteUrl: deps.config.siteUrl,
        groupId: group.id,
        requestId: request.id,
        reason,
      }),
    );
    mail.push(...(await noQuotesMail(tx, deps, group, category.name)));
  });
  await sendAll(deps.email, mail);
}

// ---------------------------------------------------------------------------------------
// Closing (customer) and accepting (on payment)
// ---------------------------------------------------------------------------------------

/** Closes the other pros' copies of a request; returns the emails to send them. */
async function closeCopies(
  tx: DbExecutor,
  deps: BookingDeps,
  group: QuoteRequestGroup,
  categoryName: string,
  reason: Extract<QuoteRequestCloseReason, "customer_closed" | "chose_another">,
  now: Date,
  exceptRequestId: string | null,
): Promise<Mail> {
  const copies = await tx
    .select({ request: quoteRequests, business: businesses })
    .from(quoteRequests)
    .innerJoin(businesses, eq(businesses.id, quoteRequests.businessId))
    .where(
      and(
        eq(quoteRequests.groupId, group.id),
        inArray(quoteRequests.status, ["open", "quoted"]),
        exceptRequestId ? ne(quoteRequests.id, exceptRequestId) : undefined,
      ),
    )
    .for("update", { of: quoteRequests });
  const mail: Mail = [];
  for (const { request, business } of copies) {
    await withdrawPendingQuotes(tx, request.id, now);
    await tx
      .update(quoteRequests)
      .set({ status: "cancelled", closeReason: reason, closedAt: now, updatedAt: now })
      .where(eq(quoteRequests.id, request.id));
    await notify(tx, await businessTeamUserIds(tx, business.id), NOTIFICATION_TYPES.requestClosed, {
      text:
        reason === "chose_another"
          ? `The customer booked another pro: ${categoryName}`
          : `The customer closed their request: ${categoryName}`,
      path: `/business/quotes/${request.id}`,
    });
    mail.push(
      ...quoteEmails.closedForBusiness(await businessTeamEmails(tx, business.id), {
        businessName: business.name,
        categoryName,
        siteUrl: deps.config.siteUrl,
        groupId: group.id,
        requestId: request.id,
        reason,
      }),
    );
  }
  return mail;
}

async function lockedGroup(tx: DbExecutor, groupId: string) {
  const [group] = await tx
    .select()
    .from(quoteRequestGroups)
    .where(eq(quoteRequestGroups.id, groupId))
    .for("update");
  const [category] = group
    ? await tx.select().from(serviceCategories).where(eq(serviceCategories.id, group.categoryId))
    : [];
  return group && category ? { group, category } : null;
}

/** The customer closes their request with every pro still on it. */
export async function closeRequestGroup(
  deps: BookingDeps,
  customerId: string,
  groupId: string,
): Promise<void> {
  const now = deps.now();
  const mail = await deps.db.transaction(async (tx) => {
    const locked = await lockedGroup(tx, groupId);
    if (!locked || locked.group.customerId !== customerId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Quote request not found." });
    }
    return closeCopies(tx, deps, locked.group, locked.category.name, "customer_closed", now, null);
  });
  await sendAll(deps.email, mail);
}

/**
 * Accepting a quote when its booking is paid (inside the checkout's transaction): the quote
 * and its request are accepted, the other pros' copies close, and the chat follows the
 * booking. Returns null (and changes nothing) when the quote is no longer the pending one,
 * e.g. the business revised it while the customer paid.
 */
export async function acceptQuoteInTx(
  tx: DbExecutor,
  deps: BookingDeps,
  quoteId: string,
  bookingId: string,
  now: Date,
): Promise<Mail | null> {
  const [quote] = await tx.select().from(quotes).where(eq(quotes.id, quoteId)).for("update");
  if (quote?.status !== "pending") return null;
  const [request] = await tx
    .select()
    .from(quoteRequests)
    .where(eq(quoteRequests.id, quote.quoteRequestId))
    .for("update");
  if (request?.status !== "quoted") return null;
  const locked = await lockedGroup(tx, request.groupId);
  if (!locked) return null;
  await tx
    .update(quotes)
    .set({ status: "accepted", respondedAt: now, updatedAt: now })
    .where(eq(quotes.id, quote.id));
  await tx
    .update(quoteRequests)
    .set({ status: "accepted", closedAt: now, updatedAt: now })
    .where(eq(quoteRequests.id, request.id));
  await tx
    .update(conversations)
    .set({ bookingId, updatedAt: now })
    .where(eq(conversations.quoteRequestId, request.id));
  return closeCopies(
    tx,
    deps,
    locked.group,
    locked.category.name,
    "chose_another",
    now,
    request.id,
  );
}

/** The pending quote a customer may book, with everything the booking needs. */
export async function bookableQuote(
  db: DbExecutor,
  customerId: string,
  quoteId: string,
  now: Date,
) {
  const [row] = await db
    .select({
      quote: quotes,
      request: quoteRequests,
      group: quoteRequestGroups,
      category: serviceCategories,
    })
    .from(quotes)
    .innerJoin(quoteRequests, eq(quoteRequests.id, quotes.quoteRequestId))
    .innerJoin(quoteRequestGroups, eq(quoteRequestGroups.id, quoteRequests.groupId))
    .innerJoin(serviceCategories, eq(serviceCategories.id, quoteRequestGroups.categoryId))
    .where(eq(quotes.id, quoteId));
  if (!row || row.request.customerId !== customerId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Quote not found." });
  }
  if (row.quote.status !== "pending" || row.request.status !== "quoted") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This quote can't be booked any more. Check your quotes for the latest one.",
    });
  }
  if (row.quote.expiresAt.getTime() <= now.getTime()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This quote has expired." });
  }
  return row;
}

// ---------------------------------------------------------------------------------------
// Timers (scheduled job)
// ---------------------------------------------------------------------------------------

/** Closes unanswered requests after 3 days and expires quotes after 7 (SPEC §20). */
export async function expireQuoteRequests(deps: BookingDeps): Promise<number> {
  const now = deps.now();
  const due = await deps.db
    .select({ id: quoteRequests.id, groupId: quoteRequests.groupId })
    .from(quoteRequests)
    .where(
      and(inArray(quoteRequests.status, ["open", "quoted"]), lte(quoteRequests.expiresAt, now)),
    )
    .limit(500);
  let closed = 0;
  for (const { id, groupId } of due) {
    const mail = await deps.db.transaction(async (tx): Promise<Mail> => {
      const locked = await lockedGroup(tx, groupId);
      const [request] = await tx
        .select()
        .from(quoteRequests)
        .where(eq(quoteRequests.id, id))
        .for("update");
      if (!locked || !request) return [];
      if (!["open", "quoted"].includes(request.status) || request.expiresAt > now) return [];
      const quoted = request.status === "quoted";
      if (quoted) {
        await tx
          .update(quotes)
          .set({ status: "expired", updatedAt: now })
          .where(and(eq(quotes.quoteRequestId, request.id), eq(quotes.status, "pending")));
      }
      await tx
        .update(quoteRequests)
        .set({
          status: "expired",
          closeReason: quoted ? "quote_expired" : "no_reply",
          closedAt: now,
          updatedAt: now,
        })
        .where(eq(quoteRequests.id, request.id));
      closed += 1;
      const [business] = await tx
        .select({ name: businesses.name })
        .from(businesses)
        .where(eq(businesses.id, request.businessId));
      if (quoted) {
        await notify(tx, [request.customerId], NOTIFICATION_TYPES.quoteExpired, {
          text: `Your quote from ${business?.name ?? "a pro"} expired`,
          path: `/quotes/${locked.group.id}`,
        });
      }
      await notify(
        tx,
        await businessTeamUserIds(tx, request.businessId),
        NOTIFICATION_TYPES.requestClosed,
        {
          text: quoted
            ? `Your quote expired: ${locked.category.name}`
            : `A quote request closed without a reply: ${locked.category.name}`,
          path: `/business/quotes/${request.id}`,
        },
      );
      return noQuotesMail(tx, deps, locked.group, locked.category.name);
    });
    await sendAll(deps.email, mail);
  }
  return closed;
}

// ---------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------

const CUSTOMER_LABELS = {
  open: "Waiting for a quote",
  quoted: "Quote received",
  accepted: "Booked",
  declined: "Declined",
  expired: "Closed",
  cancelled: "Closed",
} as const;

const BUSINESS_LABELS = {
  open: "Needs a reply",
  quoted: "Quote sent",
  accepted: "Booked",
  declined: "You declined",
  expired: "Closed",
  cancelled: "Closed",
} as const;

const CLOSE_LABELS: Record<QuoteRequestCloseReason, { customer: string; business: string }> = {
  customer_closed: { customer: "Closed", business: "Closed by the customer" },
  chose_another: { customer: "You chose another pro", business: "Customer chose another pro" },
  no_reply: { customer: "No reply", business: "Closed: no reply in 3 days" },
  quote_expired: { customer: "Quote expired", business: "Quote expired" },
};

function statusLabel(request: QuoteRequest, side: "customer" | "business"): string {
  if (request.closeReason) return CLOSE_LABELS[request.closeReason][side];
  return (side === "customer" ? CUSTOMER_LABELS : BUSINESS_LABELS)[request.status];
}

function quoteView(
  quote: Quote,
  business: Pick<Business, "province" | "taxRegistered">,
  now: Date,
) {
  const charge = calculateCharge({
    priceCents: quote.priceCents,
    province: business.province,
    businessTaxRegistered: business.taxRegistered,
    at: now,
  });
  return {
    id: quote.id,
    status: quote.status,
    priceCents: quote.priceCents,
    durationMinutes: quote.durationMinutes ?? 60,
    duration: formatDurationMinutes(quote.durationMinutes ?? 60),
    note: quote.message ?? "",
    expiresAt: quote.expiresAt,
    sentAt: quote.createdAt,
    total: {
      serviceFeeCents: charge.serviceFeeCents,
      taxCents: charge.taxCents,
      totalCents: charge.totalCents,
    },
  };
}

/** The latest quote per request (pending, accepted, or the last one sent). */
async function latestQuotes(db: DbExecutor, requestIds: string[]): Promise<Map<string, Quote>> {
  if (requestIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(quotes)
    .where(inArray(quotes.quoteRequestId, requestIds))
    .orderBy(desc(quotes.createdAt));
  const map = new Map<string, Quote>();
  for (const row of rows) if (!map.has(row.quoteRequestId)) map.set(row.quoteRequestId, row);
  return map;
}

async function conversationIds(db: DbExecutor, requestIds: string[]) {
  if (requestIds.length === 0) return new Map<string, { id: string; bookingId: string | null }>();
  const rows = await db
    .select({
      id: conversations.id,
      requestId: conversations.quoteRequestId,
      bookingId: conversations.bookingId,
    })
    .from(conversations)
    .where(inArray(conversations.quoteRequestId, requestIds));
  return new Map(
    rows.map((row) => [row.requestId ?? "", { id: row.id, bookingId: row.bookingId }]),
  );
}

/** A customer's requests, newest first, with each pro's status and quote. */
export async function customerQuoteGroups(
  db: DbExecutor,
  customerId: string,
  now: Date,
  groupId?: string,
) {
  const groups = await db
    .select({ group: quoteRequestGroups, category: serviceCategories })
    .from(quoteRequestGroups)
    .innerJoin(serviceCategories, eq(serviceCategories.id, quoteRequestGroups.categoryId))
    .where(
      and(
        eq(quoteRequestGroups.customerId, customerId),
        groupId ? eq(quoteRequestGroups.id, groupId) : undefined,
      ),
    )
    .orderBy(desc(quoteRequestGroups.createdAt))
    .limit(50);
  const ids = groups.map((row) => row.group.id);
  if (ids.length === 0) return [];
  const copies = await db
    .select({ request: quoteRequests, business: businesses })
    .from(quoteRequests)
    .innerJoin(businesses, eq(businesses.id, quoteRequests.businessId))
    .where(inArray(quoteRequests.groupId, ids))
    .orderBy(asc(quoteRequests.createdAt));
  const requestIds = copies.map((copy) => copy.request.id);
  const latest = await latestQuotes(db, requestIds);
  const chats = await conversationIds(db, requestIds);
  const photos = await photosFor(db, { groupIds: ids });
  return groups.map(({ group, category }) => {
    const pros = copies
      .filter((copy) => copy.request.groupId === group.id)
      .map(({ request, business }) => {
        const quote = latest.get(request.id);
        const pending = quote?.status === "pending" && request.status === "quoted";
        return {
          requestId: request.id,
          business: { id: business.id, name: business.name, slug: business.slug },
          status: request.status,
          statusLabel: statusLabel(request, "customer"),
          replyBy: request.status === "open" ? request.expiresAt : null,
          declineReason: request.declineReason,
          quote:
            quote && (pending || request.status === "accepted")
              ? quoteView(quote, business, now)
              : null,
          canBook: pending && (quote?.expiresAt.getTime() ?? 0) > now.getTime(),
          conversationId: chats.get(request.id)?.id ?? null,
          bookingId: chats.get(request.id)?.bookingId ?? null,
        };
      });
    const open = pros.some((pro) => pro.status === "open" || pro.status === "quoted");
    const booked = pros.find((pro) => pro.status === "accepted");
    const quoteCount = pros.filter((pro) => pro.canBook).length;
    return {
      id: group.id,
      category: { slug: category.slug, name: category.name },
      details: group.details,
      timing: group.timing as QuoteTiming,
      timingLabel: quoteTimingLabel(group.timing as QuoteTiming),
      postalCode: group.postalCode,
      createdAt: group.createdAt,
      photos: photos.get(group.id) ?? [],
      pros,
      summary: booked
        ? `Booked with ${booked.business.name}`
        : quoteCount > 0
          ? `${quoteCount} ${quoteCount === 1 ? "quote" : "quotes"} to compare`
          : open
            ? "Waiting for quotes"
            : "Closed",
      canClose: open,
    };
  });
}

export type CustomerQuoteGroup = Awaited<ReturnType<typeof customerQuoteGroups>>[number];

/** A business's quote requests: needing a reply, quoted, and recently closed. */
export async function businessQuoteRequests(
  db: DbExecutor,
  businessId: string,
  now: Date,
  requestId?: string,
) {
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      request: quoteRequests,
      group: quoteRequestGroups,
      category: serviceCategories,
      customerName: user.name,
    })
    .from(quoteRequests)
    .innerJoin(quoteRequestGroups, eq(quoteRequestGroups.id, quoteRequests.groupId))
    .innerJoin(serviceCategories, eq(serviceCategories.id, quoteRequestGroups.categoryId))
    .innerJoin(user, eq(user.id, quoteRequests.customerId))
    .where(
      and(
        eq(quoteRequests.businessId, businessId),
        requestId ? eq(quoteRequests.id, requestId) : gte(quoteRequests.updatedAt, since),
      ),
    )
    .orderBy(asc(quoteRequests.expiresAt))
    .limit(200);
  const requestIds = rows.map((row) => row.request.id);
  const latest = await latestQuotes(db, requestIds);
  const chats = await conversationIds(db, requestIds);
  const photos = await photosFor(db, { groupIds: [...new Set(rows.map((row) => row.group.id))] });
  const areaNames = new Map<string, string>();
  for (const row of rows) {
    if (!areaNames.has(row.group.postalArea)) {
      const lookup = await lookupPostalArea(db, row.group.postalArea);
      areaNames.set(row.group.postalArea, lookup.kind === "found" ? lookup.area.placeName : "");
    }
  }
  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  return rows.map(({ request, group, category, customerName }) => {
    const quote = latest.get(request.id);
    return {
      id: request.id,
      status: request.status,
      statusLabel: statusLabel(request, "business"),
      category: { slug: category.slug, name: category.name },
      customer: { firstName: firstName(customerName) },
      details: group.details,
      timingLabel: quoteTimingLabel(group.timing as QuoteTiming),
      area: areaLabel(group.postalArea, areaNames.get(group.postalArea)),
      photos: photos.get(group.id) ?? [],
      requestedAt: request.createdAt,
      replyBy: request.status === "open" ? request.expiresAt : null,
      declineReason: request.declineReason,
      quote:
        quote && business && ["pending", "accepted"].includes(quote.status)
          ? quoteView(quote, business, now)
          : null,
      canReply:
        (request.status === "open" && request.expiresAt.getTime() > now.getTime()) ||
        request.status === "quoted",
      conversationId: chats.get(request.id)?.id ?? null,
      bookingId: chats.get(request.id)?.bookingId ?? null,
    };
  });
}

export type BusinessQuoteRequest = Awaited<ReturnType<typeof businessQuoteRequests>>[number];
