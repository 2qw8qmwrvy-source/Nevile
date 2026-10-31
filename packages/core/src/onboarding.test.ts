import { describe, expect, it } from "vitest";
import { CATEGORY_SLUGS } from "./categories.ts";
import {
  MARKETING_CONSENT_SENDER,
  MARKETING_CONSENT_STATEMENT,
  MARKETING_CONSENT_TEXT,
  MARKETING_CONSENT_VERSION,
  ONBOARDING_INTENTS,
  ONBOARDING_MAX_INTERESTS,
  onboardingSchema,
} from "./onboarding.ts";

describe("onboardingSchema", () => {
  const valid = { intent: "customer", postalCode: "b3h4r2", interests: ["lawn-mowing"] };

  it("lists the welcome intents (SPEC §16)", () => {
    expect(ONBOARDING_INTENTS).toEqual(["customer", "business", "both"]);
  });

  it.each(ONBOARDING_INTENTS)("accepts intent %s and normalizes the postal code", (intent) => {
    expect(onboardingSchema.parse({ ...valid, intent })).toEqual({
      intent,
      postalCode: "B3H 4R2",
      interests: ["lawn-mowing"],
    });
  });

  it("defaults interests to none", () => {
    expect(onboardingSchema.parse({ intent: "both", postalCode: "B3H 4R2" })).toEqual({
      intent: "both",
      postalCode: "B3H 4R2",
      interests: [],
    });
    expect(onboardingSchema.parse({ ...valid, interests: [] }).interests).toEqual([]);
  });

  it("accepts up to every category once", () => {
    expect(ONBOARDING_MAX_INTERESTS).toBe(8);
    expect(onboardingSchema.parse({ ...valid, interests: [...CATEGORY_SLUGS] }).interests).toEqual([
      ...CATEGORY_SLUGS,
    ]);
  });

  it("rejects duplicate interests", () => {
    const result = onboardingSchema.safeParse({
      ...valid,
      interests: ["lawn-mowing", "lawn-mowing"],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Choose each service only once");
  });

  it("rejects more than 8 interests", () => {
    const nine = [...CATEGORY_SLUGS, "lawn-mowing"];
    expect(onboardingSchema.safeParse({ ...valid, interests: nine }).success).toBe(false);
  });

  it("rejects postal codes outside Nova Scotia with the launch message", () => {
    const result = onboardingSchema.safeParse({ ...valid, postalCode: "M5V 3L9" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["postalCode"]);
    expect(result.error?.issues[0]?.message).toBe("Nevile is only in Nova Scotia for now.");
  });

  it.each([
    { ...valid, intent: "admin" },
    { ...valid, intent: undefined },
    { ...valid, postalCode: "" },
    { ...valid, postalCode: undefined },
    { ...valid, interests: ["plumbing"] },
    { ...valid, interests: "lawn-mowing" },
    null,
  ])("rejects %o", (input) => {
    expect(onboardingSchema.safeParse(input).success).toBe(false);
  });
});

describe("marketing consent (SPEC §17, CASL)", () => {
  it("has a version to record with the timestamp", () => {
    expect(MARKETING_CONSENT_VERSION).toBe("2026-10-v1");
  });

  it("states what is sent, how to unsubscribe, and who is asking", () => {
    expect(MARKETING_CONSENT_STATEMENT).toBe(
      "Send me tips, seasonal reminders and Nevile news by email. You can unsubscribe at any time.",
    );
    expect(MARKETING_CONSENT_SENDER).toBe("Nevile, Nova Scotia");
    expect(MARKETING_CONSENT_TEXT).toBe(
      "Send me tips, seasonal reminders and Nevile news by email. You can unsubscribe at any time.\nNevile, Nova Scotia",
    );
  });
});
