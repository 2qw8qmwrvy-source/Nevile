import {
  createConsoleEmailSender,
  devOutboxDirFromEnv,
  type EmailMessage,
  type EmailSender,
} from "@nevile/auth";

let shared: EmailSender | undefined;

/**
 * Email for booking notifications: the development console sender (and dev outbox)
 * outside production. Production needs a real provider, like sign-in emails do; until one
 * is connected, messages are logged as not sent rather than failing the booking.
 */
export const defaultEmailSender: EmailSender = {
  async send(message) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[email] no email provider is configured; not sent:", message.subject);
      return;
    }
    shared ??= createConsoleEmailSender(undefined, { outboxDir: devOutboxDirFromEnv() });
    await shared.send(message);
  },
};

/** Sends each message, logging (never throwing) failures: emails follow committed changes. */
export async function sendAll(
  sender: EmailSender,
  messages: readonly EmailMessage[],
): Promise<void> {
  await Promise.all(
    messages.map(async (message) => {
      try {
        await sender.send(message);
      } catch (error) {
        console.error("[email] could not send", { subject: message.subject, error });
      }
    }),
  );
}
