import { and, businessMembers, type DbExecutor, eq, inArray, notifications } from "@nevile/db";
import { CONVERSATION_ROLES } from "./photos.ts";

/** In-app notification types (SPEC §20). Payloads carry ids and short display text only. */
export const NOTIFICATION_TYPES = {
  quoteRequested: "quote.requested",
  quoteReceived: "quote.received",
  quoteDeclined: "quote.declined",
  quoteExpired: "quote.expired",
  requestClosed: "quote_request.closed",
  noQuotes: "quote_request.no_quotes",
  // Recurring jobs and snow contracts (SPEC §21).
  ongoingRequested: "ongoing.requested",
  ongoingAccepted: "ongoing.accepted",
  ongoingDeclined: "ongoing.declined",
  ongoingEnded: "ongoing.ended",
  visitReminder: "visit.reminder",
  visitMoved: "visit.moved",
  visitCancelled: "visit.cancelled",
  visitLogged: "visit.logged",
  paymentFailed: "payment.failed",
  bookingPaused: "booking.paused",
} as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export type NotificationPayload = {
  /** One line shown in the inbox, e.g. "Sunrise Lawns sent you a quote: $120". */
  text: string;
  /** Site path the notification opens, e.g. "/quotes/<id>". */
  path: string;
};

export async function notify(
  tx: DbExecutor,
  userIds: readonly string[],
  type: NotificationType,
  payload: NotificationPayload,
): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  await tx.insert(notifications).values(unique.map((userId) => ({ userId, type, payload })));
}

/** User ids of a business's owner and managers (who handle quotes and chat). */
export async function businessTeamUserIds(tx: DbExecutor, businessId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: businessMembers.userId })
    .from(businessMembers)
    .where(
      and(
        eq(businessMembers.businessId, businessId),
        eq(businessMembers.active, true),
        inArray(businessMembers.role, [...CONVERSATION_ROLES]),
      ),
    );
  return rows.map((row) => row.userId);
}
