import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Auth, createAuth, type EmailMessage, type SmsMessage } from "@nevile/auth";
import { createDb, type Database } from "@nevile/db";
import { seedCategories, seedPostalAreas } from "@nevile/db/seed";
import { FakePaymentProvider } from "@nevile/payments";
import { createLocalStorage } from "@nevile/storage";
import { TRPCError } from "@trpc/server";
import { type ApiConfig, DEFAULT_API_CONFIG } from "../config.ts";
import { type Context, createContext } from "../context.ts";
import type { PushMessage, PushSender } from "../push.ts";
import { freshTestDatabase } from "./database.ts";

export const BASE_URL = "http://localhost:3000";
export const PASSWORD = "a long enough password";
/** Halifax. */
export const NS_POSTAL = "B3H 1A1";

type SignUpBody = NonNullable<Parameters<Auth["api"]["signUpEmail"]>[0]>["body"];

export async function trpcError(promise: Promise<unknown>): Promise<TRPCError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TRPCError) return error;
    throw error;
  }
  throw new Error("Expected a TRPCError");
}

function cookieFrom(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}

/**
 * A migrated, seeded copy of the test database (`<name>_api_test`), a Better Auth instance
 * on it that records outgoing messages, and helpers that sign people up through it.
 */
export async function createHarness(baseUrl: string) {
  const url = await freshTestDatabase(baseUrl, "api");
  const db: Database = createDb(url, { max: 4 });
  await seedCategories(db);
  await seedPostalAreas(db);
  // Media goes to a throwaway folder; tests read it back through `storage`.
  const mediaDir = mkdtempSync(join(tmpdir(), "nevile-api-media-"));
  const storage = createLocalStorage(mediaDir);
  const emails: EmailMessage[] = [];
  const sms: SmsMessage[] = [];
  const payments = new FakePaymentProvider({ siteUrl: BASE_URL });
  const email = { send: async (message: EmailMessage) => void emails.push(message) };
  // Phone pushes are captured; tokens listed in `deadTokens` come back as unregistered.
  const pushes: PushMessage[] = [];
  const deadTokens = new Set<string>();
  const push: PushSender = {
    send: async (messages) => {
      pushes.push(...messages);
      return { invalidTokens: messages.map((m) => m.to).filter((token) => deadTokens.has(token)) };
    },
  };
  // Tests move time with `clock.set(...)`; null means the real time.
  let fixedNow: Date | null = null;
  const clock = {
    set: (at: Date | null) => {
      fixedNow = at;
    },
    now: () => fixedNow ?? new Date(),
  };
  const auth: Auth = createAuth({
    db,
    secret: "api-test-secret-api-test-secret-0123456",
    baseURL: BASE_URL,
    emailSender: { send: async (message) => void emails.push(message) },
    smsSender: { send: async (message) => void sms.push(message) },
    production: false,
  });

  async function contextFor(cookie: string, config: ApiConfig = DEFAULT_API_CONFIG) {
    return createContext({
      headers: new Headers({ cookie }),
      db,
      auth,
      config,
      storage,
      payments,
      email,
      push,
      now: clock.now,
    });
  }

  /** Confirms `email` with the link from its latest verification email. */
  async function verifyEmail(email: string): Promise<void> {
    const message = emails.findLast((candidate) => candidate.to === email);
    const token = message?.text.match(/verify-email\?token=([^\s]+)/)?.[1];
    if (!token) throw new Error(`No verification email for ${email}`);
    await auth.api.verifyEmail({ query: { token: decodeURIComponent(token) } });
  }

  /**
   * Signs up by email (signed in straight away) and returns the request context and the
   * session cookie. With `verify`, confirms the email first.
   */
  async function signUp(
    email: string,
    name: string,
    options: { verify?: boolean; postalCode?: string; config?: ApiConfig } = {},
  ): Promise<{ ctx: Context; cookie: string; userId: string }> {
    const body = { email, name, password: PASSWORD, postalCode: options.postalCode ?? NS_POSTAL };
    const result = await auth.api.signUpEmail({
      body: body as SignUpBody,
      returnHeaders: true,
    });
    const cookie = cookieFrom(result.headers);
    if (options.verify ?? true) await verifyEmail(email);
    return {
      ctx: await contextFor(cookie, options.config),
      cookie,
      userId: result.response.user.id,
    };
  }

  /** Signs up with a phone number and SMS code (a verified phone). */
  async function phoneSignUp(phoneNumber: string): Promise<{ ctx: Context; userId: string }> {
    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber } });
    const code = sms.findLast((message) => message.to === phoneNumber)?.body.match(/\d{6}/)?.[0];
    if (!code) throw new Error(`No code sent to ${phoneNumber}`);
    const result = await auth.api.verifyPhoneNumber({
      body: { phoneNumber, code, postalCode: NS_POSTAL },
      returnHeaders: true,
    });
    return {
      ctx: await contextFor(cookieFrom(result.headers)),
      userId: result.response.user?.id ?? "",
    };
  }

  function anonymous(config: ApiConfig = DEFAULT_API_CONFIG): Context {
    return {
      db,
      session: null,
      headers: new Headers(),
      config,
      storage,
      payments,
      email,
      push,
      now: clock.now,
    };
  }

  return {
    db,
    auth,
    storage,
    mediaDir,
    payments,
    clock,
    emails,
    pushes,
    deadTokens,
    sms,
    contextFor,
    verifyEmail,
    signUp,
    phoneSignUp,
    anonymous,
    close: () => db.$client.end(),
  };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;
