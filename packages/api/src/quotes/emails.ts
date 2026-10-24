import { formatCad, formatDurationMinutes } from "@nevile/core";
import { emailsTo } from "../bookings/emails.ts";

/** What quote emails need to say. */
export type QuoteMailFacts = {
  businessId: string;
  businessName: string;
  categoryName: string;
  siteUrl: string;
  groupId: string;
  requestId: string;
};

const customerLink = (facts: QuoteMailFacts) => `${facts.siteUrl}/quotes/${facts.groupId}`;
/** A business's quote request page; `?b=` picks the business for people in several. */
export const businessQuotePath = (requestId: string, businessId: string) =>
  `/business/quotes/${requestId}?b=${businessId}`;

const businessLink = (facts: QuoteMailFacts) =>
  `${facts.siteUrl}${businessQuotePath(facts.requestId, facts.businessId)}`;

export const quoteEmails = {
  newRequestForBusiness: (
    recipients: string[],
    facts: QuoteMailFacts & { customerFirstName: string; area: string; replyBy: string },
  ) =>
    emailsTo(
      recipients,
      `Quote request: ${facts.categoryName} near ${facts.area}`,
      `${facts.customerFirstName} asked ${facts.businessName} for a quote for ${facts.categoryName.toLowerCase()} near ${facts.area}.\n\nReply with a price, or decline, by ${facts.replyBy}: ${businessLink(facts)}`,
    ),
  quoteForCustomer: (
    recipients: string[],
    facts: QuoteMailFacts & { priceCents: number; durationMinutes: number; revised: boolean },
  ) =>
    emailsTo(
      recipients,
      facts.revised
        ? `${facts.businessName} updated their quote: ${formatCad(facts.priceCents)}`
        : `Quote from ${facts.businessName}: ${formatCad(facts.priceCents)}`,
      `${facts.businessName} ${facts.revised ? "sent a new quote" : "quoted"} ${formatCad(facts.priceCents)} for your ${facts.categoryName.toLowerCase()} job (about ${formatDurationMinutes(facts.durationMinutes)}).\n\nThe quote is open for 7 days. Compare quotes and book a time: ${customerLink(facts)}`,
    ),
  declinedForCustomer: (recipients: string[], facts: QuoteMailFacts & { reason: string }) =>
    emailsTo(
      recipients,
      `${facts.businessName} can't quote this job`,
      `${facts.businessName} can't take your ${facts.categoryName.toLowerCase()} job.\n\nTheir reason: "${facts.reason}"\n\nSee your other quotes, or ask another pro: ${customerLink(facts)}`,
    ),
  noQuotesForCustomer: (
    recipients: string[],
    facts: Pick<QuoteMailFacts, "categoryName" | "siteUrl" | "groupId">,
  ) =>
    emailsTo(
      recipients,
      `No quotes for your ${facts.categoryName.toLowerCase()} request`,
      `None of the pros you asked could quote your ${facts.categoryName.toLowerCase()} job this time.\n\nTry other pros near you: ${facts.siteUrl}/search`,
    ),
  closedForBusiness: (
    recipients: string[],
    facts: QuoteMailFacts & { reason: "customer_closed" | "chose_another" },
  ) =>
    emailsTo(
      recipients,
      `Quote request closed: ${facts.categoryName}`,
      `${
        facts.reason === "chose_another"
          ? "The customer booked another pro for this job."
          : "The customer closed this quote request."
      } Thanks for replying.\n\n${businessLink(facts)}`,
    ),
};
