import { emailsTo } from "../bookings/emails.ts";

export const chatEmails = {
  /** One email per conversation when messages sit unread for 10 minutes (SPEC §20). */
  unread: (
    recipients: string[],
    facts: { from: string; topic: string; count: number; link: string },
  ) =>
    emailsTo(
      recipients,
      facts.count === 1
        ? `New message from ${facts.from}`
        : `${facts.count} new messages from ${facts.from}`,
      `${facts.from} sent you ${facts.count === 1 ? "a message" : `${facts.count} messages`} about ${facts.topic} on Nevile.\n\nRead and reply: ${facts.link}\n\nFor your safety, keep conversations and payments on Nevile.`,
    ),
};
