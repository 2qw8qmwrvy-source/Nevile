import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OTP_LENGTH } from "./constants.ts";

/**
 * Outbound message channels used by auth. Production deployments must pass real
 * implementations (an email provider, an SMS provider); the console senders below are
 * for local development only.
 */

/** A file sent with an email, e.g. an agreement PDF (SPEC §21). */
export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Production senders must deliver these; the console sender lists them. */
  attachments?: EmailAttachment[];
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

export interface ConsoleSenderOptions {
  /**
   * Also write each message as a JSON file into this directory (the dev outbox read by
   * browser tests). Refused when NODE_ENV is "production".
   */
  outboxDir?: string;
}

/** One message in the dev outbox: `<outboxDir>/<sentAtMs>-<kind>-<uuid>.json`. */
export interface DevOutboxMessage {
  kind: "email" | "sms";
  to: string;
  subject: string;
  text: string;
  /** Every http(s) URL in the text, in order (verification links etc.). */
  links: string[];
  /** The one-time code, for SMS sign-in codes. */
  code?: string;
  sentAt: string;
}

/**
 * The dev outbox directory from the environment: NEVILE_DEV_OUTBOX_DIR, unless NODE_ENV is
 * "production" (never active there).
 */
export function devOutboxDirFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  if (env.NODE_ENV === "production") return undefined;
  return env.NEVILE_DEV_OUTBOX_DIR?.trim() || undefined;
}

const LINK_PATTERN = /https?:\/\/[^\s<>"']+/g;
const CODE_PATTERN = new RegExp(`\\b\\d{${OTP_LENGTH}}\\b`);

type OutboxWriter = (message: Omit<DevOutboxMessage, "links" | "sentAt">) => Promise<void>;

function createOutboxWriter(dir: string): OutboxWriter {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "The dev outbox is for local development and tests; it never runs in production.",
    );
  }
  let ready: Promise<unknown> | undefined;
  return async (message) => {
    ready ??= mkdir(dir, { recursive: true });
    await ready;
    const sent = new Date();
    const entry: DevOutboxMessage = {
      ...message,
      links: message.text.match(LINK_PATTERN) ?? [],
      sentAt: sent.toISOString(),
    };
    const name = `${sent.getTime()}-${message.kind}-${randomUUID()}.json`;
    // Written under a dot-name first, so readers listing *.json never see a partial file.
    const temporary = join(dir, `.${name}.tmp`);
    await writeFile(temporary, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
    await rename(temporary, join(dir, name));
  };
}

/** Development email sender: prints the message (including any links) to the console. */
export function createConsoleEmailSender(
  log: Log = defaultLog,
  options: ConsoleSenderOptions = {},
): EmailSender {
  const outbox = options.outboxDir ? createOutboxWriter(options.outboxDir) : undefined;
  return {
    async send(message) {
      log(
        [
          "",
          "──── [dev email] ─────────────────────────────",
          `To:      ${message.to}`,
          `Subject: ${message.subject}`,
          ...(message.attachments ?? []).map(
            (file) =>
              `Attached: ${file.filename} (${Math.ceil(file.content.byteLength / 1024)} KB)`,
          ),
          "",
          message.text,
          "──────────────────────────────────────────────",
          "",
        ].join("\n"),
      );
      await outbox?.({
        kind: "email",
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    },
  };
}

/**
 * Development SMS sender: prints the message, one-time codes included, to the console
 * (and the dev outbox when configured). These are the only places a code may be written
 * (CLAUDE.md).
 */
export function createConsoleSmsSender(
  log: Log = defaultLog,
  options: ConsoleSenderOptions = {},
): SmsSender {
  const outbox = options.outboxDir ? createOutboxWriter(options.outboxDir) : undefined;
  return {
    async send(message) {
      log(`[dev sms] To ${message.to}: ${message.body}`);
      const code = message.body.match(CODE_PATTERN)?.[0];
      await outbox?.({
        kind: "sms",
        to: message.to,
        subject: "SMS",
        text: message.body,
        ...(code ? { code } : {}),
      });
    },
  };
}
