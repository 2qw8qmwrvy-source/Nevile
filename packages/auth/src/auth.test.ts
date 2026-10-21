import { createDb, type Database, eq, profiles, sql, user } from "@nevile/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isPlaceholderEmail, placeholderEmailForPhone } from "./identity.ts";
import type { EmailMessage, SmsMessage } from "./senders.ts";
import {
  AUTH_EMAILS_PER_RECIPIENT,
  type Auth,
  type CreateAuthOptions,
  createAuth,
  OTP_SENDS_PER_NUMBER,
  SIGN_IN_ATTEMPTS_PER_EMAIL,
} from "./server.ts";
import { suspendUser, unsuspendUser } from "./suspension.ts";
import { freshTestDatabase } from "./test/database.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const BASE_URL = "http://localhost:3000";
const PASSWORD = "correct horse battery";

if (!TEST_DATABASE_URL) {
  console.warn("TEST_DATABASE_URL is not set; skipping @nevile/auth database tests.");
}

/** Status and Better Auth error code of a rejected `auth.api` call. */
async function rejection(promise: Promise<unknown>): Promise<{ status: number; code?: string }> {
  try {
    await promise;
  } catch (error) {
    const err = error as { statusCode?: number; body?: { code?: string } };
    return { status: err.statusCode ?? 0, code: err.body?.code };
  }
  throw new Error("Expected the call to be rejected");
}

function tokenFrom(message: EmailMessage | undefined): string {
  const match = message?.text.match(/\/verify-email\?token=([^\s]+)/);
  if (!match?.[1]) throw new Error("No verification link in email");
  return decodeURIComponent(match[1]);
}

function codeFrom(message: SmsMessage | undefined): string {
  const match = message?.body.match(/\b(\d{6})\b/);
  if (!match?.[1]) throw new Error("No code in SMS");
  return match[1];
}

/** Cookie header built from a Set-Cookie response header. */
function cookieHeader(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

describe.skipIf(!TEST_DATABASE_URL)("@nevile/auth", () => {
  let db: Database;
  let auth: Auth;
  const emails: EmailMessage[] = [];
  const sms: SmsMessage[] = [];

  /** An instance on the test database; `overrides` change individual options. */
  function makeAuth(overrides: Partial<CreateAuthOptions> = {}): Auth {
    return createAuth({
      db,
      secret: "test-secret-test-secret-test-secret-0123",
      baseURL: BASE_URL,
      emailSender: { send: async (message) => void emails.push(message) },
      smsSender: { send: async (message) => void sms.push(message) },
      production: false,
      ...overrides,
    });
  }

  beforeAll(async () => {
    const url = await freshTestDatabase(TEST_DATABASE_URL as string, "auth");
    db = createDb(url, { max: 4 });
    auth = makeAuth();
  });

  afterAll(async () => {
    await db?.$client.end();
  });

  beforeEach(async () => {
    emails.length = 0;
    sms.length = 0;
    await db.execute(sql`DELETE FROM rate_limit`);
  });

  describe("email and password", () => {
    it("requires a verified email before sign-in, then signs in", async () => {
      const email = "maya@example.com";
      const signUp = await auth.api.signUpEmail({
        body: { name: "Maya Tremblay", email, password: PASSWORD },
      });
      expect(signUp.token).toBeNull();
      expect(signUp.user.emailVerified).toBe(false);

      expect(emails).toHaveLength(1);
      expect(emails[0]?.to).toBe(email);
      expect(emails[0]?.text).toContain(`${BASE_URL}/verify-email?token=`);
      const token = tokenFrom(emails[0]);

      // Unverified: refused, and a fresh link is sent because the password was right.
      expect(
        await rejection(auth.api.signInEmail({ body: { email, password: PASSWORD } })),
      ).toEqual({ status: 403, code: "EMAIL_NOT_VERIFIED" });
      expect(emails).toHaveLength(2);

      await auth.api.verifyEmail({ query: { token } });

      const signedIn = await auth.api.signInEmail({
        body: { email, password: PASSWORD },
        returnHeaders: true,
      });
      expect(signedIn.response.token).toEqual(expect.any(String));
      const setCookie = signedIn.headers.getSetCookie().join("\n");
      expect(setCookie).toContain("nevile.session_token=");
      expect(setCookie).toMatch(/Max-Age=2592000/i);
      expect(setCookie).toMatch(/HttpOnly/i);

      const session = await auth.api.getSession({
        headers: new Headers({ cookie: cookieHeader(signedIn.headers) }),
      });
      expect(session?.user.email).toBe(email);
      expect(session?.user.emailVerified).toBe(true);

      const [profile] = await db.select().from(profiles).where(eq(profiles.userId, signUp.user.id));
      expect(profile?.displayName).toBe("Maya Tremblay");
    });

    it("answers a duplicate sign-up exactly like a new one", async () => {
      const first = await auth.api.signUpEmail({
        body: { name: "Sam", email: "sam@example.com", password: PASSWORD },
      });
      const fresh = await auth.api.signUpEmail({
        body: { name: "Sam", email: "sam2@example.com", password: PASSWORD },
      });
      emails.length = 0;
      const duplicate = await auth.api.signUpEmail({
        body: { name: "Sam", email: "sam@example.com", password: "another password" },
      });

      const shape = (value: typeof fresh) => {
        const { id: _id, email: _email, createdAt: _c, updatedAt: _u, ...rest } = value.user;
        return { token: value.token, user: rest, keys: Object.keys(value.user).sort() };
      };
      expect(shape(duplicate)).toEqual(shape(fresh));
      expect(duplicate.user.id).not.toBe(first.user.id);

      // The real owner hears about it; no second account exists.
      expect(emails).toHaveLength(1);
      expect(emails[0]?.subject).toMatch(/already have a Nevile account/);
      const rows = await db.select().from(user).where(eq(user.email, "sam@example.com"));
      expect(rows).toHaveLength(1);
    });

    it("rejects weak passwords, extra fields and phone placeholder emails", async () => {
      expect(
        await rejection(
          auth.api.signUpEmail({ body: { name: "A", email: "a@example.com", password: "short" } }),
        ),
      ).toMatchObject({ status: 400, code: "PASSWORD_TOO_SHORT" });

      expect(
        await rejection(
          auth.api.signUpEmail({
            body: {
              name: "Mallory",
              email: "mallory@example.com",
              password: PASSWORD,
              phoneNumber: "+14165550199",
            } as never,
          }),
        ),
      ).toMatchObject({ status: 400, code: "FIELD_NOT_ALLOWED" });

      expect(
        await rejection(
          auth.api.signUpEmail({
            body: {
              name: "Mallory",
              email: placeholderEmailForPhone("+14165550199"),
              password: PASSWORD,
            },
          }),
        ),
      ).toMatchObject({ status: 400, code: "INVALID_EMAIL" });

      expect(
        await rejection(
          auth.api.signUpEmail({
            body: { name: "  ", email: "blank@example.com", password: PASSWORD },
          }),
        ),
      ).toMatchObject({ status: 400, code: "INVALID_NAME" });

      expect(emails).toHaveLength(0);
    });

    it("limits password sign-in attempts per account, whatever the IP", async () => {
      const body = { email: "Target@Example.com", password: "wrong password!" };
      for (let attempt = 0; attempt < SIGN_IN_ATTEMPTS_PER_EMAIL.max; attempt += 1) {
        expect(await rejection(auth.api.signInEmail({ body }))).toMatchObject({ status: 401 });
      }
      // The same address in another spelling shares the counter.
      expect(
        await rejection(auth.api.signInEmail({ body: { ...body, email: " target@example.com " } })),
      ).toEqual({ status: 429, code: "TOO_MANY_ATTEMPTS" });
      // Other accounts are unaffected.
      expect(
        await rejection(auth.api.signInEmail({ body: { ...body, email: "other@example.com" } })),
      ).toMatchObject({ status: 401 });
    });

    it("caps auth emails per recipient without changing the response", async () => {
      const email = "flood@example.com";
      await auth.api.signUpEmail({ body: { name: "Flo", email, password: PASSWORD } });
      for (let send = 0; send < AUTH_EMAILS_PER_RECIPIENT.max + 2; send += 1) {
        await expect(auth.api.sendVerificationEmail({ body: { email } })).resolves.toEqual({
          status: true,
        });
      }
      expect(emails.filter((message) => message.to === email)).toHaveLength(
        AUTH_EMAILS_PER_RECIPIENT.max,
      );
    });

    it("refuses sessions to suspended users and revokes the ones they had", async () => {
      const email = "suspended@example.com";
      const signUp = await auth.api.signUpEmail({
        body: { name: "Sue", email, password: PASSWORD },
      });
      await db.update(user).set({ emailVerified: true }).where(eq(user.id, signUp.user.id));
      const signedIn = await auth.api.signInEmail({
        body: { email, password: PASSWORD },
        returnHeaders: true,
      });
      const headers = new Headers({ cookie: cookieHeader(signedIn.headers) });
      expect((await auth.api.getSession({ headers }))?.user.id).toBe(signUp.user.id);

      await suspendUser(db, signUp.user.id, "chargeback fraud");
      expect(await auth.api.getSession({ headers })).toBeNull();
      expect(
        await rejection(auth.api.signInEmail({ body: { email, password: PASSWORD } })),
      ).toEqual({ status: 403, code: "ACCOUNT_SUSPENDED" });

      await unsuspendUser(db, signUp.user.id);
      const again = await auth.api.signInEmail({ body: { email, password: PASSWORD } });
      expect(again.token).toEqual(expect.any(String));
    });

    it("rejects a tampered verification token", async () => {
      expect(
        await rejection(auth.api.verifyEmail({ query: { token: "not-a-real-token" } })),
      ).toMatchObject({ status: 401, code: "INVALID_TOKEN" });
    });
  });

  describe("phone one-time code", () => {
    const phone = "+14165550123";

    it("creates an account on first verification and signs the same account in later", async () => {
      await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone } });
      expect(sms).toHaveLength(1);
      expect(sms[0]?.to).toBe(phone);
      const code = codeFrom(sms[0]);

      const first = await auth.api.verifyPhoneNumber({
        body: { phoneNumber: phone, code },
        returnHeaders: true,
      });
      expect(first.response.token).toEqual(expect.any(String));
      expect(first.headers.getSetCookie().join("\n")).toContain("nevile.session_token=");
      const created = first.response.user;
      expect(created?.phoneNumber).toBe(phone);
      expect(created?.phoneNumberVerified).toBe(true);
      expect(isPlaceholderEmail(created?.email)).toBe(true);
      expect(created?.name).toBe("");

      // A used code cannot be replayed.
      expect(
        (await rejection(auth.api.verifyPhoneNumber({ body: { phoneNumber: phone, code } })))
          .status,
      ).toBe(400);

      await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone } });
      const again = await auth.api.verifyPhoneNumber({
        body: { phoneNumber: phone, code: codeFrom(sms[1]) },
      });
      expect(again.user?.id).toBe(created?.id);

      // The placeholder address is never mailed.
      await auth.api.sendVerificationEmail({ body: { email: created?.email ?? "" } });
      expect(emails).toHaveLength(0);
    });

    it("locks a code after three wrong attempts", async () => {
      const other = "+16475550124";
      await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: other } });
      const code = codeFrom(sms[0]);
      const wrong = code === "000000" ? "111111" : "000000";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect(
          (
            await rejection(
              auth.api.verifyPhoneNumber({ body: { phoneNumber: other, code: wrong } }),
            )
          ).code,
        ).toBe("INVALID_OTP");
      }
      expect(
        await rejection(auth.api.verifyPhoneNumber({ body: { phoneNumber: other, code } })),
      ).toMatchObject({ status: 403, code: "TOO_MANY_ATTEMPTS" });
    });

    it("only accepts normalized Canadian numbers", async () => {
      for (const phoneNumber of [
        "416-555-0123",
        "4165550123",
        "+442071838750",
        "+14115550123",
        "+18765551234", // Jamaica: +1, but not Canada
        "+18095550123", // Dominican Republic
        "+19005551234", // premium rate
        "+12125551234", // United States
      ]) {
        expect(
          await rejection(auth.api.sendPhoneNumberOTP({ body: { phoneNumber } })),
        ).toMatchObject({ status: 400, code: "INVALID_PHONE_NUMBER" });
      }
      expect(sms).toHaveLength(0);
    });

    it("limits codes per number regardless of IP", async () => {
      const target = "+15145550125";
      for (let send = 0; send < OTP_SENDS_PER_NUMBER.max; send += 1) {
        await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: target } });
      }
      expect(
        await rejection(auth.api.sendPhoneNumberOTP({ body: { phoneNumber: target } })),
      ).toMatchObject({ status: 429, code: "TOO_MANY_CODES" });
      expect(sms).toHaveLength(OTP_SENDS_PER_NUMBER.max);
    });

    it("stops sending codes once the global SMS budget is spent", async () => {
      const budgeted = makeAuth({ smsBudget: { window: 600, max: 2 } });
      await budgeted.api.sendPhoneNumberOTP({ body: { phoneNumber: "+14165550301" } });
      await budgeted.api.sendPhoneNumberOTP({ body: { phoneNumber: "+16475550302" } });
      expect(
        await rejection(budgeted.api.sendPhoneNumberOTP({ body: { phoneNumber: "+19055550303" } })),
      ).toEqual({ status: 429, code: "SMS_BUDGET_EXCEEDED" });
      expect(sms).toHaveLength(2);
    });
  });

  describe("HTTP handler", () => {
    function post(
      path: string,
      body: unknown,
      ip = "203.0.113.7",
      options: { instance?: Auth; headers?: Record<string, string> } = {},
    ): Promise<Response> {
      return (options.instance ?? auth).handler(
        new Request(`${BASE_URL}/api/auth${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: BASE_URL,
            "x-forwarded-for": ip,
            ...options.headers,
          },
          body: JSON.stringify(body),
        }),
      );
    }

    const wrongPassword = { email: "nobody@example.com", password: "wrong password!" };

    it("never reads the client IP from X-Real-IP", async () => {
      // A two-hop X-Forwarded-For is not trusted without trusted proxies; a rotating
      // X-Real-IP used to become the rate-limit key and escape the limit.
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 7; attempt += 1) {
        const response = await post("/sign-in/email", wrongPassword, "1.1.1.1, 203.0.113.9", {
          headers: { "x-real-ip": `198.51.100.${attempt + 1}` },
        });
        statuses.push(response.status);
      }
      expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(statuses.slice(5)).toEqual([429, 429]);
    });

    it("uses the rightmost untrusted X-Forwarded-For hop behind trusted proxies", async () => {
      const proxied = makeAuth({ production: true, trustedProxies: ["10.0.0.0/8"] });
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 7; attempt += 1) {
        // The client controls the leftmost entries; the proxy appends the real address.
        const chain = `192.0.2.${attempt + 1}, 198.51.100.20, 10.0.0.5`;
        statuses.push(
          (await post("/sign-in/email", wrongPassword, chain, { instance: proxied })).status,
        );
      }
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429]);
      // A different real client behind the same proxy has its own bucket.
      const other = await post("/sign-in/email", wrongPassword, "198.51.100.21, 10.0.0.5", {
        instance: proxied,
      });
      expect(other.status).toBe(401);
    });

    it("reads only the configured edge header when one is set", async () => {
      const edge = makeAuth({ clientIpHeader: "CF-Connecting-IP" });
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const response = await post("/sign-in/email", wrongPassword, `192.0.2.${attempt + 1}`, {
          instance: edge,
          headers: { "cf-connecting-ip": "198.51.100.30" },
        });
        statuses.push(response.status);
      }
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    });

    it("refuses to start in production without a trusted client IP source", () => {
      expect(() => makeAuth({ production: true })).toThrow(/trusted client IP/);
      expect(() => makeAuth({ production: true, trustedProxies: ["10.0.0.1"] })).not.toThrow();
      expect(() => makeAuth({ production: true, clientIpHeader: "fly-client-ip" })).not.toThrow();
    });

    it("does not expose the Expo OAuth proxy (open redirect)", async () => {
      const response = await auth.handler(
        new Request(
          `${BASE_URL}/api/auth/expo-authorization-proxy?authorizationURL=${encodeURIComponent("https://evil.example/phish?state=abc")}&oauthState=x`,
        ),
      );
      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.getSetCookie()).toEqual([]);
    });

    it("rate-limits sign-in attempts per IP in the database", async () => {
      const body = { email: "nobody@example.com", password: "wrong password!" };
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await post("/sign-in/email", body)).status).toBe(401);
      }
      const limited = await post("/sign-in/email", body);
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("x-retry-after"))).toBeGreaterThan(0);
      // Another client is unaffected.
      expect((await post("/sign-in/email", body, "198.51.100.4")).status).toBe(401);

      const stored = await db.execute(sql`SELECT key FROM rate_limit WHERE key LIKE '%sign-in%'`);
      expect(stored.rows.length).toBeGreaterThan(0);
    });

    it("does not offer phone + password sign-in", async () => {
      const response = await post("/sign-in/phone-number", {
        phoneNumber: "+14165550123",
        password: PASSWORD,
      });
      expect(response.status).toBe(404);
    });

    it("refuses requests from untrusted origins", async () => {
      const response = await auth.handler(
        new Request(`${BASE_URL}/api/auth/sign-up/email`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://evil.example",
            cookie: "nevile.session_token=x",
          },
          body: JSON.stringify({ name: "E", email: "e@example.com", password: PASSWORD }),
        }),
      );
      expect(response.status).toBe(403);
    });
  });
});
