/** Limits for quote requests, quotes and chat (SPEC §20), shared by forms and the API. */

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
