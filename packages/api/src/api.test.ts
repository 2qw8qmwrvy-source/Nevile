import { type Auth, createAuth } from "@nevile/auth";
import { DEFAULT_CATEGORIES } from "@nevile/core";
import {
  businesses,
  businessMembers,
  createDb,
  type Database,
  eq,
  profiles,
  serviceCategories,
} from "@nevile/db";
import { seedCategories } from "@nevile/db/seed";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Context, createContext } from "./context.ts";
import { appRouter, createCaller } from "./root.ts";
import { slugify } from "./slug.ts";
import { freshTestDatabase } from "./test/database.ts";
import { businessMemberProcedure, createCallerFactory, router } from "./trpc.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const BASE_URL = "http://localhost:3000";
const PASSWORD = "a long enough password";

if (!TEST_DATABASE_URL) {
  console.warn("TEST_DATABASE_URL is not set; skipping @nevile/api database tests.");
}

async function trpcError(promise: Promise<unknown>): Promise<TRPCError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TRPCError) return error;
    throw error;
  }
  throw new Error("Expected a TRPCError");
}

describe("slugify", () => {
  it("folds accents and punctuation into kebab-case", () => {
    expect(slugify("Côté Déneigement")).toBe("cote-deneigement");
    expect(slugify("  Green's Lawn & Snow!! ")).toBe("greens-lawn-and-snow");
    expect(slugify("---")).toBe("");
    expect(slugify("a".repeat(100))).toHaveLength(60);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("@nevile/api", () => {
  let db: Database;
  let auth: Auth;
  const outbox: string[] = [];

  /** Signs up, verifies and signs in through Better Auth; returns a request context. */
  async function signedInContext(email: string, name: string): Promise<Context> {
    await auth.api.signUpEmail({ body: { email, name, password: PASSWORD } });
    const link = outbox.findLast((text) => text.includes(email));
    const token = link?.match(/verify-email\?token=([^\s]+)/)?.[1];
    if (!token) throw new Error(`No verification email for ${email}`);
    await auth.api.verifyEmail({ query: { token: decodeURIComponent(token) } });
    const signIn = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      returnHeaders: true,
    });
    const cookie = signIn.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    return createContext({ headers: new Headers({ cookie }), db, auth });
  }

  function anonymous(): Context {
    return { db, session: null, headers: new Headers() };
  }

  let maya: Context;
  let leo: Context;

  beforeAll(async () => {
    const url = await freshTestDatabase(TEST_DATABASE_URL as string, "api");
    db = createDb(url, { max: 4 });
    await seedCategories(db);
    auth = createAuth({
      db,
      secret: "api-test-secret-api-test-secret-0123456",
      baseURL: BASE_URL,
      emailSender: {
        send: async (message) => void outbox.push(`${message.to}\n${message.text}`),
      },
      smsSender: { send: async () => {} },
      production: false,
    });
    maya = await signedInContext("maya@example.com", "Maya Tremblay");
    leo = await signedInContext("leo@example.com", "Léo Gagnon");
  });

  afterAll(async () => {
    await db?.$client.end();
  });

  it("resolves the session from the cookie, and null without one", async () => {
    expect(maya.session?.user.email).toBe("maya@example.com");
    const none = await createContext({ headers: new Headers(), db, auth });
    expect(none.session).toBeNull();
    const forged = await createContext({
      headers: new Headers({ cookie: "nevile.session_token=forged.value" }),
      db,
      auth,
    });
    expect(forged.session).toBeNull();
  });

  it("serves public procedures to anonymous callers", async () => {
    const caller = createCaller(anonymous());
    const ping = await caller.health.ping();
    expect(ping.ok).toBe(true);
    expect(ping.time).toBeInstanceOf(Date);
  });

  it("rejects anonymous callers on protected procedures", async () => {
    const caller = createCaller(anonymous());
    const calls = [
      caller.me.get(),
      caller.business.mine(),
      caller.business.create({ name: "Sneaky Snow", province: "ON" }),
      caller.business.get({ businessId: "00000000-0000-4000-8000-000000000000" }),
    ];
    for (const call of calls) {
      expect((await trpcError(call)).code).toBe("UNAUTHORIZED");
    }
    expect(await db.select().from(businesses)).toHaveLength(0);
  });

  it("lists active categories from the database, alphabetically", async () => {
    const caller = createCaller(anonymous());
    const all = await caller.categories.list();
    expect(all.map((category) => category.slug).sort()).toEqual(
      DEFAULT_CATEGORIES.map((category) => category.slug).sort(),
    );
    const names = all.map((category) => category.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));

    await db
      .update(serviceCategories)
      .set({ active: false })
      .where(eq(serviceCategories.slug, "window-washing"));
    try {
      const active = await caller.categories.list();
      expect(active.map((category) => category.slug)).not.toContain("window-washing");
      expect(active).toHaveLength(DEFAULT_CATEGORIES.length - 1);
    } finally {
      await db
        .update(serviceCategories)
        .set({ active: true })
        .where(eq(serviceCategories.slug, "window-washing"));
    }
  });

  it("returns only the caller's own data from me.get", async () => {
    const mine = await createCaller(maya).me.get();
    expect(mine.user).toMatchObject({
      id: maya.session?.user.id,
      name: "Maya Tremblay",
      email: "maya@example.com",
      emailVerified: true,
      phoneNumber: null,
    });
    expect(mine.profile).toMatchObject({ displayName: "Maya Tremblay", activeMode: "customer" });
    expect(mine.businesses).toEqual([]);

    const theirs = await createCaller(leo).me.get();
    expect(theirs.user.id).toBe(leo.session?.user.id);
    expect(theirs.user.id).not.toBe(mine.user.id);
    expect(theirs.user.email).toBe("leo@example.com");
  });

  it("creates a business owned by the caller with an owner membership", async () => {
    const caller = createCaller(maya);
    const created = await caller.business.create({ name: "  Côté Lawn & Snow ", province: "qc" });
    expect(created).toMatchObject({
      name: "Côté Lawn & Snow",
      slug: "cote-lawn-and-snow",
      province: "QC",
      timezone: "America/Toronto",
      plan: "free",
      role: "owner",
    });

    const [row] = await db.select().from(businesses).where(eq(businesses.id, created.id));
    expect(row?.ownerUserId).toBe(maya.session?.user.id);
    const members = await db
      .select()
      .from(businessMembers)
      .where(eq(businessMembers.businessId, created.id));
    expect(members).toEqual([
      expect.objectContaining({ userId: maya.session?.user.id, role: "owner", active: true }),
    ]);
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, maya.session?.user.id ?? ""));
    expect(profile?.activeMode).toBe("business");

    const me = await caller.me.get();
    expect(me.businesses).toEqual([
      { role: "owner", business: expect.objectContaining({ id: created.id, slug: created.slug }) },
    ]);
    expect(await caller.business.mine()).toEqual([expect.objectContaining({ id: created.id })]);
    expect(await caller.business.get({ businessId: created.id })).toMatchObject({
      id: created.id,
      role: "owner",
    });

    // One owned business per account.
    expect(
      (await trpcError(caller.business.create({ name: "Second Co", province: "ON" }))).code,
    ).toBe("CONFLICT");
  });

  it("gives each business a unique slug", async () => {
    const created = await createCaller(leo).business.create({
      name: "Cote Lawn and Snow",
      province: "ON",
    });
    expect(created.slug).toBe("cote-lawn-and-snow-2");
    expect(created.timezone).toBe("America/Toronto");
  });

  it("keeps businesses private to their members", async () => {
    const [mayaBusiness] = await createCaller(maya).business.mine();
    const leoCaller = createCaller(leo);
    expect(
      (await trpcError(leoCaller.business.get({ businessId: mayaBusiness?.id ?? "" }))).code,
    ).toBe("NOT_FOUND");
    const leoMe = await leoCaller.me.get();
    expect(leoMe.businesses.map((entry) => entry.business.id)).not.toContain(mayaBusiness?.id);
  });

  it("validates business input on the server", async () => {
    const caller = createCaller(
      await signedInContext("validation@example.com", "Validation Tester"),
    );
    const badProvince = await trpcError(
      caller.business.create({ name: "Okay Name", province: "ZZ" }),
    );
    expect(badProvince.code).toBe("BAD_REQUEST");
    expect((await trpcError(caller.business.create({ name: " x ", province: "ON" }))).code).toBe(
      "BAD_REQUEST",
    );
    expect((await trpcError(caller.business.get({ businessId: "not-a-uuid" }))).code).toBe(
      "BAD_REQUEST",
    );
  });

  it("checks business roles in businessMemberProcedure", async () => {
    const testRouter = router({
      ownerOnly: businessMemberProcedure(["owner"]).query(({ ctx }) => ctx.business.id),
      anyMember: businessMemberProcedure().query(({ ctx }) => ctx.membership.role),
    });
    const createTestCaller = createCallerFactory(testRouter);
    const [business] = await createCaller(maya).business.mine();
    const businessId = business?.id ?? "";

    // Leo joins Maya's business as crew.
    await db
      .insert(businessMembers)
      .values({ businessId, userId: leo.session?.user.id ?? "", role: "crew" });

    expect(await createTestCaller(maya).ownerOnly({ businessId })).toBe(businessId);
    expect(await createTestCaller(leo).anyMember({ businessId })).toBe("crew");
    expect((await trpcError(createTestCaller(leo).ownerOnly({ businessId }))).code).toBe(
      "FORBIDDEN",
    );

    // Deactivated members lose access.
    await db
      .update(businessMembers)
      .set({ active: false })
      .where(eq(businessMembers.userId, leo.session?.user.id ?? ""));
    expect((await trpcError(createTestCaller(leo).anyMember({ businessId }))).code).toBe(
      "NOT_FOUND",
    );
  });

  it("formats validation errors for clients", async () => {
    const caller = createCaller(maya);
    const error = await trpcError(caller.business.create({ name: "", province: "ON" }));
    const shape = appRouter._def._config.errorFormatter({
      error,
      type: "mutation",
      path: "business.create",
      input: undefined,
      ctx: undefined,
      shape: {
        message: error.message,
        code: -32600,
        data: { code: "BAD_REQUEST", httpStatus: 400 },
      },
    }) as { data: { zodError: { fieldErrors: Record<string, string[]> } | null } };
    expect(shape.data.zodError?.fieldErrors.name?.[0]).toBe("Enter your business name");
  });
});
