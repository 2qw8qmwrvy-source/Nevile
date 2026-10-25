import { formatCad } from "@nevile/core";
import { emailsTo } from "../bookings/emails.ts";

/** What every email about a recurring series needs to say. */
export type SeriesMailFacts = {
  bookingId: string;
  businessId: string;
  businessName: string;
  serviceTitle: string;
  /** "Every week · Tuesdays 8–11 am · November 3 to April 27". */
  schedule: string;
  /** Total per visit, fee and tax included. */
  perVisitCents: number;
  siteUrl: string;
};

const bookingLink = (facts: SeriesMailFacts) => `${facts.siteUrl}/bookings/${facts.bookingId}`;
const seriesLink = (facts: SeriesMailFacts) =>
  `${facts.siteUrl}/business/series/${facts.bookingId}?b=${facts.businessId}`;
const dateList = (dates: readonly string[]) => dates.map((date) => `- ${date}`).join("\n");

export const seriesEmails = {
  requestedForCustomer: (recipients: string[], facts: SeriesMailFacts, visits: number) =>
    emailsTo(
      recipients,
      `Request sent to ${facts.businessName}`,
      `We've sent your recurring booking to ${facts.businessName}.\n\n${facts.serviceTitle}\n${facts.schedule}\n${visits} visits at ${formatCad(facts.perVisitCents)} each\n\nNothing is charged now. If they accept within 24 hours, each visit is charged to your saved card 3 days before it.\n\n${bookingLink(facts)}`,
    ),
  requestForBusiness: (recipients: string[], facts: SeriesMailFacts, visits: number) =>
    emailsTo(
      recipients,
      `Recurring booking request: ${facts.serviceTitle}`,
      `A customer asked to book you for recurring visits.\n\n${facts.serviceTitle}\n${facts.schedule}\n${visits} visits\n\nAccept or decline within 24 hours: ${seriesLink(facts)}`,
    ),
  acceptedForCustomer: (
    recipients: string[],
    facts: SeriesMailFacts,
    visits: number,
    skipped: readonly string[],
  ) =>
    emailsTo(
      recipients,
      `Accepted: ${facts.serviceTitle} with ${facts.businessName}`,
      `${facts.businessName} accepted your recurring booking.\n\n${facts.serviceTitle}\n${facts.schedule}\n${visits} visits at ${formatCad(facts.perVisitCents)} each, charged to your saved card 3 days before each visit.${
        skipped.length > 0
          ? `\n\nThese dates stopped fitting their calendar, so they're skipped (nothing is charged for them):\n${dateList(skipped)}`
          : ""
      }\n\nSkip a visit or end the series: ${bookingLink(facts)}`,
    ),
  reminderForCustomer: (recipients: string[], facts: SeriesMailFacts, when: string) =>
    emailsTo(
      recipients,
      `Tomorrow: ${facts.serviceTitle} with ${facts.businessName}`,
      `A reminder that ${facts.businessName} comes tomorrow.\n\n${facts.serviceTitle}\n${when}\n\n${bookingLink(facts)}`,
    ),
  movedForCustomer: (recipients: string[], facts: SeriesMailFacts, from: string, to: string) =>
    emailsTo(
      recipients,
      `${facts.businessName} moved a visit`,
      `${facts.businessName} moved one visit of ${facts.serviceTitle}.\n\nWas: ${from}\nNow: ${to}\n\nIf that doesn't work for you, reply in chat or skip the visit: ${bookingLink(facts)}`,
    ),
  skippedForBusiness: (recipients: string[], facts: SeriesMailFacts, when: string) =>
    emailsTo(
      recipients,
      `Visit skipped: ${facts.serviceTitle}, ${when}`,
      `The customer skipped one visit; the time is free again.\n\n${facts.serviceTitle}\n${when}\n\n${seriesLink(facts)}`,
    ),
  skippedForCustomer: (
    recipients: string[],
    facts: SeriesMailFacts,
    when: string,
    money: { refundCents: number; chargeCents: number },
  ) =>
    emailsTo(
      recipients,
      `Skipped: ${facts.serviceTitle}, ${when}`,
      `You skipped this visit:\n\n${facts.serviceTitle}\n${when}\n\n${
        money.refundCents > 0
          ? `Refund: ${formatCad(money.refundCents)} to your card (usually 5–10 business days).`
          : money.chargeCents > 0
            ? `It was inside the cancellation window, so ${formatCad(money.chargeCents)} is charged under this pro's policy.`
            : "Nothing is charged for it."
      }\n\n${bookingLink(facts)}`,
    ),
  visitCancelledForCustomer: (
    recipients: string[],
    facts: SeriesMailFacts,
    when: string,
    refundCents: number,
    reason: string,
  ) =>
    emailsTo(
      recipients,
      `${facts.businessName} cancelled a visit`,
      `${facts.businessName} cancelled one visit of ${facts.serviceTitle}.\n\nTheir reason: "${reason}"\n\n${when}\n\n${
        refundCents > 0
          ? `Refund: ${formatCad(refundCents)} to your card (usually 5–10 business days).`
          : "It hadn't been charged yet, so nothing is owed."
      }\n\nYour other visits are unchanged: ${bookingLink(facts)}`,
    ),
  endedForCustomer: (
    recipients: string[],
    facts: SeriesMailFacts,
    by: "customer" | "business",
    money: { refundCents: number; chargeCents: number; cancelled: number },
    reason?: string,
  ) =>
    emailsTo(
      recipients,
      `Ended: ${facts.serviceTitle} with ${facts.businessName}`,
      `${by === "customer" ? "You ended" : `${facts.businessName} ended`} this recurring booking.${
        reason ? `\n\nTheir reason: "${reason}"` : ""
      }\n\n${facts.serviceTitle}\n${facts.schedule}\n\n${money.cancelled} upcoming ${
        money.cancelled === 1 ? "visit is" : "visits are"
      } cancelled.${money.refundCents > 0 ? ` Refund: ${formatCad(money.refundCents)} to your card.` : ""}${
        money.chargeCents > 0
          ? ` ${formatCad(money.chargeCents)} is charged for a visit inside the cancellation window.`
          : ""
      }\n\n${bookingLink(facts)}`,
    ),
  endedForBusiness: (recipients: string[], facts: SeriesMailFacts, cancelled: number) =>
    emailsTo(
      recipients,
      `Ended by the customer: ${facts.serviceTitle}`,
      `The customer ended this recurring booking. ${cancelled} upcoming ${
        cancelled === 1 ? "visit is" : "visits are"
      } off your calendar.\n\n${facts.serviceTitle}\n${facts.schedule}\n\n${seriesLink(facts)}`,
    ),
} as const;
