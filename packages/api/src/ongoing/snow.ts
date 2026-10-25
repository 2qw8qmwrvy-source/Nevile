/**
 * Snow contracts (SPEC §21). A business lists a seasonal contract (trigger, season, price
 * per visit or for the season, spots); a customer signs up with a plain-language agreement
 * and the business accepts within 24 hours. After a storm the business works down its snow
 * route, marking each address Cleared; visits are confirmed like any job, and per-visit
 * prices are charged once confirmed. Season prices are split into months.
 */
import type { EmailAttachment, EmailMessage } from "@nevile/auth";
import {
  APPROVAL_EXPIRY_HOURS,
  addCalendarDays,
  COMPLETION_CONFIRMATION_HOURS,
  calculateCharge,
  canTakeBookings,
  formatCad,
  fromLocal,
  instalmentChargeAt,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  parseIsoDate,
  periodReleaseAt,
  type SeasonPayment,
  seasonEndActions,
  seasonPaymentFor,
  seasonPeriods,
  type snowContractListingSchema,
  type snowSignupSchema,
  splitEvenly,
} from "@nevile/core";
import {
  addresses,
  agreements,
  and,
  asc,
  type Booking,
  type Business,
  bookings,
  businesses,
  businessMembers,
  type ContractPeriod,
  contractPeriods,
  count,
  type DbExecutor,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  max,
  type Payment,
  payments,
  privatePhotos,
  type Service,
  type SnowContract,
  serviceAreas,
  serviceCategories,
  serviceContractTerms,
  services,
  snowContracts,
  sql,
  user,
  visitPhotos,
  visits,
} from "@nevile/db";
import { agreementKey, type MediaStorage } from "@nevile/storage";
import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import { businessTeamEmails, customerEmail, emailsTo, whenLabel } from "../bookings/emails.ts";
import {
  assertCanBook,
  assertTransition,
  audit,
  type BookingDeps,
  cancelByCustomer,
  lockedParts,
  pushNotifications,
  recordRefund,
  startPayoutClock,
} from "../bookings/flows.ts";
import { addressLines, firstName } from "../bookings/views.ts";
import { cardView, savedCardOf } from "../cards/flows.ts";
import { openConversation } from "../chat/flows.ts";
import { businessTeamUserIds, NOTIFICATION_TYPES, notify } from "../inbox.ts";
import { sendAll } from "../notify.ts";
import { API_ERROR_REASONS, reasonError } from "../trpc.ts";
import {
  type AgreementFacts,
  type AgreementInstalment,
  agreementSections,
  renderAgreementPdf,
} from "./agreement.ts";
import { chargeOngoing } from "./charges.ts";
import { type ContractListing, contractTermsFor, LIVE_CONTRACT_STATES } from "./contract-terms.ts";
import { dateLabel, localIsoDate } from "./recurring.ts";

type Mail = EmailMessage[];

/** What contract flows need: booking flows plus storage for the agreement PDF. */
export type ContractDeps = BookingDeps & { storage: MediaStorage };

export type SnowListingInput = z.output<typeof snowContractListingSchema>;
export type SnowSignupInput = z.output<typeof snowSignupSchema>;

/** The category snow contracts are listed in (SPEC §21). */
export const SNOW_CATEGORY_SLUG = "snow-ice-removal";

/** A second "Cleared" for the same address this soon is taken as a double tap. */
const DOUBLE_TAP_MINUTES = 30;

const LONG_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const MONTH = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

/** "November 15, 2026" for an ISO date. */
export function longDate(iso: string): string {
  const date = parseIsoDate(iso);
  return date ? LONG_DATE.format(Date.UTC(date.year, date.month - 1, date.day)) : iso;
}

/** "November 2026" for a whole month, "November 15–30, 2026" for part of one. */
export function periodLabel(start: string, end: string, days: number): string {
  const first = parseIsoDate(start);
  const last = parseIsoDate(end);
  if (!first || !last) return `${start} to ${end}`;
  const month = MONTH.format(Date.UTC(first.year, first.month - 1, 1));
  const whole =
    first.day === 1 && new Date(Date.UTC(last.year, last.month, 0)).getUTCDate() === last.day;
  if (whole) return month;
  const [name = "", year = ""] = month.split(" ");
  return days === 1 ? `${name} ${first.day}, ${year}` : `${name} ${first.day}–${last.day}, ${year}`;
}

export const seasonLabel = (start: string, end: string) => `${longDate(start)} to ${longDate(end)}`;

// ---------------------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------------------

/**
 * Lists a Snow & Ice Removal service as a seasonal contract, or (with null) stops
 * offering it. Contracts already signed keep the terms they were signed on.
 */
export async function setContractTerms(
  tx: DbExecutor,
  businessId: string,
  serviceId: string,
  terms: SnowListingInput | null,
): Promise<void> {
  const [row] = await tx
    .select({ service: services, slug: serviceCategories.slug })
    .from(services)
    .innerJoin(serviceCategories, eq(serviceCategories.id, services.categoryId))
    .where(and(eq(services.id, serviceId), eq(services.businessId, businessId)));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
  if (!terms) {
    await tx.delete(serviceContractTerms).where(eq(serviceContractTerms.serviceId, serviceId));
    return;
  }
  if (row.slug !== SNOW_CATEGORY_SLUG) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Seasonal contracts are for Snow & Ice Removal services.",
    });
  }
  if (row.service.recurrenceFrequencies.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Turn off recurring visits for this service first.",
    });
  }
  const values = {
    triggerCm: terms.triggerCm,
    seasonStart: terms.seasonStart,
    seasonEnd: terms.seasonEnd,
    pricing: terms.pricing,
    priceCents: terms.priceCents,
    seasonBilling: terms.pricing === "season" ? terms.seasonBilling : null,
    spots: terms.spots,
  };
  await tx
    .insert(serviceContractTerms)
    .values({ serviceId, ...values })
    .onConflictDoUpdate({ target: serviceContractTerms.serviceId, set: values });
}

/** A listed contract of a published business, or an error saying why not. */
async function contractService(db: DbExecutor, serviceId: string) {
  const [row] = await db
    .select({
      service: services,
      business: businesses,
      area: serviceAreas,
      terms: serviceContractTerms,
    })
    .from(services)
    .innerJoin(businesses, eq(businesses.id, services.businessId))
    .innerJoin(serviceAreas, eq(serviceAreas.businessId, businesses.id))
    .innerJoin(serviceContractTerms, eq(serviceContractTerms.serviceId, services.id))
    .where(eq(services.id, serviceId))
    .limit(1);
  if (!row?.service.active || !row.business.publishedAt || row.business.suspendedAt) {
    throw new TRPCError({ code: "NOT_FOUND", message: "That contract isn't available." });
  }
  return row;
}

// ---------------------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------------------

type Amounts = {
  priceCents: number;
  serviceFeeCents: number;
  priceTaxCents: number;
  feeTaxCents: number;
  totalCents: number;
};

export type PlannedPeriod = Amounts & {
  sequence: number;
  start: string;
  end: string;
  days: number;
  chargeDueAt: Date;
  releaseAt: Date;
};

/**
 * The months still ahead of a season price, from `from` (acceptance): the price splits
 * evenly over all the season's months, and months already over aren't charged.
 */
export function seasonPlan(input: {
  seasonStart: string;
  seasonEnd: string;
  seasonPriceCents: number;
  payment: SeasonPayment;
  from: Date;
  business: Pick<Business, "province" | "taxRegistered" | "timezone">;
}): PlannedPeriod[] {
  const all = seasonPeriods(input.seasonStart, input.seasonEnd);
  const shares = splitEvenly(input.seasonPriceCents, all.length);
  const today = localIsoDate(input.from, input.business.timezone);
  return all
    .map((period, index) => ({ period, share: shares[index] ?? 0 }))
    .filter(({ period }) => period.end >= today)
    .map(({ period, share }, index) => {
      const charge = calculateCharge({
        priceCents: share,
        province: input.business.province,
        businessTaxRegistered: input.business.taxRegistered,
        at: input.from,
      });
      const sequence = index + 1;
      return {
        sequence,
        start: period.start,
        end: period.end,
        days: period.days,
        priceCents: charge.priceCents,
        serviceFeeCents: charge.serviceFeeCents,
        priceTaxCents: charge.taxOnPriceCents,
        feeTaxCents: charge.taxOnFeeCents,
        totalCents: charge.totalCents,
        chargeDueAt: instalmentChargeAt({
          payment: input.payment,
          period: { sequence, start: period.start },
          acceptedAt: input.from,
          timeZone: input.business.timezone,
        }),
        releaseAt: periodReleaseAt(period.end, input.business.timezone),
      };
    });
}

const sumAmounts = (rows: readonly Amounts[]): Amounts =>
  rows.reduce(
    (total, row) => ({
      priceCents: total.priceCents + row.priceCents,
      serviceFeeCents: total.serviceFeeCents + row.serviceFeeCents,
      priceTaxCents: total.priceTaxCents + row.priceTaxCents,
      feeTaxCents: total.feeTaxCents + row.feeTaxCents,
      totalCents: total.totalCents + row.totalCents,
    }),
    { priceCents: 0, serviceFeeCents: 0, priceTaxCents: 0, feeTaxCents: 0, totalCents: 0 },
  );

/** "when the pro accepts" for the first instalment, "December 1" for later ones. */
function chargedLabel(period: PlannedPeriod, payment: SeasonPayment): string {
  if (payment === "upfront" || period.sequence === 1) return "when the pro accepts";
  return dateLabel(period.start).replace(/^\w+, /, "");
}

function instalmentsOf(plan: PlannedPeriod[], payment: SeasonPayment): AgreementInstalment[] {
  return plan.map((period) => ({
    label: periodLabel(period.start, period.end, period.days),
    totalCents: period.totalCents,
    charged: chargedLabel(period, payment),
  }));
}

/** What the customer pays: per visit, or the rest of the season and its instalments. */
function contractPrice(
  terms: Pick<ContractListing, "pricing" | "priceCents" | "seasonStart" | "seasonEnd">,
  payment: SeasonPayment | null,
  business: Pick<Business, "province" | "taxRegistered" | "timezone">,
  now: Date,
) {
  if (terms.pricing === "per_visit" || !payment) {
    const charge = calculateCharge({
      priceCents: terms.priceCents,
      province: business.province,
      businessTaxRegistered: business.taxRegistered,
      at: now,
    });
    return {
      amounts: {
        priceCents: charge.priceCents,
        serviceFeeCents: charge.serviceFeeCents,
        priceTaxCents: charge.taxOnPriceCents,
        feeTaxCents: charge.taxOnFeeCents,
        totalCents: charge.totalCents,
      },
      plan: [] as PlannedPeriod[],
    };
  }
  const plan = seasonPlan({
    seasonStart: terms.seasonStart,
    seasonEnd: terms.seasonEnd,
    seasonPriceCents: terms.priceCents,
    payment,
    from: now,
    business,
  });
  return { amounts: sumAmounts(plan), plan };
}

function agreementFacts(input: {
  reference: string;
  agreedAt: Date;
  business: Business;
  service: Service;
  customerName: string;
  address: string[];
  notes: string | null;
  terms: Pick<ContractListing, "triggerCm" | "seasonStart" | "seasonEnd" | "pricing">;
  seasonPriceCents: number | null;
  payment: SeasonPayment | null;
  price: ReturnType<typeof contractPrice>;
  cardLabel: string | null;
}): AgreementFacts {
  const { price } = input;
  return {
    reference: input.reference,
    agreedOn: longDate(localIsoDate(input.agreedAt, input.business.timezone)),
    businessName: input.business.name,
    customerName: input.customerName,
    addressLines: input.address,
    serviceTitle: input.service.title,
    serviceDescription: input.service.description ?? "",
    notes: input.notes,
    triggerCm: input.terms.triggerCm,
    seasonStart: longDate(input.terms.seasonStart),
    seasonEnd: longDate(input.terms.seasonEnd),
    cardLabel: input.cardLabel,
    price:
      input.terms.pricing === "season" && input.payment
        ? {
            pricing: "season",
            priceCents: price.amounts.priceCents,
            totalCents: price.amounts.totalCents,
            payment: input.payment,
            instalments: instalmentsOf(price.plan, input.payment),
          }
        : {
            pricing: "per_visit",
            priceCents: price.amounts.priceCents,
            totalCents: price.amounts.totalCents,
          },
  };
}

/** The payment plan for a season price; an error when the customer must choose and didn't. */
function paymentFor(
  terms: Pick<ContractListing, "pricing" | "seasonBilling">,
  chosen: SeasonPayment | null,
): SeasonPayment | null {
  if (terms.pricing !== "season" || !terms.seasonBilling) return null;
  const payment = seasonPaymentFor(terms.seasonBilling, chosen);
  if (!payment) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose to pay upfront or monthly." });
  }
  return payment;
}

// ---------------------------------------------------------------------------------------
// Offer and sign-up
// ---------------------------------------------------------------------------------------

/**
 * A listed contract as the customer sees it before signing up: terms, price (and
 * instalments for the chosen plan), spots left and the agreement they'll agree to.
 */
export async function contractOffer(
  deps: Pick<ContractDeps, "db" | "now" | "payments">,
  serviceId: string,
  options: { seasonPayment: SeasonPayment | null; customer: { id: string; name: string } | null },
) {
  const now = deps.now();
  const { service, business, terms } = await contractService(deps.db, serviceId);
  const listing = (await contractTermsFor(deps.db, [serviceId])).get(serviceId);
  const payment =
    terms.pricing === "season" && terms.seasonBilling
      ? (seasonPaymentFor(terms.seasonBilling, options.seasonPayment) ?? "upfront")
      : null;
  const seasonOver = localIsoDate(now, business.timezone) > terms.seasonEnd;
  const price = seasonOver ? null : contractPrice(terms, payment, business, now);
  const card = options.customer
    ? await savedCardOf(deps.db, options.customer.id, deps.payments.name)
    : null;
  return {
    service: { id: service.id, title: service.title, description: service.description ?? "" },
    business: { name: business.name, slug: business.slug },
    terms: {
      triggerCm: terms.triggerCm,
      seasonStart: terms.seasonStart,
      seasonEnd: terms.seasonEnd,
      season: seasonLabel(terms.seasonStart, terms.seasonEnd),
      pricing: terms.pricing,
      priceCents: terms.priceCents,
      seasonBilling: terms.seasonBilling,
    },
    spotsLeft: listing?.spotsLeft ?? 0,
    seasonOver,
    open:
      !seasonOver &&
      (listing?.spotsLeft ?? 0) > 0 &&
      canTakeBookings({
        payoutsEnabled: business.payoutsEnabled,
        payoutSetupDueAt: business.payoutSetupDueAt,
        now,
      }),
    seasonPayment: payment,
    price: price
      ? {
          priceCents: price.amounts.priceCents,
          serviceFeeCents: price.amounts.serviceFeeCents,
          taxCents: price.amounts.priceTaxCents + price.amounts.feeTaxCents,
          totalCents: price.amounts.totalCents,
        }
      : null,
    instalments: price && payment ? instalmentsOf(price.plan, payment) : [],
    card: card ? cardView(card) : null,
    agreement: price
      ? agreementSections(
          agreementFacts({
            reference: "given when you sign up",
            agreedAt: now,
            business,
            service,
            customerName: options.customer?.name || "You",
            address: ["The address you enter"],
            notes: null,
            terms,
            seasonPriceCents: terms.pricing === "season" ? terms.priceCents : null,
            payment,
            price,
            cardLabel: card ? cardView(card).label : null,
          }),
        )
      : [],
  };
}

/** Serialises spot counting for one contract service. */
async function lockContractSpots(tx: DbExecutor, serviceId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`contract:${serviceId}`}))`);
}

const PDF_FILENAME = "nevile-snow-agreement.pdf";

async function agreementAttachment(storage: MediaStorage, key: string): Promise<EmailAttachment[]> {
  const object = await storage.get(key).catch(() => null);
  return object
    ? [{ filename: PDF_FILENAME, contentType: "application/pdf", content: object.body }]
    : [];
}

const withAttachments = (messages: Mail, attachments: EmailAttachment[]): Mail =>
  messages.map((message) => ({ ...message, attachments }));

const bookingPath = (booking: Pick<Booking, "id">) => `/bookings/${booking.id}`;
const businessPath = (booking: Pick<Booking, "id" | "businessId">) =>
  `/business/bookings/${booking.id}?b=${booking.businessId}`;

/**
 * Signs a customer up for a listed contract (SPEC §21): checks spots, address and saved
 * card, records the agreement (PDF) they agreed to, and sends the business a request to
 * accept within 24 hours. Nothing is charged yet.
 */
export async function signUpForContract(
  deps: ContractDeps,
  customer: { id: string; name: string },
  input: SnowSignupInput,
): Promise<{ bookingId: string }> {
  const now = deps.now();
  const { service, business, area, terms } = await contractService(deps.db, input.serviceId);
  await assertCanBook(
    deps.db,
    { business, area, customerId: customer.id, now },
    input.address.postalCode,
  );
  if (localIsoDate(now, business.timezone) > terms.seasonEnd) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This season is over." });
  }
  const card = await savedCardOf(deps.db, customer.id, deps.payments.name);
  if (!card) {
    throw reasonError(
      "PRECONDITION_FAILED",
      "Add a card first: snow contracts are charged to your saved card.",
      API_ERROR_REASONS.CARD_REQUIRED,
    );
  }
  const payment = paymentFor(terms, input.seasonPayment);
  const price = contractPrice(terms, payment, business, now);
  const bookingId = crypto.randomUUID();
  const address = addressLines({ ...input.address, line2: input.address.line2 ?? null });
  const pdf = await renderAgreementPdf(
    agreementFacts({
      reference: bookingId,
      agreedAt: now,
      business,
      service,
      customerName: customer.name,
      address,
      notes: input.notes,
      terms,
      seasonPriceCents: terms.pricing === "season" ? terms.priceCents : null,
      payment,
      price,
      cardLabel: cardView(card).label,
    }),
  );
  const key = agreementKey();
  await deps.storage.put(key, pdf.bytes, "application/pdf");
  const mail: Mail = [];

  try {
    await deps.db.transaction(async (tx) => {
      await lockContractSpots(tx, service.id);
      const [mine] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.customerId, customer.id),
            eq(bookings.serviceId, service.id),
            eq(bookings.kind, "snow_contract"),
            inArray(bookings.status, [...LIVE_CONTRACT_STATES]),
          ),
        )
        .limit(1);
      if (mine) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You already have this contract, or a request for it.",
        });
      }
      const [taken] = await tx
        .select({ n: count() })
        .from(bookings)
        .where(
          and(
            eq(bookings.serviceId, service.id),
            eq(bookings.kind, "snow_contract"),
            inArray(bookings.status, [...LIVE_CONTRACT_STATES]),
          ),
        );
      if ((taken?.n ?? 0) >= terms.spots) {
        throw new TRPCError({ code: "CONFLICT", message: "No spots left on this contract." });
      }
      const [addressRow] = await tx
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
      // The contract runs from the season's first day, or from now if it has started.
      const seasonStart = parseIsoDate(terms.seasonStart);
      const endDate = parseIsoDate(terms.seasonEnd);
      if (!seasonStart || !endDate) throw new Error("contract dates are invalid");
      const firstMorning = fromLocal(seasonStart, business.timezone);
      const startsAt = firstMorning.getTime() > now.getTime() ? firstMorning : now;
      const [booking] = await tx
        .insert(bookings)
        .values({
          id: bookingId,
          customerId: customer.id,
          businessId: business.id,
          serviceId: service.id,
          addressId: addressRow?.id ?? "",
          title: service.title,
          kind: "snow_contract",
          status: "requested",
          createdAt: now,
          priceCents: price.amounts.priceCents,
          serviceFeeCents: price.amounts.serviceFeeCents,
          priceTaxCents: price.amounts.priceTaxCents,
          feeTaxCents: price.amounts.feeTaxCents,
          totalCents: price.amounts.totalCents,
          taxProvince: business.province,
          cancellationPolicy: business.cancellationPolicy,
          timezone: business.timezone,
          requestedStartsAt: startsAt,
          requestedEndsAt: fromLocal(addCalendarDays(endDate, 1), business.timezone),
          customerNotes: input.notes,
          approvalExpiresAt: new Date(now.getTime() + APPROVAL_EXPIRY_HOURS * MS_PER_HOUR),
        })
        .returning();
      if (!booking) throw new Error("booking insert returned nothing");
      await tx.insert(snowContracts).values({
        bookingId,
        triggerCm: terms.triggerCm,
        seasonStart: terms.seasonStart,
        seasonEnd: terms.seasonEnd,
        perVisitCents: terms.pricing === "per_visit" ? terms.priceCents : null,
        seasonPriceCents: terms.pricing === "season" ? terms.priceCents : null,
        seasonPayment: payment,
      });
      await tx.insert(agreements).values({
        bookingId,
        pdfStorageKey: key,
        contentSha256: pdf.sha256,
        acceptedByCustomerAt: now,
      });
      await openConversation(tx, {
        customerId: customer.id,
        businessId: business.id,
        bookingId,
      });
      await notify(
        tx,
        await businessTeamUserIds(tx, business.id),
        NOTIFICATION_TYPES.ongoingRequested,
        {
          text: `${firstName(customer.name)} signed up for ${service.title}`,
          path: businessPath(booking),
        },
      );
      await audit(tx, "contract.requested", "booking", bookingId, customer.id, {
        agreementSha256: pdf.sha256,
      });
      const attachments: EmailAttachment[] = [
        { filename: PDF_FILENAME, contentType: "application/pdf", content: pdf.bytes },
      ];
      const season = seasonLabel(terms.seasonStart, terms.seasonEnd);
      mail.push(
        ...withAttachments(
          emailsTo(
            await customerEmail(tx, customer.id),
            `Sign-up sent to ${business.name}`,
            `We've sent your snow contract sign-up to ${business.name}.\n\n${service.title}\n${season}\n\nNothing is charged now. They have 24 hours to accept; then your saved card is charged as the agreement says. Your copy of the agreement is attached.\n\n${deps.config.siteUrl}${bookingPath(booking)}`,
          ),
          attachments,
        ),
        ...withAttachments(
          emailsTo(
            await businessTeamEmails(tx, business.id),
            `Snow contract sign-up: ${service.title}`,
            `A customer signed up for your snow contract.\n\n${service.title}\n${season}\n\nAccept or decline within 24 hours: ${deps.config.siteUrl}${businessPath(booking)}\n\nThe agreement they agreed to is attached.`,
          ),
          attachments,
        ),
      );
    });
  } catch (error) {
    await deps.storage.delete(key).catch(() => undefined);
    throw error;
  }
  await sendAll(deps.email, mail);
  await pushNotifications(deps);
  return { bookingId };
}

// ---------------------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------------------

async function contractOf(db: DbExecutor, bookingId: string): Promise<SnowContract> {
  const [contract] = await db
    .select()
    .from(snowContracts)
    .where(eq(snowContracts.bookingId, bookingId));
  if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
  return contract;
}

/**
 * The business accepts a sign-up (SPEC §21): checks spots, schedules a season price's
 * months, puts the address on the snow route and charges what's due now.
 */
export async function acceptContract(
  deps: ContractDeps,
  actorUserId: string,
  businessId: string,
  bookingId: string,
): Promise<{ months: number }> {
  const now = deps.now();
  const mail: Mail = [];
  const outcome = await deps.db.transaction(async (tx) => {
    const parts = await lockedParts(tx, bookingId, businessId);
    const { booking, business } = parts;
    if (booking.kind !== "snow_contract") throw new Error("not a snow contract");
    assertTransition(parts, "approve", now);
    await lockContractSpots(tx, booking.serviceId);
    const [terms] = await tx
      .select({ spots: serviceContractTerms.spots })
      .from(serviceContractTerms)
      .where(eq(serviceContractTerms.serviceId, booking.serviceId));
    const [active] = await tx
      .select({ n: count() })
      .from(bookings)
      .where(
        and(
          eq(bookings.serviceId, booking.serviceId),
          eq(bookings.kind, "snow_contract"),
          eq(bookings.status, "confirmed"),
        ),
      );
    if (terms && (active?.n ?? 0) >= terms.spots) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This contract is full. Add spots to it, or decline.",
      });
    }
    const contract = await contractOf(tx, bookingId);
    let months = 0;
    let amounts: Amounts | null = null;
    if (contract.seasonPriceCents !== null && contract.seasonPayment) {
      const plan = seasonPlan({
        seasonStart: contract.seasonStart,
        seasonEnd: contract.seasonEnd,
        seasonPriceCents: contract.seasonPriceCents,
        payment: contract.seasonPayment,
        from: now,
        business,
      });
      if (plan.length === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "This season is over. Decline it." });
      }
      await tx.insert(contractPeriods).values(
        plan.map((period) => ({
          bookingId,
          sequence: period.sequence,
          periodStart: period.start,
          periodEnd: period.end,
          priceCents: period.priceCents,
          serviceFeeCents: period.serviceFeeCents,
          priceTaxCents: period.priceTaxCents,
          feeTaxCents: period.feeTaxCents,
          totalCents: period.totalCents,
          chargeDueAt: period.chargeDueAt,
          releaseAt: period.releaseAt,
        })),
      );
      months = plan.length;
      amounts = sumAmounts(plan);
    }
    const [last] = await tx
      .select({ position: max(snowContracts.routePosition) })
      .from(snowContracts)
      .innerJoin(bookings, eq(bookings.id, snowContracts.bookingId))
      .where(eq(bookings.businessId, businessId));
    await tx
      .update(snowContracts)
      .set({ routePosition: (last?.position ?? 0) + 1 })
      .where(eq(snowContracts.id, contract.id));
    await tx
      .update(agreements)
      .set({ acceptedByBusinessAt: now, acceptedByBusinessUserId: actorUserId })
      .where(eq(agreements.bookingId, bookingId));
    await tx
      .update(bookings)
      .set({ status: "confirmed", confirmedAt: now, approvalExpiresAt: null, ...(amounts ?? {}) })
      .where(eq(bookings.id, bookingId));
    await audit(tx, "contract.accepted", "booking", bookingId, actorUserId, { months });
    await notify(tx, [booking.customerId], NOTIFICATION_TYPES.ongoingAccepted, {
      text: `${business.name} accepted your snow contract`,
      path: bookingPath(booking),
    });
    await startPayoutClock(tx, business, now);
    const [agreement] = await tx
      .select({ key: agreements.pdfStorageKey })
      .from(agreements)
      .where(eq(agreements.bookingId, bookingId))
      .orderBy(desc(agreements.version))
      .limit(1);
    const attachments = agreement ? await agreementAttachment(deps.storage, agreement.key) : [];
    const season = seasonLabel(contract.seasonStart, contract.seasonEnd);
    mail.push(
      ...withAttachments(
        emailsTo(
          await customerEmail(tx, booking.customerId),
          `Accepted: ${booking.title} with ${business.name}`,
          `${business.name} accepted your snow contract, so you're all set for the season.\n\n${booking.title}\n${season}\n\nThe signed agreement is attached. ${
            contract.seasonPriceCents === null
              ? "Each visit is charged once you confirm it (or 48 hours after it's logged)."
              : contract.seasonPayment === "upfront"
                ? "The season is charged to your saved card now."
                : "This month is charged to your saved card now, and each later month on its 1st."
          }\n\n${deps.config.siteUrl}${bookingPath(booking)}`,
        ),
        attachments,
      ),
      ...withAttachments(
        emailsTo(
          await businessTeamEmails(tx, businessId),
          `Contract confirmed: ${booking.title}`,
          `You accepted a snow contract; the address is on your snow route.\n\n${booking.title}\n${season}\n\nThe signed agreement is attached.\n\n${deps.config.siteUrl}/business/snow-route?b=${businessId}`,
        ),
        attachments,
      ),
    );
    return { months, customerId: booking.customerId };
  });
  await chargeOngoing(deps, { customerId: outcome.customerId });
  await sendAll(deps.email, mail);
  await pushNotifications(deps);
  return { months: outcome.months };
}

// ---------------------------------------------------------------------------------------
// Snow route
// ---------------------------------------------------------------------------------------

/** The business's active contracts in route order, with what each needs (SPEC §21). */
export async function snowRoute(db: DbExecutor, business: Business, now: Date) {
  const today = localIsoDate(now, business.timezone);
  const rows = await db
    .select({
      booking: bookings,
      contract: snowContracts,
      address: addresses,
      customerName: user.name,
    })
    .from(bookings)
    .innerJoin(snowContracts, eq(snowContracts.bookingId, bookings.id))
    .innerJoin(addresses, eq(addresses.id, bookings.addressId))
    .innerJoin(user, eq(user.id, bookings.customerId))
    .where(
      and(
        eq(bookings.businessId, business.id),
        eq(bookings.kind, "snow_contract"),
        eq(bookings.status, "confirmed"),
      ),
    )
    .orderBy(asc(snowContracts.routePosition), asc(bookings.createdAt));
  const ids = rows.map((row) => row.booking.id);
  const logged =
    ids.length === 0
      ? []
      : await db
          .select({
            bookingId: visits.bookingId,
            n: count(),
            last: max(visits.startsAt),
          })
          .from(visits)
          .where(
            and(
              inArray(visits.bookingId, ids),
              inArray(visits.status, [
                "completed_pending_confirmation",
                "disputed",
                "fix_scheduled",
                "completed",
              ]),
            ),
          )
          .groupBy(visits.bookingId);
  return {
    stops: rows.map(({ booking, contract, address, customerName }, index) => {
      const visitsSoFar = logged.find((row) => row.bookingId === booking.id);
      const inSeason = contract.seasonStart <= today && today <= contract.seasonEnd;
      return {
        bookingId: booking.id,
        stop: index + 1,
        customer: { firstName: firstName(customerName) },
        address: addressLines(address),
        notes: booking.customerNotes,
        title: booking.title,
        triggerCm: contract.triggerCm,
        season: seasonLabel(contract.seasonStart, contract.seasonEnd),
        inSeason,
        paused: booking.pausedAt !== null,
        visits: visitsSoFar?.n ?? 0,
        lastCleared: visitsSoFar?.last ?? null,
        lastClearedLabel: visitsSoFar?.last
          ? whenLabel(visitsSoFar.last, visitsSoFar.last, business.timezone).split(" · ")[0]
          : null,
        canMark: inSeason && booking.pausedAt === null,
      };
    }),
  };
}

/** Puts the route in the given order (every active contract, each once). */
export async function reorderRoute(
  db: DbExecutor,
  businessId: string,
  bookingIds: readonly string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ contractId: snowContracts.id, bookingId: bookings.id })
      .from(snowContracts)
      .innerJoin(bookings, eq(bookings.id, snowContracts.bookingId))
      .where(
        and(
          eq(bookings.businessId, businessId),
          eq(bookings.kind, "snow_contract"),
          eq(bookings.status, "confirmed"),
        ),
      );
    const known = new Set(rows.map((row) => row.bookingId));
    if (
      bookingIds.length !== rows.length ||
      new Set(bookingIds).size !== bookingIds.length ||
      bookingIds.some((id) => !known.has(id))
    ) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Your route changed. Reload it and try again.",
      });
    }
    for (const [index, bookingId] of bookingIds.entries()) {
      const row = rows.find((candidate) => candidate.bookingId === bookingId);
      if (!row) continue;
      await tx
        .update(snowContracts)
        .set({ routePosition: index + 1 })
        .where(eq(snowContracts.id, row.contractId));
    }
  });
}

/**
 * Marks an address Cleared after a storm (SPEC §21): logs a visit (with optional photos)
 * the customer confirms or reports within 48 hours.
 */
export async function markCleared(
  deps: BookingDeps,
  actor: { userId: string; memberId: string },
  businessId: string,
  bookingId: string,
  photoIds: readonly string[],
): Promise<{ visitId: string }> {
  const now = deps.now();
  const mail: Mail = [];
  const visitId = await deps.db.transaction(async (tx) => {
    const parts = await lockedParts(tx, bookingId, businessId);
    const { booking, business, service } = parts;
    if (booking.kind !== "snow_contract" || booking.status !== "confirmed") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This contract isn't active." });
    }
    if (booking.pausedAt) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "This contract is paused for an unpaid charge. It can't be marked until it's paid.",
      });
    }
    const contract = await contractOf(tx, bookingId);
    const today = localIsoDate(now, business.timezone);
    if (today < contract.seasonStart || today > contract.seasonEnd) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "That's outside the contract's season.",
      });
    }
    const [recent] = await tx
      .select({ id: visits.id })
      .from(visits)
      .where(
        and(
          eq(visits.bookingId, bookingId),
          gt(visits.startsAt, new Date(now.getTime() - DOUBLE_TAP_MINUTES * MS_PER_MINUTE)),
        ),
      )
      .limit(1);
    if (recent) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This address was marked cleared a few minutes ago.",
      });
    }
    const [last] = await tx
      .select({ sequence: max(visits.sequence) })
      .from(visits)
      .where(eq(visits.bookingId, bookingId));
    const [visit] = await tx
      .insert(visits)
      .values({
        bookingId,
        businessId,
        assignedMemberId: actor.memberId,
        sequence: (last?.sequence ?? 0) + 1,
        startsAt: now,
        endsAt: new Date(now.getTime() + service.durationMinutes * MS_PER_MINUTE),
        workMinutes: service.durationMinutes,
        status: "completed_pending_confirmation",
        completedAt: now,
        completedByUserId: actor.userId,
        autoConfirmAt: new Date(now.getTime() + COMPLETION_CONFIRMATION_HOURS * MS_PER_HOUR),
      })
      .returning({ id: visits.id });
    if (!visit) throw new Error("visit insert returned nothing");
    await attachVisitPhotos(tx, actor.userId, photoIds, visit.id);
    await audit(tx, "visit.logged", "visit", visit.id, actor.userId, { photos: photoIds.length });
    await notify(tx, [booking.customerId], NOTIFICATION_TYPES.visitLogged, {
      text: `${business.name} cleared your snow. Confirm it or report a problem within 48 hours.`,
      path: bookingPath(booking),
    });
    mail.push(
      ...emailsTo(
        await customerEmail(tx, booking.customerId),
        `${business.name} cleared your snow`,
        `${business.name} logged a visit for ${booking.title}${
          photoIds.length > 0 ? ", with a photo" : ""
        }.\n\nPlease confirm it, or report a problem, within 48 hours. If we don't hear from you, it confirms automatically.\n\n${deps.config.siteUrl}${bookingPath(booking)}`,
      ),
    );
    return visit.id;
  });
  await sendAll(deps.email, mail);
  await pushNotifications(deps);
  return { visitId };
}

/** Moves the actor's own unattached visit-log uploads onto the visit. */
async function attachVisitPhotos(
  tx: DbExecutor,
  ownerUserId: string,
  photoIds: readonly string[],
  visitId: string,
): Promise<void> {
  if (photoIds.length === 0) return;
  const rows = await tx
    .select()
    .from(privatePhotos)
    .where(
      and(
        inArray(privatePhotos.id, [...photoIds]),
        eq(privatePhotos.ownerUserId, ownerUserId),
        isNull(privatePhotos.quoteRequestGroupId),
        isNull(privatePhotos.messageId),
      ),
    )
    .for("update");
  if (
    rows.length !== photoIds.length ||
    rows.some((row) => !row.storageKey.startsWith("private/visits/"))
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That photo couldn't be added. Remove it and try again.",
    });
  }
  await tx.insert(visitPhotos).values(
    rows.map((row) => ({
      visitId,
      kind: "after" as const,
      storageKey: row.storageKey,
      contentType: "image/webp",
      uploadedByUserId: ownerUserId,
    })),
  );
  await tx.delete(privatePhotos).where(
    inArray(
      privatePhotos.id,
      rows.map((row) => row.id),
    ),
  );
}

/** A visit photo's storage key, for the customer of its booking or a member of its business. */
export async function visitPhotoKeyFor(
  db: DbExecutor,
  userId: string,
  photoId: string,
): Promise<string | null> {
  const [row] = await db
    .select({
      key: visitPhotos.storageKey,
      customerId: bookings.customerId,
      businessId: bookings.businessId,
    })
    .from(visitPhotos)
    .innerJoin(visits, eq(visits.id, visitPhotos.visitId))
    .innerJoin(bookings, eq(bookings.id, visits.bookingId))
    .where(eq(visitPhotos.id, photoId));
  if (!row) return null;
  if (row.customerId === userId) return row.key;
  const [member] = await db
    .select({ id: businessMembers.id })
    .from(businessMembers)
    .where(
      and(
        eq(businessMembers.businessId, row.businessId),
        eq(businessMembers.userId, userId),
        eq(businessMembers.active, true),
      ),
    );
  return member ? row.key : null;
}

/**
 * The latest agreement PDF of a booking, for its customer or the business's owner and
 * managers; null for anyone else.
 */
export async function agreementFileFor(
  db: DbExecutor,
  userId: string,
  bookingId: string,
): Promise<string | null> {
  const [row] = await db
    .select({
      key: agreements.pdfStorageKey,
      customerId: bookings.customerId,
      businessId: bookings.businessId,
    })
    .from(agreements)
    .innerJoin(bookings, eq(bookings.id, agreements.bookingId))
    .where(eq(agreements.bookingId, bookingId))
    .orderBy(desc(agreements.version))
    .limit(1);
  if (!row) return null;
  if (row.customerId === userId) return row.key;
  const [member] = await db
    .select({ id: businessMembers.id })
    .from(businessMembers)
    .where(
      and(
        eq(businessMembers.businessId, row.businessId),
        eq(businessMembers.userId, userId),
        eq(businessMembers.active, true),
        inArray(businessMembers.role, ["owner", "manager"]),
      ),
    );
  return member ? row.key : null;
}

// ---------------------------------------------------------------------------------------
// Ending
// ---------------------------------------------------------------------------------------

const CANCELLED_VISIT_STATES: readonly string[] = [
  "cancelled_by_customer",
  "cancelled_by_business",
  "refunded",
];

/**
 * Ends a contract early (SPEC §21). Visits already done stay owed. A season price: the
 * customer keeps paying the current month and later months aren't charged (or are
 * refunded); the business refunds the rest of the current month day by day as well.
 */
export async function endContract(
  deps: BookingDeps,
  bookingId: string,
  how:
    | { by: "customer"; customerId: string }
    | { by: "business"; actorUserId: string | null; businessId?: string; reason: string },
): Promise<{ refundCents: number }> {
  const now = deps.now();
  const [current] = await deps.db.select().from(bookings).where(eq(bookings.id, bookingId));
  const owns =
    current &&
    current.kind === "snow_contract" &&
    (how.by === "customer"
      ? current.customerId === how.customerId
      : !how.businessId || current.businessId === how.businessId);
  if (!current || !owns) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
  if (current.status === "requested") {
    if (how.by === "business") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Decline the request instead." });
    }
    await cancelByCustomer(deps, how.customerId, bookingId);
    return { refundCents: 0 };
  }
  const actorUserId = how.by === "customer" ? how.customerId : how.actorUserId;
  const mail: Mail = [];
  const refundCents = await deps.db.transaction(async (tx) => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for("update");
    if (booking?.status !== "confirmed") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This contract has already ended." });
    }
    const [business] = await tx
      .select()
      .from(businesses)
      .where(eq(businesses.id, booking.businessId));
    if (!business) throw new Error("contract business missing");
    const periods = await tx
      .select()
      .from(contractPeriods)
      .where(eq(contractPeriods.bookingId, bookingId))
      .orderBy(asc(contractPeriods.sequence));
    const paid = await livePeriodPayments(tx, periods);
    let refunded = 0;
    let kept = false;
    if (periods.length > 0) {
      const actions = seasonEndActions({
        by: how.by,
        endedOn: localIsoDate(now, booking.timezone),
        periods: periods.map((period) => {
          const payment = paid.get(period.id);
          return {
            sequence: period.sequence,
            start: period.periodStart,
            end: period.periodEnd,
            days: daysIn(period),
            paid: payment
              ? {
                  priceCents: payment.priceCents,
                  serviceFeeCents: payment.serviceFeeCents,
                  taxOnPriceCents: payment.priceTaxCents,
                  taxOnFeeCents: payment.feeTaxCents,
                }
              : null,
          };
        }),
      });
      for (const action of actions) {
        const period = periods.find((candidate) => candidate.sequence === action.sequence);
        if (!period) continue;
        const payment = paid.get(period.id);
        if (action.action === "cancel_charge") {
          await tx
            .update(contractPeriods)
            .set({ status: "cancelled" })
            .where(eq(contractPeriods.id, period.id));
        } else if (action.action === "refund" && payment) {
          await recordRefund(
            tx,
            deps.payments,
            payment,
            action.refund,
            how.by === "customer" ? "customer_cancellation" : "business_cancellation",
            actorUserId,
            now,
          );
          refunded += action.refund.totalRefundCents;
          if (action.refund.retainedPriceCents > 0) kept = true;
        } else {
          kept = true;
        }
      }
    }
    const logged = await tx
      .select({ status: visits.status })
      .from(visits)
      .where(eq(visits.bookingId, bookingId));
    const worked = kept || logged.some((visit) => !CANCELLED_VISIT_STATES.includes(visit.status));
    await tx
      .update(bookings)
      .set({
        status: worked
          ? "completed"
          : how.by === "customer"
            ? "cancelled_by_customer"
            : "cancelled_by_business",
        cancelledAt: now,
        cancellationReason: how.by === "business" ? how.reason : null,
      })
      .where(eq(bookings.id, bookingId));
    await audit(tx, "contract.ended", "booking", bookingId, actorUserId, {
      by: how.by,
      refundCents: refunded,
    });
    const refundLine =
      refunded > 0
        ? `\n\nRefund: ${formatCad(refunded)} to your card (usually 5–10 business days).`
        : "";
    if (how.by === "customer") {
      await notify(
        tx,
        await businessTeamUserIds(tx, booking.businessId),
        NOTIFICATION_TYPES.ongoingEnded,
        { text: `Ended by the customer: ${booking.title}`, path: businessPath(booking) },
      );
      mail.push(
        ...emailsTo(
          await businessTeamEmails(tx, booking.businessId),
          `Ended by the customer: ${booking.title}`,
          `The customer ended this snow contract; it's off your snow route.\n\n${booking.title}\n\n${deps.config.siteUrl}${businessPath(booking)}`,
        ),
        ...emailsTo(
          await customerEmail(tx, booking.customerId),
          `Ended: ${booking.title} with ${business.name}`,
          `You ended this snow contract.${refundLine}\n\n${deps.config.siteUrl}${bookingPath(booking)}`,
        ),
      );
    } else {
      await notify(tx, [booking.customerId], NOTIFICATION_TYPES.ongoingEnded, {
        text: `${business.name} ended your snow contract`,
        path: bookingPath(booking),
      });
      mail.push(
        ...emailsTo(
          await customerEmail(tx, booking.customerId),
          `Ended: ${booking.title} with ${business.name}`,
          `${business.name} ended this snow contract.\n\nTheir reason: "${how.reason}"${refundLine}\n\n${deps.config.siteUrl}${bookingPath(booking)}`,
        ),
      );
    }
    return refunded;
  });
  await sendAll(deps.email, mail);
  await pushNotifications(deps);
  return { refundCents };
}

function daysIn(period: Pick<ContractPeriod, "periodStart" | "periodEnd">): number {
  const start = parseIsoDate(period.periodStart);
  const end = parseIsoDate(period.periodEnd);
  if (!start || !end) return 1;
  return (
    Math.round(
      (Date.UTC(end.year, end.month - 1, end.day) -
        Date.UTC(start.year, start.month - 1, start.day)) /
        (24 * MS_PER_HOUR),
    ) + 1
  );
}

/** Each period's collected payment (succeeded or partly refunded), by period id. */
export async function livePeriodPayments(
  db: DbExecutor,
  periods: readonly ContractPeriod[],
): Promise<Map<string, Payment>> {
  if (periods.length === 0) return new Map();
  const rows = await db
    .select()
    .from(payments)
    .where(
      and(
        inArray(
          payments.periodId,
          periods.map((period) => period.id),
        ),
        inArray(payments.status, ["succeeded", "partially_refunded", "refunded", "pending"]),
      ),
    );
  return new Map(rows.map((row) => [row.periodId ?? "", row]));
}

/** Contracts end by themselves once their season is over (SPEC §21). */
export async function finishContracts(deps: BookingDeps): Promise<number> {
  const finished = await deps.db
    .update(bookings)
    .set({ status: "completed" })
    .where(
      and(
        eq(bookings.kind, "snow_contract"),
        eq(bookings.status, "confirmed"),
        lte(bookings.requestedEndsAt, deps.now()),
      ),
    )
    .returning({ id: bookings.id });
  return finished.length;
}
