import { describe, expect, it } from "vitest";
import {
  businessProfileSchema,
  formatDurationMinutes,
  LISTING_ABOUT_MIN_LENGTH,
  listingReadiness,
  normalizeGstHstNumber,
  SERVICE_DURATION_CHOICES,
  SERVICE_DURATION_MAX_MINUTES,
  SERVICE_DURATION_MIN_MINUTES,
  serviceAreaInputSchema,
  serviceInputSchema,
} from "./listing.ts";

const readyFacts = {
  verified: true,
  suspended: false,
  name: "Evergreen Yardworks",
  description: "x".repeat(LISTING_ABOUT_MIN_LENGTH),
  hasServiceArea: true,
  activeServices: 1,
};

describe("listingReadiness", () => {
  it("is ready when every requirement is met", () => {
    expect(listingReadiness(readyFacts)).toEqual({ ready: true, missing: [] });
  });

  it("lists what is missing, in order", () => {
    expect(
      listingReadiness({
        verified: false,
        suspended: true,
        name: " ",
        description: "short",
        hasServiceArea: false,
        activeServices: 0,
      }).missing,
    ).toEqual(["not_suspended", "verify_contact", "name", "about", "service_area", "services"]);
  });

  it("counts the about text after trimming", () => {
    const padded = ` ${"x".repeat(LISTING_ABOUT_MIN_LENGTH - 1)}   `;
    expect(listingReadiness({ ...readyFacts, description: padded }).missing).toEqual(["about"]);
  });
});

describe("normalizeGstHstNumber", () => {
  it("accepts spaced and dashed numbers", () => {
    expect(normalizeGstHstNumber("123456789 RT 0001")).toBe("123456789RT0001");
    expect(normalizeGstHstNumber("123456789-rt-0001")).toBe("123456789RT0001");
    expect(normalizeGstHstNumber("12345678RT0001")).toBeNull();
    expect(normalizeGstHstNumber("123456789RC0001")).toBeNull();
  });
});

describe("businessProfileSchema", () => {
  const valid = {
    name: "  Evergreen Yardworks ",
    description: "Lawn care in Halifax.\nFamily run since 2019.",
    gstHstNumber: "",
    cancellationPolicy: "flexible",
    instantBook: true,
  } as const;

  it("trims and treats an empty GST/HST number as not registered", () => {
    expect(businessProfileSchema.parse(valid)).toMatchObject({
      name: "Evergreen Yardworks",
      gstHstNumber: null,
    });
  });

  it("validates the GST/HST number and policy", () => {
    expect(
      businessProfileSchema.parse({ ...valid, gstHstNumber: "123456789 rt 0001" }).gstHstNumber,
    ).toBe("123456789RT0001");
    expect(businessProfileSchema.safeParse({ ...valid, gstHstNumber: "nope" }).success).toBe(false);
    expect(
      businessProfileSchema.safeParse({ ...valid, cancellationPolicy: "lenient" }).success,
    ).toBe(false);
  });

  it("rejects control characters but keeps line breaks in the about text", () => {
    expect(businessProfileSchema.safeParse({ ...valid, name: "Bad\u0007Name" }).success).toBe(
      false,
    );
    expect(businessProfileSchema.safeParse({ ...valid, description: "a\u0000b" }).success).toBe(
      false,
    );
  });
});

describe("serviceAreaInputSchema", () => {
  it("needs a Nova Scotia pin and a 1–100 km whole radius", () => {
    const halifax = { lat: 44.6488, lng: -63.5752 };
    expect(serviceAreaInputSchema.safeParse({ center: halifax, radiusKm: 25 }).success).toBe(true);
    expect(serviceAreaInputSchema.safeParse({ center: halifax, radiusKm: 0 }).success).toBe(false);
    expect(serviceAreaInputSchema.safeParse({ center: halifax, radiusKm: 101 }).success).toBe(
      false,
    );
    expect(serviceAreaInputSchema.safeParse({ center: halifax, radiusKm: 2.5 }).success).toBe(
      false,
    );
    expect(
      serviceAreaInputSchema.safeParse({ center: { lat: 43.65, lng: -79.38 }, radiusKm: 10 })
        .success,
    ).toBe(false);
  });
});

describe("serviceInputSchema", () => {
  const fixed = {
    categorySlug: "lawn-mowing",
    title: "Standard lawn mow",
    description: "",
    pricingType: "fixed",
    priceCents: 6000,
    fromPriceCents: null,
    durationMinutes: 45,
    instantBook: true,
    active: true,
  } as const;

  it("accepts a fixed-price service", () => {
    expect(serviceInputSchema.safeParse(fixed).success).toBe(true);
  });

  it("needs a price for fixed services and no from-price", () => {
    expect(serviceInputSchema.safeParse({ ...fixed, priceCents: null }).success).toBe(false);
    expect(serviceInputSchema.safeParse({ ...fixed, fromPriceCents: 4000 }).success).toBe(false);
  });

  it("forbids a fixed price and Instant Book on quote services", () => {
    const quote = { ...fixed, pricingType: "quote", priceCents: null, instantBook: false } as const;
    expect(serviceInputSchema.safeParse(quote).success).toBe(true);
    expect(serviceInputSchema.safeParse({ ...quote, fromPriceCents: 4500 }).success).toBe(true);
    expect(serviceInputSchema.safeParse({ ...quote, priceCents: 6000 }).success).toBe(false);
    expect(serviceInputSchema.safeParse({ ...quote, instantBook: true }).success).toBe(false);
  });

  it("checks bounds on price and duration", () => {
    expect(serviceInputSchema.safeParse({ ...fixed, priceCents: 50 }).success).toBe(false);
    expect(serviceInputSchema.safeParse({ ...fixed, priceCents: 60.5 }).success).toBe(false);
    expect(serviceInputSchema.safeParse({ ...fixed, durationMinutes: 10 }).success).toBe(false);
    expect(serviceInputSchema.safeParse({ ...fixed, durationMinutes: 2000 }).success).toBe(false);
  });
});

describe("formatDurationMinutes", () => {
  it("reads like a person would say it", () => {
    expect(formatDurationMinutes(45)).toBe("45 min");
    expect(formatDurationMinutes(60)).toBe("1 hr");
    expect(formatDurationMinutes(90)).toBe("1 hr 30 min");
    expect(formatDurationMinutes(1440)).toBe("24 hr");
  });

  it("offers only valid choices", () => {
    for (const minutes of SERVICE_DURATION_CHOICES) {
      expect(minutes).toBeGreaterThanOrEqual(SERVICE_DURATION_MIN_MINUTES);
      expect(minutes).toBeLessThanOrEqual(SERVICE_DURATION_MAX_MINUTES);
    }
  });
});
