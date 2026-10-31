import { describe, expect, it } from "vitest";

import {
  CHARGE_RETRY,
  instalmentChargeAt,
  lateSkipCharge,
  monthsSpanned,
  nextChargeRetryAt,
  periodReleaseAt,
  recurringPaymentDeadline,
  recurringRequestSchema,
  seasonEndActions,
  seasonPaymentFor,
  seasonPeriods,
  seriesLastAllowedDate,
  snowContractTermsSchema,
  snowSignupSchema,
  splitEvenly,
  visitReminderAt,
} from "./ongoing.ts";
import { occurrenceDates } from "./recurrence.ts";

const address = { line1: "12 Example Lane", line2: "", city: "Halifax", postalCode: "B3H 4R2" };
const request = {
  serviceId: "00000000-0000-4000-8000-000000000001",
  frequency: "weekly" as const,
  date: "2027-05-04",
  windowStart: 540,
  endDate: "2027-09-28",
  address,
  notes: "",
};
const terms = {
  triggerCm: 5,
  seasonStart: "2026-11-15",
  seasonEnd: "2027-03-31",
  pricing: "per_visit" as const,
  priceCents: 4500,
  seasonBilling: null,
};
const paid = { priceCents: 12_000, serviceFeeCents: 795, taxOnPriceCents: 0, taxOnFeeCents: 119 };

describe("recurring series (SPEC §21)", () => {
  it("runs up to 6 months, clamped like a monthly series", () => {
    expect(seriesLastAllowedDate({ year: 2027, month: 8, day: 31 })).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
    expect(recurringRequestSchema.safeParse(request).success).toBe(true);
    const tooLong = recurringRequestSchema.safeParse({ ...request, endDate: "2027-11-05" });
    expect(tooLong.error?.issues[0]?.message).toBe("A series can run up to 6 months");
    const backwards = recurringRequestSchema.safeParse({ ...request, endDate: "2027-05-01" });
    expect(backwards.error?.issues[0]?.path).toEqual(["endDate"]);
  });

  it("allows one skip or window change per date", () => {
    const twice = recurringRequestSchema.safeParse({
      ...request,
      overrides: [
        { date: "2027-06-15", windowStart: null },
        { date: "2027-06-15", windowStart: 780 },
      ],
    });
    expect(twice.error?.issues[0]?.message).toBe("One change per date");
  });

  it("lists the visit dates in the range", () => {
    const dates = occurrenceDates(
      "biweekly",
      { year: 2027, month: 5, day: 4 },
      { year: 2027, month: 6, day: 15 },
    );
    expect(dates.map((d) => `${d.month}/${d.day}`)).toEqual(["5/4", "5/18", "6/1", "6/15"]);
  });

  it("charges a late skip of an unpaid visit what the policy keeps", () => {
    const visitStartsAt = new Date("2027-06-15T13:00:00Z");
    const amounts = {
      priceCents: 6000,
      serviceFeeCents: 397,
      taxOnPriceCents: 0,
      taxOnFeeCents: 60,
    };
    const early = new Date("2027-06-14T10:00:00Z"); // 27h before: free under Flexible
    expect(
      lateSkipCharge({ policy: "flexible", visitStartsAt, skippedAt: early, amounts }),
    ).toBeNull();
    const late = new Date("2027-06-15T03:00:00Z"); // 10h before
    expect(lateSkipCharge({ policy: "flexible", visitStartsAt, skippedAt: late, amounts })).toEqual(
      {
        priceCents: 3000,
        taxOnPriceCents: 0,
        serviceFeeCents: 397,
        taxOnFeeCents: 60,
      },
    );
    // Strict keeps everything inside 7 days, though the visit isn't charged until 3 days before.
    const fiveDays = new Date("2027-06-10T13:00:00Z");
    expect(
      lateSkipCharge({ policy: "strict", visitStartsAt, skippedAt: fiveDays, amounts })?.priceCents,
    ).toBe(6000);
  });

  it("reminds the day before at 5 pm, and gives up on payment 24 hours before", () => {
    const visit = new Date("2026-11-10T13:00:00Z"); // 9 am in Halifax
    expect(visitReminderAt(visit).toISOString()).toBe("2026-11-09T21:00:00.000Z");
    expect(recurringPaymentDeadline(visit).toISOString()).toBe("2026-11-09T13:00:00.000Z");
  });
});

describe("snow contracts (SPEC §21)", () => {
  it("validates terms", () => {
    expect(snowContractTermsSchema.safeParse(terms).success).toBe(true);
    const long = snowContractTermsSchema.safeParse({ ...terms, seasonEnd: "2027-06-30" });
    expect(long.error?.issues[0]?.message).toBe("A season covers at most 7 months");
    const noPlan = snowContractTermsSchema.safeParse({ ...terms, pricing: "season" });
    expect(noPlan.error?.issues[0]?.path).toEqual(["seasonBilling"]);
    const planForVisits = snowContractTermsSchema.safeParse({ ...terms, seasonBilling: "monthly" });
    expect(planForVisits.success).toBe(false);
    expect(
      monthsSpanned({ year: 2026, month: 11, day: 15 }, { year: 2027, month: 3, day: 31 }),
    ).toBe(5);
  });

  it("needs the customer to agree, and a plan when the business offers either", () => {
    const signup = { serviceId: request.serviceId, address, notes: "" };
    expect(snowSignupSchema.safeParse({ ...signup, agreed: false }).success).toBe(false);
    expect(snowSignupSchema.parse({ ...signup, agreed: true }).seasonPayment).toBeNull();
    expect(seasonPaymentFor("either", "monthly")).toBe("monthly");
    expect(seasonPaymentFor("upfront", "monthly")).toBe("upfront");
    expect(seasonPaymentFor("either", null)).toBeNull();
  });

  it("splits a season into calendar months and the price evenly", () => {
    const periods = seasonPeriods("2026-11-15", "2027-03-31");
    expect(periods.map((p) => [p.start, p.end, p.days])).toEqual([
      ["2026-11-15", "2026-11-30", 16],
      ["2026-12-01", "2026-12-31", 31],
      ["2027-01-01", "2027-01-31", 31],
      ["2027-02-01", "2027-02-28", 28],
      ["2027-03-01", "2027-03-31", 31],
    ]);
    expect(splitEvenly(60_000, 5)).toEqual([12_000, 12_000, 12_000, 12_000, 12_000]);
    expect(splitEvenly(1000, 3)).toEqual([334, 333, 333]);
  });

  it("charges instalments at acceptance or 9 am on the 1st, and pays out after each month", () => {
    const acceptedAt = new Date("2026-11-03T15:00:00Z");
    const [first, , third] = seasonPeriods("2026-11-15", "2027-03-31");
    if (!first || !third) throw new Error("no periods");
    expect(instalmentChargeAt({ payment: "monthly", period: first, acceptedAt })).toEqual(
      acceptedAt,
    );
    expect(
      instalmentChargeAt({ payment: "monthly", period: third, acceptedAt }).toISOString(),
    ).toBe("2027-01-01T13:00:00.000Z");
    expect(instalmentChargeAt({ payment: "upfront", period: third, acceptedAt })).toEqual(
      acceptedAt,
    );
    expect(periodReleaseAt("2026-11-30").toISOString()).toBe("2026-12-01T04:00:00.000Z");
  });

  it("refunds what's unused when a season contract ends early", () => {
    const periods = seasonPeriods("2026-11-15", "2027-03-31");
    const monthly = periods.map((p) => ({ ...p, paid: p.sequence <= 3 ? paid : null }));
    expect(
      seasonEndActions({ by: "customer", endedOn: "2027-01-10", periods: monthly }).map(
        (a) => a.action,
      ),
    ).toEqual(["keep", "keep", "keep", "cancel_charge", "cancel_charge"]);

    const upfront = periods.map((p) => ({ ...p, paid }));
    const byBusiness = seasonEndActions({
      by: "business",
      endedOn: "2027-01-10",
      periods: upfront,
    });
    expect(byBusiness.map((a) => a.action)).toEqual(["keep", "keep", "refund", "refund", "refund"]);
    const january = byBusiness[2];
    // Jan 10–31: 22 of 31 days, service fee included.
    expect(january?.action === "refund" && january.refund).toMatchObject({
      priceRefundCents: 8516,
      serviceFeeRefundCents: 564,
      taxOnFeeRefundCents: 84,
      retainedPriceCents: 3484,
      businessFeeCents: 105,
    });
    const february = byBusiness[3];
    expect(february?.action === "refund" && february.refund.totalRefundCents).toBe(12_914);
    // A customer's unpaid current month is still owed.
    const failed = periods.map((p) => ({ ...p, paid: p.sequence <= 2 ? paid : null }));
    expect(seasonEndActions({ by: "customer", endedOn: "2027-01-10", periods: failed })[2]).toEqual(
      {
        sequence: 3,
        action: "still_due",
      },
    );
  });
});

describe("failed charges (SPEC §21)", () => {
  it("retries daily three times, then stops", () => {
    const first = new Date("2027-01-01T13:00:00Z");
    expect(nextChargeRetryAt(first, 1)?.toISOString()).toBe("2027-01-02T13:00:00.000Z");
    expect(nextChargeRetryAt(first, CHARGE_RETRY.retries)?.toISOString()).toBe(
      "2027-01-04T13:00:00.000Z",
    );
    expect(nextChargeRetryAt(first, CHARGE_RETRY.retries + 1)).toBeNull();
  });
});
