/**
 * Quotes and chat (SPEC §20): what a quote request and a reply may contain, the deadlines,
 * chat message rules and when an unread chat earns an email. Pure rules, no I/O.
 */
import { z } from "zod";
import { QUOTE_EXPIRY_DAYS } from "./booking-lifecycle.ts";
import { CATEGORY_SLUGS } from "./categories.ts";
import { postalAreaOf } from "./geo.ts";
import { hasDisallowedControlCharacters, SERVICE_DURATION_CHOICES } from "./listing.ts";
import { launchPostalCodeSchema } from "./region.ts";
import { MS_PER_DAY, MS_PER_MINUTE } from "./time.ts";

export const QUOTE_REQUEST_LIMITS = {
  /** Pros one request can go to. */
  maxPros: 3,
  maxPhotos: 6,
  /** Open requests a customer may have at once. */
  maxOpenRequests: 5,
  detailsMinLength: 20,
  detailsMaxLength: 2000,
  /** A pro that hasn't replied after this many days is closed as unanswered. */
  replyDays: 3,
} as const;

export const QUOTE_LIMITS = {
  minPriceCents: 500,
  maxPriceCents: 2_000_000,
  noteMaxLength: 1000,
  declineReasonMinLength: 3,
  declineReasonMaxLength: 500,
} as const;

export const MESSAGE_LIMITS = {
  maxLength: 2000,
  maxPhotos: 6,
  /** Messages one person may send per minute. */
  perMinute: 30,
} as const;

/** A chat message unread this long gets one email (per conversation, per burst). */
export const UNREAD_EMAIL_DELAY_MINUTES = 10;

/** How soon the customer would like the job done. */
export const QUOTE_TIMINGS = [
  { value: "asap", label: "As soon as possible" },
  { value: "within_week", label: "Within a week" },
  { value: "within_month", label: "Within a month" },
  { value: "flexible", label: "I'm flexible" },
] as const;
export type QuoteTiming = (typeof QUOTE_TIMINGS)[number]["value"];
const TIMING_VALUES = QUOTE_TIMINGS.map((timing) => timing.value) as [
  QuoteTiming,
  ...QuoteTiming[],
];

export function quoteTimingLabel(timing: QuoteTiming): string {
  return QUOTE_TIMINGS.find((option) => option.value === timing)?.label ?? "";
}

const plainText = (min: number, max: number, messages: { min: string; max: string }) =>
  z
    .string()
    .trim()
    .min(min, { message: messages.min })
    .max(max, { message: messages.max })
    .refine((text) => !hasDisallowedControlCharacters(text), {
      message: "Remove special characters",
    });

/** A customer's request for quotes from up to 3 pros (SPEC §20). */
export const quoteRequestInputSchema = z.object({
  categorySlug: z.enum(CATEGORY_SLUGS, { message: "Pick a service" }),
  businessIds: z
    .array(z.uuid())
    .min(1, { message: "Pick at least one pro" })
    .max(QUOTE_REQUEST_LIMITS.maxPros, {
      message: `Pick up to ${QUOTE_REQUEST_LIMITS.maxPros} pros`,
    })
    .refine((ids) => new Set(ids).size === ids.length, { message: "Pick each pro once" }),
  details: plainText(QUOTE_REQUEST_LIMITS.detailsMinLength, QUOTE_REQUEST_LIMITS.detailsMaxLength, {
    min: "Describe the job in a sentence or two (at least 20 characters)",
    max: `Keep it under ${QUOTE_REQUEST_LIMITS.detailsMaxLength} characters`,
  }),
  postalCode: launchPostalCodeSchema,
  timing: z.enum(TIMING_VALUES, { message: "Pick when you'd like it done" }),
  /** Photos uploaded beforehand (their ids). */
  photoIds: z
    .array(z.uuid())
    .max(QUOTE_REQUEST_LIMITS.maxPhotos, {
      message: `Add up to ${QUOTE_REQUEST_LIMITS.maxPhotos} photos`,
    })
    .refine((ids) => new Set(ids).size === ids.length)
    .default([]),
});
export type QuoteRequestInput = z.input<typeof quoteRequestInputSchema>;

/** A business's quote: one price, how long the job takes, what's included. */
export const quoteReplySchema = z.object({
  priceCents: z
    .number({ message: "Enter the price" })
    .int()
    .min(QUOTE_LIMITS.minPriceCents, { message: "Quotes start at $5" })
    .max(QUOTE_LIMITS.maxPriceCents, { message: "Quotes can be up to $20,000" }),
  durationMinutes: z
    .number({ message: "Pick how long the job takes" })
    .int()
    .refine((minutes) => (SERVICE_DURATION_CHOICES as readonly number[]).includes(minutes), {
      message: "Pick how long the job takes",
    }),
  note: plainText(0, QUOTE_LIMITS.noteMaxLength, {
    min: "",
    max: `Keep the note under ${QUOTE_LIMITS.noteMaxLength} characters`,
  }),
});
export type QuoteReplyInput = z.input<typeof quoteReplySchema>;

export const quoteDeclineSchema = z.object({
  reason: plainText(QUOTE_LIMITS.declineReasonMinLength, QUOTE_LIMITS.declineReasonMaxLength, {
    min: "Tell the customer why in a few words",
    max: `Keep it under ${QUOTE_LIMITS.declineReasonMaxLength} characters`,
  }),
});

/** A chat message: text, photos, or both. */
export const messageInputSchema = z
  .object({
    body: z
      .string()
      .trim()
      .max(MESSAGE_LIMITS.maxLength, {
        message: `Messages can be up to ${MESSAGE_LIMITS.maxLength} characters`,
      })
      .refine((text) => !hasDisallowedControlCharacters(text), {
        message: "Remove special characters",
      }),
    photoIds: z
      .array(z.uuid())
      .max(MESSAGE_LIMITS.maxPhotos, { message: `Add up to ${MESSAGE_LIMITS.maxPhotos} photos` })
      .refine((ids) => new Set(ids).size === ids.length)
      .default([]),
  })
  .refine((message) => message.body.length > 0 || message.photoIds.length > 0, {
    message: "Write a message or add a photo",
    path: ["body"],
  });
export type MessageInput = z.input<typeof messageInputSchema>;

/** When a pro's copy of a request closes if they haven't replied. */
export function quoteReplyDeadline(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + QUOTE_REQUEST_LIMITS.replyDays * MS_PER_DAY);
}

/** When a quote sent (or revised) at `sentAt` expires (SPEC §3). */
export function quoteExpiresAt(sentAt: Date): Date {
  return new Date(sentAt.getTime() + QUOTE_EXPIRY_DAYS * MS_PER_DAY);
}

/** The booking address must be in the postal code area the quote was for. */
export function sameQuoteArea(requestPostalCode: string, bookingPostalCode: string): boolean {
  const requested = postalAreaOf(requestPostalCode);
  return requested !== null && requested === postalAreaOf(bookingPostalCode);
}

/**
 * Whether a person should get the "unread messages" email for a conversation now: the
 * oldest message from the other side that they haven't read (and haven't been emailed
 * about) is at least 10 minutes old.
 */
export function unreadEmailDue(input: {
  /** Oldest message from the other side newer than both `lastReadAt` and `emailedAt`. */
  oldestUnseenAt: Date | null;
  now: Date;
}): boolean {
  if (!input.oldestUnseenAt) return false;
  return (
    input.now.getTime() - input.oldestUnseenAt.getTime() >=
    UNREAD_EMAIL_DELAY_MINUTES * MS_PER_MINUTE
  );
}

/** Shown on a business page once it has replied to 3+ requests in 90 days. */
export const RESPONSE_TIME_MIN_REQUESTS = 3;
export const RESPONSE_TIME_WINDOW_DAYS = 90;

/** Median minutes of the given reply times, or null if there are too few. */
export function medianResponseMinutes(minutes: readonly number[]): number | null {
  if (minutes.length < RESPONSE_TIME_MIN_REQUESTS) return null;
  const sorted = [...minutes].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? (sorted[middle] as number)
      : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  return Math.round(value);
}

/** "Usually replies within an hour" … "Usually replies within 3 days". */
export function responseTimeLabel(medianMinutes: number | null): string | null {
  if (medianMinutes === null) return null;
  if (medianMinutes <= 60) return "Usually replies within an hour";
  if (medianMinutes <= 6 * 60) return "Usually replies within a few hours";
  if (medianMinutes <= 24 * 60) return "Usually replies within a day";
  return "Usually replies within 3 days";
}
