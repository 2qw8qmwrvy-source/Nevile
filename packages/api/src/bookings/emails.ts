import { contactEmail, type EmailMessage } from "@nevile/auth";
import { formatArrivalWindow, formatCad, toLocal } from "@nevile/core";
import { and, businessMembers, type DbExecutor, eq, inArray, user } from "@nevile/db";

/** "Monday, November 2 · 8–11 am" in the job's time zone. */
export function whenLabel(startsAt: Date, endsAt: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(startsAt);
  const start = toLocal(startsAt, timeZone);
  const end = toLocal(endsAt, timeZone);
  const window = formatArrivalWindow({
    startMinute: start.hour * 60 + start.minute,
    endMinute: end.hour * 60 + end.minute || 1440,
  });
  return `${day} · ${window}`;
}

/** What every booking email needs to say. */
export type BookingMailFacts = {
  bookingId: string;
  businessName: string;
  serviceTitle: string;
  when: string;
  totalCents: number;
  siteUrl: string;
};

const signOff = "\n\n— Nevile";

/** Real email addresses of the business's active owner and managers. */
export async function businessTeamEmails(db: DbExecutor, businessId: string): Promise<string[]> {
  const rows = await db
    .select({ email: user.email })
    .from(businessMembers)
    .innerJoin(user, eq(user.id, businessMembers.userId))
    .where(
      and(
        eq(businessMembers.businessId, businessId),
        eq(businessMembers.active, true),
        inArray(businessMembers.role, ["owner", "manager"]),
      ),
    );
  return rows.flatMap((row) => contactEmail(row.email) ?? []);
}

export async function customerEmail(db: DbExecutor, customerId: string): Promise<string[]> {
  const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, customerId));
  const email = contactEmail(row?.email);
  return email ? [email] : [];
}

/** One message per recipient, with Nevile's sign-off. */
export const emailsTo = (
  addresses: readonly string[],
  subject: string,
  text: string,
): EmailMessage[] => addresses.map((address) => ({ to: address, subject, text: text + signOff }));
const to = emailsTo;

const bookingsLink = (facts: BookingMailFacts) => `${facts.siteUrl}/bookings/${facts.bookingId}`;
const calendarLink = (facts: BookingMailFacts) => `${facts.siteUrl}/business/calendar`;

export const bookingEmails = {
  /** Instant Book: confirmed and paid; doubles as the receipt (SPEC §10). */
  bookedForCustomer: (recipients: string[], facts: BookingMailFacts, receipt: string) =>
    to(
      recipients,
      `Booked: ${facts.serviceTitle} with ${facts.businessName}`,
      `You're booked with ${facts.businessName}.\n\n${facts.serviceTitle}\n${facts.when}\n\n${receipt}\n\nSee or cancel your booking: ${bookingsLink(facts)}`,
    ),
  requestedForCustomer: (recipients: string[], facts: BookingMailFacts) =>
    to(
      recipients,
      `Request sent to ${facts.businessName}`,
      `We've sent your request to ${facts.businessName}.\n\n${facts.serviceTitle}\n${facts.when}\n\n${formatCad(facts.totalCents)} is held on your card, not charged. You're only charged if they accept, within 24 hours; otherwise the hold is released.\n\n${bookingsLink(facts)}`,
    ),
  acceptedForCustomer: (recipients: string[], facts: BookingMailFacts, receipt: string) =>
    to(
      recipients,
      `Accepted: ${facts.serviceTitle} with ${facts.businessName}`,
      `${facts.businessName} accepted your request, so you're booked.\n\n${facts.serviceTitle}\n${facts.when}\n\n${receipt}\n\n${bookingsLink(facts)}`,
    ),
  declinedForCustomer: (
    recipients: string[],
    facts: BookingMailFacts,
    reason: "declined" | "expired",
  ) =>
    to(
      recipients,
      reason === "declined"
        ? `${facts.businessName} couldn't take your request`
        : `Your request to ${facts.businessName} expired`,
      `${
        reason === "declined"
          ? `${facts.businessName} can't take this job.`
          : `${facts.businessName} didn't answer in time.`
      }\n\n${facts.serviceTitle}\n${facts.when}\n\nThe hold on your card has been released; you weren't charged. Find another pro: ${facts.siteUrl}/search`,
    ),
  cancelledForCustomer: (
    recipients: string[],
    facts: BookingMailFacts,
    by: "customer" | "business",
    refundCents: number,
    reason?: string,
  ) =>
    to(
      recipients,
      `Cancelled: ${facts.serviceTitle} on ${facts.when.split(" · ")[0]}`,
      `${by === "customer" ? "You cancelled" : `${facts.businessName} cancelled`} this booking.${
        reason ? `\n\nTheir reason: "${reason}"` : ""
      }\n\n${facts.serviceTitle}\n${facts.when}\n\n${
        refundCents > 0
          ? `Refund: ${formatCad(refundCents)} to your card (usually 5–10 business days).`
          : "No refund is due under this pro's cancellation policy."
      }\n\n${bookingsLink(facts)}`,
    ),
  doneForCustomer: (recipients: string[], facts: BookingMailFacts) =>
    to(
      recipients,
      `${facts.businessName} marked your job done`,
      `${facts.businessName} says this job is done:\n\n${facts.serviceTitle}\n${facts.when}\n\nPlease confirm, or report a problem, within 48 hours. If we don't hear from you, it confirms automatically.\n\n${bookingsLink(facts)}`,
    ),
  newBookingForBusiness: (recipients: string[], facts: BookingMailFacts) =>
    to(
      recipients,
      `New booking: ${facts.serviceTitle}, ${facts.when}`,
      `You have a new booking.\n\n${facts.serviceTitle}\n${facts.when}\n\nAssign a crew member: ${calendarLink(facts)}`,
    ),
  newRequestForBusiness: (recipients: string[], facts: BookingMailFacts) =>
    to(
      recipients,
      `Booking request: ${facts.serviceTitle}, ${facts.when}`,
      `A customer asked to book you.\n\n${facts.serviceTitle}\n${facts.when}\n\nAccept or decline within 24 hours, or before the window starts: ${calendarLink(facts)}`,
    ),
  cancelledForBusiness: (recipients: string[], facts: BookingMailFacts) =>
    to(
      recipients,
      `Cancelled by the customer: ${facts.serviceTitle}, ${facts.when}`,
      `The customer cancelled this booking; the time is free again.\n\n${facts.serviceTitle}\n${facts.when}\n\n${calendarLink(facts)}`,
    ),
  problemForBusiness: (recipients: string[], facts: BookingMailFacts, reason: string) =>
    to(
      recipients,
      `Problem reported: ${facts.serviceTitle}, ${facts.when}`,
      `The customer reported a problem with this job:\n\n"${reason}"\n\nYou have 3 days to put it right. Payment is held until it's resolved.\n\n${calendarLink(facts)}`,
    ),
} as const;

export const businessEmails = {
  payoutSetupStarted: (recipients: string[], siteUrl: string, dueLabel: string) =>
    to(
      recipients,
      "Set up payouts to keep taking bookings",
      `You've received your first paid booking on Nevile. Finish payout setup with Stripe (about 5 minutes: ID and bank account) by ${dueLabel}, or your upcoming bookings will be cancelled and refunded.\n\n${siteUrl}/business/payouts`,
    ),
  payoutSetupReminder: (recipients: string[], siteUrl: string, dueLabel: string) =>
    to(
      recipients,
      "Reminder: finish payout setup",
      `Your payout setup isn't finished. Finish it by ${dueLabel}, or your upcoming bookings will be cancelled and refunded.\n\n${siteUrl}/business/payouts`,
    ),
  payoutSetupEnforced: (recipients: string[], siteUrl: string, cancelled: number) =>
    to(
      recipients,
      "Bookings paused: payout setup not finished",
      `Payout setup wasn't finished in time, so we cancelled and refunded ${cancelled} upcoming ${cancelled === 1 ? "booking" : "bookings"} and paused new ones. Finish setup to start taking bookings again; money for finished jobs is waiting for you.\n\n${siteUrl}/business/payouts`,
    ),
  invite: (recipient: string, siteUrl: string, businessName: string, role: string, token: string) =>
    to(
      [recipient],
      `Join ${businessName} on Nevile`,
      `${businessName} invited you to join their team on Nevile as ${role}.\n\nAccept (the link works for 7 days): ${siteUrl}/invite/${token}\n\nSign in or create an account with this email address to accept.`,
    ),
} as const;

/** Receipt lines for a paid booking (SPEC §10). */
export function receiptText(amounts: {
  priceCents: number;
  serviceFeeCents: number;
  priceTaxCents: number;
  feeTaxCents: number;
  totalCents: number;
}): string {
  const tax = amounts.priceTaxCents + amounts.feeTaxCents;
  return [
    "Receipt",
    `Job price      ${formatCad(amounts.priceCents)}`,
    `Service fee    ${formatCad(amounts.serviceFeeCents)}`,
    ...(tax > 0 ? [`HST            ${formatCad(tax)}`] : []),
    `Total paid     ${formatCad(amounts.totalCents)}`,
  ].join("\n");
}
