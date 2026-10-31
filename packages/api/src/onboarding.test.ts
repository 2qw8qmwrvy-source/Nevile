import { MARKETING_CONSENT_VERSION, OUTSIDE_LAUNCH_REGION_MESSAGE } from "@nevile/core";
import { and, auditLog, eq, profiles } from "@nevile/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCaller } from "./root.ts";
import { createHarness, type Harness, trpcError } from "./test/harness.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("onboarding and marketing consent", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness(TEST_DATABASE_URL as string);
  });

  afterAll(async () => {
    await harness?.close();
  });

  it("starts from the sign-up postal code, open to unverified users", async () => {
    const { ctx } = await harness.signUp("nora@example.com", "Nora", {
      verify: false,
      postalCode: "b2y4g8",
    });
    const me = await createCaller(ctx).me.get();
    expect(me.verified).toBe(false);
    expect(me.onboarding).toEqual({
      intent: null,
      postalCode: "B2Y 4G8",
      interests: [],
      completed: false,
    });
    expect(me.marketingConsent).toEqual({
      consented: false,
      version: null,
      at: null,
      outdated: false,
    });
  });

  it("saves the welcome answers idempotently and keeps the first completion time", async () => {
    const { ctx, userId } = await harness.signUp("omar@example.com", "Omar", { verify: false });
    const caller = createCaller(ctx);
    const answers = {
      intent: "both" as const,
      postalCode: "b1p 6l2",
      interests: ["snow-ice-removal" as const, "lawn-mowing" as const],
    };

    const saved = await caller.onboarding.save(answers);
    expect(saved).toEqual({
      intent: "both",
      postalCode: "B1P 6L2",
      interests: ["snow-ice-removal", "lawn-mowing"],
      completed: true,
    });
    const [first] = await harness.db.select().from(profiles).where(eq(profiles.userId, userId));

    expect(await caller.onboarding.save(answers)).toEqual(saved);
    const [second] = await harness.db.select().from(profiles).where(eq(profiles.userId, userId));
    expect(second?.onboardedAt).toEqual(first?.onboardedAt);

    // Skipping later keeps the answers.
    expect(await caller.onboarding.skip()).toEqual(saved);
    expect((await caller.me.get()).onboarding).toEqual(saved);

    // Interests are optional and can be cleared.
    expect(
      await caller.onboarding.save({ intent: "customer", postalCode: "B3H 1A1" }),
    ).toMatchObject({ intent: "customer", interests: [], completed: true });
  });

  it("validates the welcome answers on the server", async () => {
    const { ctx } = await harness.signUp("pia@example.com", "Pia", { verify: false });
    const caller = createCaller(ctx);

    const outside = await trpcError(
      caller.onboarding.save({ intent: "customer", postalCode: "M5V 2T6" }),
    );
    expect(outside.code).toBe("BAD_REQUEST");
    expect(outside.message).toContain(OUTSIDE_LAUNCH_REGION_MESSAGE);

    for (const input of [
      { intent: "landlord", postalCode: "B3H 1A1" },
      { intent: "customer", postalCode: "B3H 1A1", interests: ["moon-landing"] },
      { intent: "customer", postalCode: "B3H 1A1", interests: ["lawn-mowing", "lawn-mowing"] },
    ]) {
      expect((await trpcError(caller.onboarding.save(input as never))).code).toBe("BAD_REQUEST");
    }
    expect((await caller.me.get()).onboarding.completed).toBe(false);
  });

  it("lets the welcome be skipped before it is answered", async () => {
    const { ctx } = await harness.signUp("quinn@example.com", "Quinn", { verify: false });
    const caller = createCaller(ctx);
    expect(await caller.onboarding.skip()).toEqual({
      intent: null,
      postalCode: "B3H 1A1",
      interests: [],
      completed: true,
    });
    expect((await caller.me.get()).onboarding.completed).toBe(true);
  });

  it("records and withdraws marketing consent with version, time and audit entries", async () => {
    const { ctx, userId } = await harness.signUp("rui@example.com", "Rui", { verify: false });
    const caller = createCaller(ctx);
    const consentAudit = () =>
      harness.db
        .select({ action: auditLog.action, data: auditLog.data })
        .from(auditLog)
        .where(and(eq(auditLog.entity, "user"), eq(auditLog.entityId, userId)))
        .orderBy(auditLog.createdAt);

    const granted = await caller.profile.setMarketingConsent({ consent: true });
    expect(granted).toEqual({
      consented: true,
      version: MARKETING_CONSENT_VERSION,
      at: expect.any(Date),
      outdated: false,
    });

    // Repeating it keeps the original record.
    expect(await caller.profile.setMarketingConsent({ consent: true })).toEqual(granted);
    expect((await caller.me.get()).marketingConsent).toEqual(granted);

    const withdrawn = await caller.profile.setMarketingConsent({ consent: false });
    expect(withdrawn).toEqual({ consented: false, version: null, at: null, outdated: false });
    expect(await caller.profile.setMarketingConsent({ consent: false })).toEqual(withdrawn);
    const [profile] = await harness.db.select().from(profiles).where(eq(profiles.userId, userId));
    expect(profile).toMatchObject({ marketingConsentAt: null, marketingConsentVersion: null });

    expect(await consentAudit()).toEqual([
      {
        action: "marketing_consent.granted",
        data: { version: MARKETING_CONSENT_VERSION, source: "settings" },
      },
      {
        action: "marketing_consent.withdrawn",
        data: { previousVersion: MARKETING_CONSENT_VERSION, source: "settings" },
      },
    ]);

    expect(
      (await trpcError(caller.profile.setMarketingConsent({ consent: "yes" } as never))).code,
    ).toBe("BAD_REQUEST");
  });

  it("flags consent given to older wording", async () => {
    const { ctx, userId } = await harness.signUp("sol@example.com", "Sol", { verify: false });
    const at = new Date("2026-01-01T12:00:00Z");
    await harness.db
      .update(profiles)
      .set({ marketingConsentAt: at, marketingConsentVersion: "2025-01-v0" })
      .where(eq(profiles.userId, userId));
    const caller = createCaller(ctx);
    expect((await caller.me.get()).marketingConsent).toEqual({
      consented: true,
      version: "2025-01-v0",
      at,
      outdated: true,
    });
    // Agreeing again records the current wording.
    expect(await caller.profile.setMarketingConsent({ consent: true })).toMatchObject({
      version: MARKETING_CONSENT_VERSION,
      outdated: false,
    });
  });
});
