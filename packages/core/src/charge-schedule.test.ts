import { describe, expect, it } from "vitest";
import {
  PAYOUT_TIME_ZONE,
  RECURRING_CHARGE_DAYS_BEFORE,
  chargeAtFor,
  payoutBatchFor,
  payoutBatchOn,
} from "./charge-schedule.ts";
import { fromLocal, toLocal } from "./time.ts";

const TORONTO = "America/Toronto";
const HOUR = 3_600_000;

describe("chargeAtFor", () => {
  it("one-off: charges at booking confirmation", () => {
    const confirmedAt = new Date("2026-10-21T15:00:00Z");
    const chargeAt = chargeAtFor({ kind: "one_off", confirmedAt });
    expect(chargeAt).toEqual(confirmedAt);
    expect(chargeAt).not.toBe(confirmedAt);
  });

  it("recurring: 3 days before the visit at the same local time", () => {
    expect(RECURRING_CHARGE_DAYS_BEFORE).toBe(3);
    const visit = fromLocal({ year: 2026, month: 10, day: 23, hour: 9 }, TORONTO);
    expect(chargeAtFor({ kind: "recurring_visit", visitStartsAt: visit }).toISOString()).toBe(
      "2026-10-20T13:00:00.000Z",
    );
  });

  it("recurring: keeps local time across spring forward", () => {
    const visit = fromLocal({ year: 2026, month: 3, day: 10, hour: 9 }, TORONTO); // EDT
    const chargeAt = chargeAtFor({ kind: "recurring_visit", visitStartsAt: visit });
    expect(chargeAt.toISOString()).toBe("2026-03-07T14:00:00.000Z"); // 09:00 EST
    expect(visit.getTime() - chargeAt.getTime()).toBe(71 * HOUR);
  });

  it("recurring: keeps local time across fall back", () => {
    const visit = fromLocal({ year: 2026, month: 11, day: 3, hour: 9 }, TORONTO); // EST
    const chargeAt = chargeAtFor({ kind: "recurring_visit", visitStartsAt: visit });
    expect(chargeAt.toISOString()).toBe("2026-10-31T13:00:00.000Z"); // 09:00 EDT
    expect(visit.getTime() - chargeAt.getTime()).toBe(73 * HOUR);
  });

  it("recurring: uses the job's zone", () => {
    const visit = new Date("2026-03-10T16:00:00Z"); // 09:00 PDT in Vancouver
    const chargeAt = chargeAtFor({
      kind: "recurring_visit",
      visitStartsAt: visit,
      timeZone: "America/Vancouver",
    });
    expect(chargeAt.toISOString()).toBe("2026-03-07T17:00:00.000Z"); // 09:00 PST
  });

  it("recurring: charges immediately when confirmed inside the 3-day window", () => {
    const visit = new Date("2026-10-23T13:00:00Z");
    const confirmedAt = new Date("2026-10-21T18:00:00Z");
    expect(chargeAtFor({ kind: "recurring_visit", visitStartsAt: visit, confirmedAt })).toEqual(
      confirmedAt,
    );
    const early = new Date("2026-10-01T18:00:00Z");
    expect(
      chargeAtFor({ kind: "recurring_visit", visitStartsAt: visit, confirmedAt: early }).toISOString(),
    ).toBe("2026-10-20T13:00:00.000Z");
  });

  it("snow contract: charges when the customer confirms", () => {
    const markedCompleteAt = new Date("2026-12-10T15:00:00Z");
    const customerConfirmedAt = new Date("2026-12-10T20:00:00Z");
    expect(
      chargeAtFor({ kind: "snow_contract_visit", markedCompleteAt, customerConfirmedAt }),
    ).toEqual(customerConfirmedAt);
  });

  it("snow contract: otherwise charges at the 48h auto-confirm", () => {
    const markedCompleteAt = new Date("2026-12-10T15:00:00Z");
    const auto = "2026-12-12T15:00:00.000Z";
    expect(chargeAtFor({ kind: "snow_contract_visit", markedCompleteAt }).toISOString()).toBe(auto);
    expect(
      chargeAtFor({
        kind: "snow_contract_visit",
        markedCompleteAt,
        customerConfirmedAt: null,
      }).toISOString(),
    ).toBe(auto);
    // A confirmation recorded after the auto-confirm does not delay the charge.
    expect(
      chargeAtFor({
        kind: "snow_contract_visit",
        markedCompleteAt,
        customerConfirmedAt: new Date("2026-12-13T00:00:00Z"),
      }).toISOString(),
    ).toBe(auto);
  });

  it("rejects invalid dates", () => {
    expect(() => chargeAtFor({ kind: "one_off", confirmedAt: new Date("x") })).toThrow(RangeError);
    expect(() =>
      chargeAtFor({ kind: "recurring_visit", visitStartsAt: new Date(Number.NaN) }),
    ).toThrow(RangeError);
    expect(() =>
      chargeAtFor({
        kind: "recurring_visit",
        visitStartsAt: new Date(),
        confirmedAt: new Date("x"),
      }),
    ).toThrow(RangeError);
    expect(() =>
      chargeAtFor({ kind: "snow_contract_visit", markedCompleteAt: new Date("x") }),
    ).toThrow(RangeError);
  });
});

describe("payoutBatchFor", () => {
  it("pays Sunday 23:59:59.999 local on the next day (Monday)", () => {
    const sundayNight = fromLocal(
      { year: 2026, month: 10, day: 18, hour: 23, minute: 59, second: 59, millisecond: 999 },
      TORONTO,
    );
    expect(payoutBatchFor(sundayNight)).toEqual({
      payoutDate: "2026-10-19",
      confirmedFrom: new Date("2026-10-12T04:00:00.000Z"),
      cutoffAt: new Date("2026-10-19T04:00:00.000Z"),
    });
  });

  it("pays a confirmation at Monday 00:00 local the following Monday", () => {
    const mondayMidnight = fromLocal({ year: 2026, month: 10, day: 19 }, TORONTO);
    expect(payoutBatchFor(mondayMidnight).payoutDate).toBe("2026-10-26");
  });

  it.each([
    ["2026-10-19", "2026-10-26"], // Monday
    ["2026-10-20", "2026-10-26"], // Tuesday
    ["2026-10-21", "2026-10-26"], // Wednesday
    ["2026-10-24", "2026-10-26"], // Saturday
    ["2026-10-25", "2026-10-26"], // Sunday
  ])("confirmed on %s at noon -> paid %s", (date, payoutDate) => {
    const [year, month, day] = date.split("-").map(Number) as [number, number, number];
    expect(payoutBatchFor(fromLocal({ year, month, day, hour: 12 }, TORONTO)).payoutDate).toBe(
      payoutDate,
    );
  });

  it("uses Toronto local time, not UTC", () => {
    expect(PAYOUT_TIME_ZONE).toBe(TORONTO);
    // Monday 02:00 UTC is still Sunday 22:00 in Toronto.
    expect(payoutBatchFor(new Date("2026-10-19T02:00:00Z")).payoutDate).toBe("2026-10-19");
  });

  it("handles a batch week containing the fall-back change", () => {
    const batch = payoutBatchFor(new Date("2026-10-30T12:00:00Z"));
    expect(batch.payoutDate).toBe("2026-11-02");
    expect(batch.confirmedFrom.toISOString()).toBe("2026-10-26T04:00:00.000Z"); // EDT
    expect(batch.cutoffAt.toISOString()).toBe("2026-11-02T05:00:00.000Z"); // EST
  });

  it("always lands on a Monday whose window contains the confirmation", () => {
    const start = new Date("2026-02-25T00:00:00Z").getTime();
    for (let t = start; t < start + 21 * 24 * HOUR; t += 37 * 60_000 * 7) {
      const confirmedAt = new Date(t);
      const batch = payoutBatchFor(confirmedAt);
      expect(toLocal(batch.cutoffAt, TORONTO)).toMatchObject({ weekday: 1, hour: 0, minute: 0 });
      expect(batch.confirmedFrom.getTime()).toBeLessThanOrEqual(t);
      expect(batch.cutoffAt.getTime()).toBeGreaterThan(t);
    }
  });

  it("rejects an invalid date", () => {
    expect(() => payoutBatchFor(new Date("x"))).toThrow(RangeError);
  });
});

describe("payoutBatchOn", () => {
  it("returns the confirmation window for a Monday", () => {
    expect(payoutBatchOn("2026-03-09")).toEqual({
      payoutDate: "2026-03-09",
      confirmedFrom: new Date("2026-03-02T05:00:00.000Z"), // EST
      cutoffAt: new Date("2026-03-09T04:00:00.000Z"), // EDT
    });
  });

  it("agrees with payoutBatchFor", () => {
    const at = new Date("2026-10-21T15:00:00Z");
    const batch = payoutBatchFor(at);
    expect(payoutBatchOn(batch.payoutDate)).toEqual(batch);
  });

  it("rejects non-Mondays and malformed dates", () => {
    expect(() => payoutBatchOn("2026-10-20")).toThrow(/Monday/);
    expect(() => payoutBatchOn("2026-13-01")).toThrow(RangeError);
    expect(() => payoutBatchOn("next monday")).toThrow(RangeError);
  });
});
