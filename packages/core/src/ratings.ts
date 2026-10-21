/**
 * Ratings & reviews — SPEC §9.
 *
 * - Either side may rate the other only after the job is completed, within 14 days
 *   (elapsed time, inclusive of the exact 14-day mark).
 * - One-off jobs: one rating per rater per job.
 * - Recurring jobs and contracts: at most one rating per calendar month of service per
 *   rater per relationship. The month is the local month (job zone) of the completed
 *   visit being rated; see `ratingMonthKey`.
 * - 1–5 whole stars, optional comment up to 1000 characters; the rated party may post one
 *   public reply up to 1000 characters. Ratings are visible immediately.
 */
import { z } from "zod";
import { DEFAULT_TIME_ZONE, MS_PER_DAY, assertValidDate, toLocal } from "./time.ts";

export const RATING_WINDOW_DAYS = 14;
export const RATING_COMMENT_MAX_LENGTH = 1000;
export const RATING_REPLY_MAX_LENGTH = 1000;
export const MIN_STARS = 1;
export const MAX_STARS = 5;

export type CanRateInput = {
  /** When the job (or visit) was completed; null/undefined if it is not completed. */
  jobCompletedAt: Date | null | undefined;
  now: Date;
  /**
   * Ratings this rater has already left — for this job when one-off, or for this
   * relationship in the visit's calendar month when recurring/contract.
   */
  existingRatingsByRaterInMonth: number;
  isRecurring: boolean;
};

export type CanRateReason =
  | "not_completed"
  | "window_closed"
  /** One-off job already rated by this rater. */
  | "already_rated"
  /** Recurring/contract relationship already rated by this rater this month. */
  | "monthly_limit_reached";

export type CanRateResult =
  | { ok: true; /** Last instant a rating is accepted. */ deadline: Date }
  | { ok: false; reason: CanRateReason };

export function ratingDeadline(jobCompletedAt: Date): Date {
  assertValidDate(jobCompletedAt, "jobCompletedAt");
  return new Date(jobCompletedAt.getTime() + RATING_WINDOW_DAYS * MS_PER_DAY);
}

export function canRate(input: CanRateInput): CanRateResult {
  assertValidDate(input.now, "now");
  const existing = input.existingRatingsByRaterInMonth;
  if (!Number.isInteger(existing) || existing < 0) {
    throw new RangeError("existingRatingsByRaterInMonth must be a non-negative integer");
  }
  const completedAt = input.jobCompletedAt;
  if (!completedAt || input.now.getTime() < completedAt.getTime()) {
    return { ok: false, reason: "not_completed" };
  }
  const deadline = ratingDeadline(completedAt);
  if (input.now.getTime() > deadline.getTime()) return { ok: false, reason: "window_closed" };
  // Both allow exactly one rating per scope: the job (one-off) or the month (recurring).
  if (existing >= 1) {
    return { ok: false, reason: input.isRecurring ? "monthly_limit_reached" : "already_rated" };
  }
  return { ok: true, deadline };
}

/**
 * Calendar-month key ("YYYY-MM") used to enforce the one-rating-per-month rule for
 * recurring jobs and contracts, in the job's local zone.
 */
export function ratingMonthKey(visitCompletedAt: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  const local = toLocal(visitCompletedAt, timeZone);
  return `${String(local.year).padStart(4, "0")}-${String(local.month).padStart(2, "0")}`;
}

/** The rated party may reply once. */
export function canReply(input: { existingReplies: number }): boolean {
  return input.existingReplies === 0;
}

export const starsSchema = z.number().int().min(MIN_STARS).max(MAX_STARS);

export const ratingInputSchema = z.object({
  stars: starsSchema,
  comment: z
    .string()
    .trim()
    .max(RATING_COMMENT_MAX_LENGTH)
    .optional()
    .transform((value) => (value ? value : undefined)),
});
export type RatingInput = z.infer<typeof ratingInputSchema>;

export const ratingReplyInputSchema = z.object({
  body: z.string().trim().min(1).max(RATING_REPLY_MAX_LENGTH),
});
export type RatingReplyInput = z.infer<typeof ratingReplyInputSchema>;
