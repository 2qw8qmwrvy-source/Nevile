import { describe, expect, it } from "vitest";
import {
  CANADIAN_AREA_CODES,
  normalizeCanadianPhone,
  normalizePostalCode,
} from "./contact-formats.ts";
import {
  canadianPhoneSchema,
  cancellationPolicySchema,
  emailSchema,
  MAX_MONEY_INPUT_CENTS,
  moneyInputSchema,
  PRICING_TYPES,
  passwordSchema,
  postalCodeSchema,
  pricingTypeSchema,
  provinceCodeSchema,
  recurrenceFrequencySchema,
} from "./schemas.ts";

describe("emailSchema", () => {
  it("trims and lower-cases", () => {
    expect(emailSchema.parse("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
  });

  it.each(["", "jane", "jane@", "@example.com", "jane@example", "jane doe@example.com", 42])(
    "rejects %s",
    (value) => {
      expect(emailSchema.safeParse(value).success).toBe(false);
    },
  );

  it("rejects addresses longer than 254 characters", () => {
    const long = `${"a".repeat(64)}@${"b".repeat(185)}.com`; // 254 characters
    expect(long).toHaveLength(254);
    expect(emailSchema.safeParse(long).success).toBe(true);
    expect(emailSchema.safeParse(`a${long}`).success).toBe(false);
  });
});

describe("passwordSchema", () => {
  it("enforces 10–128 characters", () => {
    expect(passwordSchema.safeParse("a".repeat(9)).success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(10)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(128)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(129)).success).toBe(false);
  });

  it("does not trim", () => {
    expect(passwordSchema.parse("  secret pass  ")).toBe("  secret pass  ");
    expect(passwordSchema.safeParse("   short  ").success).toBe(true);
  });

  it("rejects non-strings", () => {
    expect(passwordSchema.safeParse(1234567890).success).toBe(false);
  });
});

describe("canadianPhoneSchema", () => {
  it.each([
    "4165551234",
    "416-555-1234",
    "416.555.1234",
    "416 555 1234",
    "(416) 555-1234",
    "1 416 555 1234",
    "1-416-555-1234",
    "14165551234",
    "+14165551234",
    "+1 (416) 555-1234",
    " +1 416 555 1234 ",
  ])("normalizes %s to E.164", (input) => {
    expect(canadianPhoneSchema.parse(input)).toBe("+14165551234");
    expect(normalizeCanadianPhone(input)).toBe("+14165551234");
  });

  it("accepts every Canadian area code, including the newest overlays", () => {
    expect(CANADIAN_AREA_CODES.size).toBeGreaterThan(50);
    for (const area of CANADIAN_AREA_CODES) {
      expect(area).toMatch(/^[2-9]\d{2}$/);
      expect(normalizeCanadianPhone(`${area}5550123`)).toBe(`+1${area}5550123`);
    }
    for (const area of ["942", "753", "584", "474", "257", "368", "867", "879"]) {
      expect(CANADIAN_AREA_CODES.has(area)).toBe(true);
    }
  });

  it.each([
    "555-1234", // no area code
    "123-456-7890", // area code starts with 1
    "016-555-1234", // area code starts with 0
    "416-155-1234", // exchange starts with 1
    "911-555-1234", // N11 area code
    "416-411-1234", // N11 exchange
    "+44 20 7946 0958", // not +1
    "+2 416 555 1234",
    "24165551234", // 11 digits not starting with 1
    "416555123", // 9 digits
    "41655512345", // 11 digits, no country code
    "416-555-CALL",
    "",
    "+18765551234", // Jamaica
    "+18095550123", // Dominican Republic
    "+12845551234", // British Virgin Islands
    "+19005551234", // premium-rate 900
    "+19765551234", // premium-rate 976
    "+18005551234", // toll-free
    "+16005551234", // Canadian non-geographic
    "+12125551234", // United States
  ])("rejects %s", (input) => {
    expect(canadianPhoneSchema.safeParse(input).success).toBe(false);
    expect(normalizeCanadianPhone(input)).toBeNull();
  });
});

describe("postalCodeSchema", () => {
  it.each([
    ["M5V 3L9", "M5V 3L9"],
    ["m5v3l9", "M5V 3L9"],
    ["M5V-3L9", "M5V 3L9"],
    ["  k1a 0b1 ", "K1A 0B1"],
    ["H2X  1Y4", "H2X 1Y4"],
    ["T2P 2V7", "T2P 2V7"],
    ["X0A 0H0", "X0A 0H0"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(postalCodeSchema.parse(input)).toBe(expected);
    expect(normalizePostalCode(input)).toBe(expected);
  });

  it.each([
    "D1A 1A1", // D never used
    "W1A 1A1", // W never first
    "Z1A 1A1", // Z never first
    "M5V 3O9", // O never used
    "M5U 3L9", // U never used
    "M5V 3L", // too short
    "M5V 3L99",
    "12345",
    "90210-1234",
    "",
  ])("rejects %s", (input) => {
    expect(postalCodeSchema.safeParse(input).success).toBe(false);
    expect(normalizePostalCode(input)).toBeNull();
  });
});

describe("provinceCodeSchema", () => {
  it("accepts codes case-insensitively and outputs the canonical code", () => {
    expect(provinceCodeSchema.parse("ON")).toBe("ON");
    expect(provinceCodeSchema.parse(" qc ")).toBe("QC");
  });

  it.each(["XX", "Ontario", "", "U.S."])("rejects %s", (input) => {
    expect(provinceCodeSchema.safeParse(input).success).toBe(false);
  });
});

describe("enums", () => {
  it("pricing type", () => {
    expect(PRICING_TYPES).toEqual(["fixed", "quote"]);
    expect(pricingTypeSchema.parse("quote")).toBe("quote");
    expect(pricingTypeSchema.safeParse("hourly").success).toBe(false);
  });

  it("cancellation policy", () => {
    for (const id of ["flexible", "moderate", "strict"]) {
      expect(cancellationPolicySchema.parse(id)).toBe(id);
    }
    expect(cancellationPolicySchema.safeParse("Flexible").success).toBe(false);
  });

  it("recurrence frequency", () => {
    for (const frequency of ["weekly", "biweekly", "monthly"]) {
      expect(recurrenceFrequencySchema.parse(frequency)).toBe(frequency);
    }
    expect(recurrenceFrequencySchema.safeParse("daily").success).toBe(false);
  });
});

describe("moneyInputSchema", () => {
  it.each([0, 1, 18000, MAX_MONEY_INPUT_CENTS])("accepts %s", (value) => {
    expect(moneyInputSchema.parse(value)).toBe(value);
  });

  it("caps at $100,000", () => {
    expect(MAX_MONEY_INPUT_CENTS).toBe(10_000_000);
    expect(moneyInputSchema.safeParse(MAX_MONEY_INPUT_CENTS + 1).success).toBe(false);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "100", null])("rejects %s", (value) => {
    expect(moneyInputSchema.safeParse(value).success).toBe(false);
  });

  it("explains why", () => {
    const result = moneyInputSchema.safeParse(-5);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Amount must not be negative");
  });
});
