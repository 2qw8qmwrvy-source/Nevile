/**
 * Outbound message channels used by auth. Production deployments must pass real
 * implementations (an email provider, an SMS provider); the console senders below are
 * for local development only.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface SmsMessage {
  /** E.164, e.g. "+14165551234". */
  to: string;
  body: string;
}

export interface SmsSender {
  send(message: SmsMessage): Promise<void>;
}

type Log = (line: string) => void;

const defaultLog: Log = (line) => console.info(line);

/** Development email sender: prints the message (including any links) to the console. */
export function createConsoleEmailSender(log: Log = defaultLog): EmailSender {
  return {
    async send(message) {
      log(
        [
          "",
          "──── [dev email] ─────────────────────────────",
          `To:      ${message.to}`,
          `Subject: ${message.subject}`,
          "",
          message.text,
          "──────────────────────────────────────────────",
          "",
        ].join("\n"),
      );
    },
  };
}

/**
 * Development SMS sender: prints the message, one-time codes included, to the console.
 * This is the only place a code may be logged (CLAUDE.md).
 */
export function createConsoleSmsSender(log: Log = defaultLog): SmsSender {
  return {
    async send(message) {
      log(`[dev sms] To ${message.to}: ${message.body}`);
    },
  };
}
