import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_ZONE,
  addCalendarDays,
  addLocalDays,
  addMilliseconds,
  assertValidDate,
  daysInMonth,
  formatIsoDate,
  fromLocal,
  isIsoDate,
  isValidTimeZone,
  localDateString,
  parseIsoDate,
  toLocal,
  weekdayOf,
} from "./time.ts";

const TORONTO = "America/Toronto";

describe("test environment", () => {
  it("runs under a non-Canadian host zone", () => {
    expect(new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset()).toBe(-330);
  });
});

describe("toLocal / fromLocal", () => {
  it("reads wall-clock components in the given zone", () => {
    const local = toLocal(new Date("2026-10-21T13:45:30.250Z"), TORONTO);
    expect(local).toEqual({
      year: 2026,
      month: 10,
      day: 21,
      hour: 9,
      minute: 45,
      second: 30,
      millisecond: 250,
      weekday: 3,
    });
  });

  it("defaults to America/Toronto", () => {
    expect(DEFAULT_TIME_ZONE).toBe(TORONTO);
    expect(toLocal(new Date("2026-01-01T04:59:59Z")).day).toBe(31);
  });

  it("round-trips a regular wall-clock time", () => {
    const at = fromLocal({ year: 2026, month: 7, day: 1, hour: 9, minute: 30 }, TORONTO);
    expect(at.toISOString()).toBe("2026-07-01T13:30:00.000Z");
    expect(at).toBeInstanceOf(Date);
  });

  it("moves a time in the spring-forward gap forward by an hour (2026-03-08)", () => {
    const at = fromLocal({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, TORONTO);
    expect(at.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(toLocal(at, TORONTO).hour).toBe(3);
  });

  it("resolves an ambiguous fall-back time to the first occurrence (2026-11-01)", () => {
    const at = fromLocal({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, TORONTO);
    expect(at.toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("rejects invalid dates and zones", () => {
    expect(() => toLocal(new Date(Number.NaN))).toThrow(RangeError);
    expect(() => toLocal(new Date(), "Mars/Olympus")).toThrow(RangeError);
    expect(() => fromLocal({ year: 2026, month: 1, day: 1 }, "Nope/Nope")).toThrow(RangeError);
  });
});

describe("calendar dates", () => {
  it("parses only real YYYY-MM-DD dates", () => {
    expect(parseIsoDate("2026-02-28")).toEqual({ year: 2026, month: 2, day: 28 });
    expect(parseIsoDate("2028-02-29")).toEqual({ year: 2028, month: 2, day: 29 });
    for (const bad of ["2026-02-29", "2026-13-01", "2026-00-10", "2026-1-1", "26-01-01", ""]) {
      expect(parseIsoDate(bad)).toBeNull();
      expect(isIsoDate(bad)).toBe(false);
    }
  });

  it("formats with zero padding", () => {
    expect(formatIsoDate({ year: 2026, month: 3, day: 7 })).toBe("2026-03-07");
  });

  it("knows month lengths including leap years", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("adds calendar days across month and year ends", () => {
    expect(addCalendarDays({ year: 2026, month: 12, day: 30 }, 3)).toEqual({
      year: 2027,
      month: 1,
      day: 2,
    });
    expect(addCalendarDays({ year: 2026, month: 3, day: 1 }, -1)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
  });

  it("computes weekdays", () => {
    expect(weekdayOf({ year: 2026, month: 10, day: 19 })).toBe(1);
    expect(weekdayOf({ year: 2026, month: 10, day: 25 })).toBe(0);
  });

  it("gives the local date of an instant", () => {
    const at = new Date("2026-10-22T03:30:00Z");
    expect(localDateString(at, TORONTO)).toBe("2026-10-21");
    expect(localDateString(at, "UTC")).toBe("2026-10-22");
  });
});

describe("addLocalDays", () => {
  it("keeps the wall-clock time across spring forward", () => {
    const visit = new Date("2026-03-10T13:00:00Z"); // 09:00 EDT
    expect(addLocalDays(visit, -3, TORONTO).toISOString()).toBe("2026-03-07T14:00:00.000Z");
  });

  it("keeps the wall-clock time across fall back", () => {
    const visit = new Date("2026-10-30T13:00:00Z"); // 09:00 EDT
    expect(addLocalDays(visit, 3, TORONTO).toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });
});

describe("misc", () => {
  it("validates zones", () => {
    expect(isValidTimeZone("America/Toronto")).toBe(true);
    expect(isValidTimeZone("America/Yellowknife")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });

  it("asserts valid dates", () => {
    expect(() => assertValidDate(new Date("nope"))).toThrow(RangeError);
    expect(() => assertValidDate("2026-01-01" as unknown as Date)).toThrow(RangeError);
    expect(() => assertValidDate(new Date())).not.toThrow();
  });

  it("adds milliseconds without mutating", () => {
    const at = new Date("2026-01-01T00:00:00Z");
    expect(addMilliseconds(at, 1000).toISOString()).toBe("2026-01-01T00:00:01.000Z");
    expect(at.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});
