import { describe, expect, it } from "vitest";
import { applyBookingEvent } from "./booking-lifecycle.ts";
import {
  chargeAtFor,
  PAYOUT_TIME_ZONE,
  payoutBatchFor,
  payoutBatchOn,
  RECURRING_CHARGE_DAYS_BEFORE,
} from "./charge-schedule.ts";
import { DEFAULT_TIME_ZONE, fromLocal, toLocal } from "./time.ts";

const HALIFAX = "America/Halifax";
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
    const visit = fromLocal({ year: 2026, month: 10, day: 23, hour: 9 }, HALIFAX);
    expect(chargeAtFor({ kind: "recurring_visit", visitStartsAt: visit }).toISOString()).toBe(
      "2026-10-20T12:00:00.000Z", // 09:00 ADT
    );
  });

  it("recurring: keeps local time across spring forward (Halifax, 2026-03-08)", () => {
    const visit = fromLocal({ year: 2026, month: 3, day: 10, hour: 9 }, HALIFAX); // ADT
    expect(visit.toISOString()).toBe("2026-03-10T12:00:00.000Z");
    const chargeAt = chargeAtFor({ kind: "recurring_visit", visitStartsAt: visit });
    expect(chargeAt.toISOString()).toBe("2026-03-07T13:00:00.000Z"); // 09:00 AST
    expect(visit.getTime() - chargeAt.getTime()).toBe(71 * HOUR);
  });

  it("recurring: keeps local time across fall back (Halifax, 2026-11-01)", () => {
    const visit = fromLocal({ year: 2026, month: 11, day: 3, hour: 9 }, HALIFAX); // AST
    expect(visit.toISOString()).toBe("2026-11-03T13:00:00.000Z");
    const chargeAt = chargeAtFor({ kind: "recurring_visit", visitStartsAt: visit });
    expect(chargeAt.toISOString()).toBe("2026-10-31T12:00:00.000Z"); // 09:00 ADT
    expect(visit.getTime() - chargeAt.getTime()).toBe(73 * HOUR);
  });

  it("recurring: defaults to the Halifax zone", () => {
    // 03:30 ADT on 03-11 in Halifax (02:30 EDT in Toronto). Three days earlier, 03:30 exists
    // in Halifax (just after its 02:00 jump), while Toronto's 02:30 falls in its own gap.
    const visit = new Date("2026-03-11T06:30:00Z");
    expect(chargeAtFor({ kind: "recurring_visit", visitStartsAt: visit }).toISOString()).toBe(
      "2026-03-08T06:30:00.000Z",
    );
    expect(
      chargeAtFor({
        kind: "recurring_visit",
        visitStartsAt: visit,
        timeZone: "America/Toronto",
      }).toISOString(),
    ).toBe("2026-03-08T07:30:00.000Z");
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
    const visit = new Date("2026-10-23T13:00:00Z"); // 10:00 ADT
    const confirmedAt = new Date("2026-10-21T18:00:00Z");
    expect(chargeAtFor({ kind: "recurring_visit", visitStartsAt: visit, confirmedAt })).toEqual(
      confirmedAt,
    );
    const early = new Date("2026-10-01T18:00:00Z");
    expect(
      chargeAtFor({
        kind: "recurring_visit",
        visitStartsAt: visit,
        confirmedAt: early,
      }).toISOString(),
    ).toBe("2026-10-20T13:00:00.000Z");
  });

  it("snow contract: charges when the visit is confirmed complete", () => {
    const confirmedAt = new Date("2026-12-10T20:00:00Z");
    expect(
      chargeAtFor({
        kind: "snow_contract_visit",
        visit: { state: "completed", enteredAt: confirmedAt },
      }),
    ).toEqual(confirmedAt);
  });

  it("snow contract: pending confirmation is due at the 48h auto-confirm", () => {
    const markedCompleteAt = new Date("2026-12-10T15:00:00Z");
    expect(
      chargeAtFor({
        kind: "snow_contract_visit",
        visit: { state: "completed_pending_confirmation", enteredAt: markedCompleteAt },
      })?.toISOString(),
    ).toBe("2026-12-12T15:00:00.000Z");
  });

  it("snow contract: never charges a disputed visit until it is resolved", () => {
    const markedCompleteAt = new Date("2026-12-10T15:00:00Z");
    let visit = applyBookingEvent(
      { state: "completed_pending_confirmation", enteredAt: markedCompleteAt },
      { type: "report_problem", at: new Date("2026-12-11T09:00:00Z") },
    );
    expect(chargeAtFor({ kind: "snow_contract_visit", visit })).toBeNull();
    visit = applyBookingEvent(visit, {
      type: "schedule_fix",
      at: new Date("2026-12-11T12:00:00Z"),
    });
    expect(chargeAtFor({ kind: "snow_contract_visit", visit })).toBeNull();
    // After the fix, the 48h auto-confirm restarts from the fix, not the first completion.
    visit = applyBookingEvent(visit, { type: "mark_fixed", at: new Date("2026-12-13T10:00:00Z") });
    expect(chargeAtFor({ kind: "snow_contract_visit", visit })?.toISOString()).toBe(
      "2026-12-15T10:00:00.000Z",
    );
  });

  it.each([
    "confirmed",
    "disputed",
    "fix_scheduled",
    "refunded",
    "cancelled_by_customer",
    "cancelled_by_business",
  ] as const)("snow contract: nothing to charge for a %s visit", (state) => {
    expect(
      chargeAtFor({
        kind: "snow_contract_visit",
        visit: { state, enteredAt: new Date("2026-12-10T15:00:00Z") },
      }),
    ).toBeNull();
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
      chargeAtFor({
        kind: "snow_contract_visit",
        visit: { state: "completed", enteredAt: new Date("x") },
      }),
    ).toThrow(RangeError);
  });
});

describe("payoutBatchFor", () => {
  it("pays Sunday 23:59:59.999 local on the next day (Monday)", () => {
    const sundayNight = fromLocal(
      { year: 2026, month: 10, day: 18, hour: 23, minute: 59, second: 59, millisecond: 999 },
      HALIFAX,
    );
    expect(sundayNight.toISOString()).toBe("2026-10-19T02:59:59.999Z");
    expect(payoutBatchFor(sundayNight)).toEqual({
      payoutDate: "2026-10-19",
      confirmedFrom: new Date("2026-10-12T03:00:00.000Z"), // Monday 00:00 ADT
      cutoffAt: new Date("2026-10-19T03:00:00.000Z"),
    });
  });

  it("pays a confirmation at Monday 00:00 local the following Monday", () => {
    const mondayMidnight = fromLocal({ year: 2026, month: 10, day: 19 }, HALIFAX);
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
    expect(payoutBatchFor(fromLocal({ year, month, day, hour: 12 }, HALIFAX)).payoutDate).toBe(
      payoutDate,
    );
  });

  it("uses Halifax local time, not UTC", () => {
    expect(PAYOUT_TIME_ZONE).toBe(HALIFAX);
    expect(PAYOUT_TIME_ZONE).toBe(DEFAULT_TIME_ZONE);
    // Monday 02:00 UTC is still Sunday 23:00 in Halifax…
    expect(payoutBatchFor(new Date("2026-10-19T02:00:00Z")).payoutDate).toBe("2026-10-19");
    // …and Monday 03:30 UTC is already Monday 00:30 there (but still Sunday in Toronto).
    const mondayEarly = new Date("2026-10-19T03:30:00Z");
    expect(payoutBatchFor(mondayEarly).payoutDate).toBe("2026-10-26");
    expect(payoutBatchFor(mondayEarly, "America/Toronto").payoutDate).toBe("2026-10-19");
  });

  it("handles a batch week containing the fall-back change", () => {
    const batch = payoutBatchFor(new Date("2026-10-30T12:00:00Z"));
    expect(batch.payoutDate).toBe("2026-11-02");
    expect(batch.confirmedFrom.toISOString()).toBe("2026-10-26T03:00:00.000Z"); // ADT
    expect(batch.cutoffAt.toISOString()).toBe("2026-11-02T04:00:00.000Z"); // AST
  });

  it("always lands on a Monday whose window contains the confirmation", () => {
    const start = new Date("2026-02-25T00:00:00Z").getTime();
    for (let t = start; t < start + 21 * 24 * HOUR; t += 37 * 60_000 * 7) {
      const confirmedAt = new Date(t);
      const batch = payoutBatchFor(confirmedAt);
      expect(toLocal(batch.cutoffAt, HALIFAX)).toMatchObject({ weekday: 1, hour: 0, minute: 0 });
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
      confirmedFrom: new Date("2026-03-02T04:00:00.000Z"), // AST
      cutoffAt: new Date("2026-03-09T03:00:00.000Z"), // ADT
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
