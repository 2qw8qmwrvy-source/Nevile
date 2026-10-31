import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_OCCURRENCES,
  generateOccurrences,
  RECURRENCE_FREQUENCIES,
  type RecurrenceFrequency,
} from "./recurrence.ts";
import { fromLocal, toLocal } from "./time.ts";

const HALIFAX = "America/Halifax";
const iso = (dates: Date[]) => dates.map((date) => date.toISOString());
const localTimes = (dates: Date[], zone = HALIFAX) =>
  dates.map((date) => {
    const l = toLocal(date, zone);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${l.year}-${pad(l.month)}-${pad(l.day)} ${pad(l.hour)}:${pad(l.minute)}`;
  });

describe("weekly", () => {
  it("keeps 09:00 local across spring forward (2026-03-08)", () => {
    const first = fromLocal({ year: 2026, month: 2, day: 26, hour: 9 }, HALIFAX);
    const visits = generateOccurrences({ frequency: "weekly", firstStartsAt: first, maxCount: 4 });
    expect(iso(visits)).toEqual([
      "2026-02-26T13:00:00.000Z", // AST, UTC−4
      "2026-03-05T13:00:00.000Z",
      "2026-03-12T12:00:00.000Z", // ADT, UTC−3
      "2026-03-19T12:00:00.000Z",
    ]);
    expect(localTimes(visits).every((t) => t.endsWith("09:00"))).toBe(true);
  });

  it("keeps 09:00 local across fall back (2026-11-01)", () => {
    const first = fromLocal({ year: 2026, month: 10, day: 25, hour: 9 }, HALIFAX);
    const visits = generateOccurrences({ frequency: "weekly", firstStartsAt: first, maxCount: 3 });
    expect(iso(visits)).toEqual([
      "2026-10-25T12:00:00.000Z",
      "2026-11-01T13:00:00.000Z", // the DST day itself, already AST at 09:00
      "2026-11-08T13:00:00.000Z",
    ]);
  });

  it("shifts a visit in the spring-forward gap to 03:30 that day only", () => {
    const first = fromLocal({ year: 2026, month: 3, day: 1, hour: 2, minute: 30 }, HALIFAX);
    const visits = generateOccurrences({ frequency: "weekly", firstStartsAt: first, maxCount: 3 });
    expect(localTimes(visits)).toEqual([
      "2026-03-01 02:30",
      "2026-03-08 03:30",
      "2026-03-15 02:30",
    ]);
  });

  it("uses the first (ADT) instant for an ambiguous fall-back time", () => {
    const first = fromLocal({ year: 2026, month: 10, day: 25, hour: 1, minute: 30 }, HALIFAX);
    const visits = generateOccurrences({ frequency: "weekly", firstStartsAt: first, maxCount: 3 });
    expect(iso(visits)).toEqual([
      "2026-10-25T04:30:00.000Z",
      "2026-11-01T04:30:00.000Z", // 01:30 ADT, not 01:30 AST (05:30Z)
      "2026-11-08T05:30:00.000Z",
    ]);
  });

  it("returns the first visit unchanged", () => {
    const first = new Date("2026-05-05T13:07:42.123Z");
    const [visit] = generateOccurrences({ frequency: "weekly", firstStartsAt: first, maxCount: 1 });
    expect(visit?.getTime()).toBe(first.getTime());
    expect(visit).not.toBe(first);
  });

  it("defaults to the Halifax zone", () => {
    // 09:00 in Toronto is 10:00 in Halifax; the default keeps 10:00 Halifax time.
    const first = fromLocal({ year: 2026, month: 3, day: 1, hour: 9 }, "America/Toronto");
    const visits = generateOccurrences({ frequency: "weekly", firstStartsAt: first, maxCount: 2 });
    expect(localTimes(visits)).toEqual(["2026-03-01 10:00", "2026-03-08 10:00"]);
    expect(iso(visits)).toEqual(["2026-03-01T14:00:00.000Z", "2026-03-08T13:00:00.000Z"]);
  });

  it("works in other zones", () => {
    const first = fromLocal({ year: 2026, month: 3, day: 1, hour: 9 }, "America/Vancouver");
    const visits = generateOccurrences({
      frequency: "weekly",
      firstStartsAt: first,
      timeZone: "America/Vancouver",
      maxCount: 3,
    });
    expect(iso(visits)).toEqual([
      "2026-03-01T17:00:00.000Z",
      "2026-03-08T16:00:00.000Z",
      "2026-03-15T16:00:00.000Z",
    ]);
  });
});

describe("biweekly", () => {
  it("repeats every 14 days at the same local time", () => {
    const first = fromLocal({ year: 2026, month: 10, day: 20, hour: 15, minute: 30 }, HALIFAX);
    const visits = generateOccurrences({
      frequency: "biweekly",
      firstStartsAt: first,
      maxCount: 4,
    });
    expect(localTimes(visits)).toEqual([
      "2026-10-20 15:30",
      "2026-11-03 15:30",
      "2026-11-17 15:30",
      "2026-12-01 15:30",
    ]);
  });
});

describe("monthly", () => {
  it("repeats on the same day of the month", () => {
    const first = fromLocal({ year: 2026, month: 10, day: 15, hour: 10 }, HALIFAX);
    const visits = generateOccurrences({ frequency: "monthly", firstStartsAt: first, maxCount: 4 });
    expect(localTimes(visits)).toEqual([
      "2026-10-15 10:00",
      "2026-11-15 10:00",
      "2026-12-15 10:00",
      "2027-01-15 10:00",
    ]);
  });

  it("clamps day 31 to month end without drifting", () => {
    const first = fromLocal({ year: 2026, month: 1, day: 31, hour: 9 }, HALIFAX);
    const visits = generateOccurrences({ frequency: "monthly", firstStartsAt: first, maxCount: 6 });
    expect(localTimes(visits)).toEqual([
      "2026-01-31 09:00",
      "2026-02-28 09:00",
      "2026-03-31 09:00",
      "2026-04-30 09:00",
      "2026-05-31 09:00",
      "2026-06-30 09:00",
    ]);
  });

  it.each([
    [29, ["2027-12-29", "2028-01-29", "2028-02-29", "2028-03-29"]],
    [30, ["2027-12-30", "2028-01-30", "2028-02-29", "2028-03-30"]],
    [31, ["2027-12-31", "2028-01-31", "2028-02-29", "2028-03-31"]],
  ])("day %s clamps to Feb 29 in a leap year", (day, expected) => {
    const first = fromLocal({ year: 2027, month: 12, day, hour: 8 }, HALIFAX);
    const visits = generateOccurrences({ frequency: "monthly", firstStartsAt: first, maxCount: 4 });
    expect(localTimes(visits).map((t) => t.slice(0, 10))).toEqual(expected);
  });

  it("day 29 clamps to Feb 28 in a common year", () => {
    const first = fromLocal({ year: 2026, month: 1, day: 29, hour: 8 }, HALIFAX);
    const visits = generateOccurrences({ frequency: "monthly", firstStartsAt: first, maxCount: 3 });
    expect(localTimes(visits).map((t) => t.slice(0, 10))).toEqual([
      "2026-01-29",
      "2026-02-28",
      "2026-03-29",
    ]);
  });

  it("keeps local time across DST", () => {
    const first = fromLocal({ year: 2026, month: 2, day: 10, hour: 9 }, HALIFAX);
    const visits = generateOccurrences({ frequency: "monthly", firstStartsAt: first, maxCount: 2 });
    expect(iso(visits)).toEqual(["2026-02-10T13:00:00.000Z", "2026-03-10T12:00:00.000Z"]);
  });
});

describe("bounds", () => {
  const first = fromLocal({ year: 2026, month: 3, day: 5, hour: 9 }, HALIFAX);

  it("includes a visit on the end date (inclusive local date)", () => {
    const visits = generateOccurrences({
      frequency: "weekly",
      firstStartsAt: first,
      endDate: "2026-03-19",
    });
    expect(localTimes(visits).map((t) => t.slice(0, 10))).toEqual([
      "2026-03-05",
      "2026-03-12",
      "2026-03-19",
    ]);
  });

  it("stops before a visit after the end date", () => {
    const visits = generateOccurrences({
      frequency: "weekly",
      firstStartsAt: first,
      endDate: "2026-03-18",
    });
    expect(visits).toHaveLength(2);
  });

  it("interprets a Date end bound by its local calendar date", () => {
    // 2026-03-20T02:00Z is still 2026-03-19 (23:00 ADT) in Halifax.
    const visits = generateOccurrences({
      frequency: "weekly",
      firstStartsAt: first,
      endDate: new Date("2026-03-20T02:00:00Z"),
    });
    expect(visits).toHaveLength(3);
    // 02:59:59Z on March 19 is still March 18 (23:59:59 ADT): the 19th's visit is excluded.
    expect(
      generateOccurrences({
        frequency: "weekly",
        firstStartsAt: first,
        endDate: new Date("2026-03-19T02:59:59Z"),
      }),
    ).toHaveLength(2);
  });

  it("returns nothing when the end date is before the first visit", () => {
    expect(
      generateOccurrences({ frequency: "weekly", firstStartsAt: first, endDate: "2026-03-04" }),
    ).toEqual([]);
  });

  it("is capped by maxCount even with a later end date", () => {
    const visits = generateOccurrences({
      frequency: "weekly",
      firstStartsAt: first,
      endDate: "2030-01-01",
      maxCount: 5,
    });
    expect(visits).toHaveLength(5);
  });

  it("defaults maxCount", () => {
    const visits = generateOccurrences({ frequency: "weekly", firstStartsAt: first });
    expect(visits).toHaveLength(DEFAULT_MAX_OCCURRENCES);
  });

  it("produces strictly increasing instants for every frequency", () => {
    for (const frequency of RECURRENCE_FREQUENCIES) {
      const visits = generateOccurrences({ frequency, firstStartsAt: first, maxCount: 60 });
      for (let i = 1; i < visits.length; i++) {
        expect((visits[i] as Date).getTime()).toBeGreaterThan((visits[i - 1] as Date).getTime());
      }
    }
  });

  it.each([0, -1, 1.5, 1001])("rejects maxCount %s", (maxCount) => {
    expect(() =>
      generateOccurrences({ frequency: "weekly", firstStartsAt: first, maxCount }),
    ).toThrow(RangeError);
  });

  it("rejects bad input", () => {
    expect(() =>
      generateOccurrences({ frequency: "weekly", firstStartsAt: first, endDate: "2026-02-30" }),
    ).toThrow(RangeError);
    expect(() =>
      generateOccurrences({ frequency: "weekly", firstStartsAt: new Date("nope") }),
    ).toThrow(RangeError);
    expect(() =>
      generateOccurrences({ frequency: "daily" as RecurrenceFrequency, firstStartsAt: first }),
    ).toThrow(/frequency/);
    expect(() =>
      generateOccurrences({ frequency: "weekly", firstStartsAt: first, timeZone: "Nowhere/City" }),
    ).toThrow(RangeError);
  });
});
