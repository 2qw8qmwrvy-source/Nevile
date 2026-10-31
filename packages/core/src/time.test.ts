import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  addLocalDays,
  addMilliseconds,
  assertValidDate,
  DEFAULT_TIME_ZONE,
  daysInMonth,
  endSentence,
  formatIsoDate,
  fromLocal,
  isIsoDate,
  isValidTimeZone,
  localDateString,
  parseIsoDate,
  toLocal,
  weekdayOf,
} from "./time.ts";

const HALIFAX = "America/Halifax";
const TORONTO = "America/Toronto";

describe("test environment", () => {
  it("runs under a non-Canadian host zone", () => {
    expect(new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset()).toBe(-330);
  });
});

describe("toLocal / fromLocal", () => {
  it("reads wall-clock components in the given zone", () => {
    const local = toLocal(new Date("2026-10-21T13:45:30.250Z"), HALIFAX);
    expect(local).toEqual({
      year: 2026,
      month: 10,
      day: 21,
      hour: 10,
      minute: 45,
      second: 30,
      millisecond: 250,
      weekday: 3,
    });
  });

  it("defaults to America/Halifax (SPEC §2)", () => {
    expect(DEFAULT_TIME_ZONE).toBe(HALIFAX);
    // Midnight on Jan 1 in Halifax (AST, UTC−4) is 04:00 UTC.
    expect(toLocal(new Date("2026-01-01T03:59:59Z")).day).toBe(31);
    expect(toLocal(new Date("2026-01-01T04:00:00Z")).day).toBe(1);
    expect(fromLocal({ year: 2026, month: 7, day: 1, hour: 9 }).toISOString()).toBe(
      "2026-07-01T12:00:00.000Z",
    );
    expect(localDateString(new Date("2026-10-22T02:30:00Z"))).toBe("2026-10-21");
  });

  it("round-trips a regular wall-clock time", () => {
    const at = fromLocal({ year: 2026, month: 7, day: 1, hour: 9, minute: 30 }, HALIFAX);
    expect(at.toISOString()).toBe("2026-07-01T12:30:00.000Z");
    expect(at).toBeInstanceOf(Date);
    const winter = fromLocal({ year: 2026, month: 1, day: 15, hour: 9 }, HALIFAX);
    expect(winter.toISOString()).toBe("2026-01-15T13:00:00.000Z"); // AST, UTC−4
    expect(toLocal(winter, HALIFAX)).toMatchObject({ day: 15, hour: 9, minute: 0 });
  });

  it("switches Halifax from AST to ADT at 02:00 on 2026-03-08", () => {
    expect(toLocal(new Date("2026-03-08T05:59:59Z"), HALIFAX)).toMatchObject({ hour: 1 });
    expect(toLocal(new Date("2026-03-08T06:00:00Z"), HALIFAX)).toMatchObject({ hour: 3 });
  });

  it("moves a time in the spring-forward gap forward by an hour (2026-03-08)", () => {
    const at = fromLocal({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, HALIFAX);
    expect(at.toISOString()).toBe("2026-03-08T06:30:00.000Z");
    expect(toLocal(at, HALIFAX)).toMatchObject({ hour: 3, minute: 30 });
  });

  it("switches Halifax from ADT back to AST at 02:00 on 2026-11-01", () => {
    // 01:30 happens twice: 04:30Z (ADT) and 05:30Z (AST).
    expect(toLocal(new Date("2026-11-01T04:30:00Z"), HALIFAX)).toMatchObject({ hour: 1 });
    expect(toLocal(new Date("2026-11-01T05:30:00Z"), HALIFAX)).toMatchObject({ hour: 1 });
    expect(toLocal(new Date("2026-11-01T06:00:00Z"), HALIFAX)).toMatchObject({ hour: 2 });
  });

  it("resolves an ambiguous fall-back time to the first occurrence (2026-11-01)", () => {
    const at = fromLocal({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, HALIFAX);
    expect(at.toISOString()).toBe("2026-11-01T04:30:00.000Z");
  });

  it("still handles other Canadian zones (Toronto)", () => {
    expect(
      fromLocal({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, TORONTO).toISOString(),
    ).toBe("2026-03-08T07:30:00.000Z");
    expect(
      fromLocal({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, TORONTO).toISOString(),
    ).toBe("2026-11-01T05:30:00.000Z");
  });

  it.each([
    "America/Los_Angeles",
    "America/Toronto",
    "America/Halifax",
    "America/St_Johns",
    "Europe/London",
    "UTC",
  ])("gives the same instants whatever the host zone is (TZ=%s)", (hostZone) => {
    const original = process.env.TZ;
    process.env.TZ = hostZone;
    try {
      // Sanity: the host zone really changed (Node applies TZ at runtime).
      const hostOffset = new Date(Date.UTC(2026, 6, 1)).getTimezoneOffset();
      const expectedHostOffset: Record<string, number> = {
        "America/Los_Angeles": 420,
        "America/Toronto": 240,
        "America/Halifax": 180,
        "America/St_Johns": 150,
        "Europe/London": -60,
        UTC: 0,
      };
      expect(hostOffset).toBe(expectedHostOffset[hostZone]);
      const iso = (local: Parameters<typeof fromLocal>[0], zone: string) =>
        fromLocal(local, zone).toISOString();
      // Ambiguous fall-back times resolve to the first (daylight) occurrence.
      expect(iso({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, HALIFAX)).toBe(
        "2026-11-01T04:30:00.000Z",
      );
      expect(iso({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, TORONTO)).toBe(
        "2026-11-01T05:30:00.000Z",
      );
      expect(iso({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, "America/Vancouver")).toBe(
        "2026-11-01T08:30:00.000Z",
      );
      expect(iso({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, "America/St_Johns")).toBe(
        "2026-11-01T04:00:00.000Z",
      );
      // Spring-forward gaps move forward by the gap.
      expect(iso({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, HALIFAX)).toBe(
        "2026-03-08T06:30:00.000Z",
      );
      // Ordinary times, including a half-hour zone and the default zone.
      expect(iso({ year: 2026, month: 7, day: 1, hour: 9 }, HALIFAX)).toBe(
        "2026-07-01T12:00:00.000Z",
      );
      expect(fromLocal({ year: 2026, month: 7, day: 1, hour: 9 }).toISOString()).toBe(
        "2026-07-01T12:00:00.000Z",
      );
      expect(iso({ year: 2026, month: 1, day: 15, hour: 9 }, "America/St_Johns")).toBe(
        "2026-01-15T12:30:00.000Z",
      );
      // Days that do not exist roll over like Date.UTC does.
      expect(iso({ year: 2026, month: 2, day: 30, hour: 9 }, HALIFAX)).toBe(
        "2026-03-02T13:00:00.000Z",
      );
      // The 23-hour day in the local zone keeps its wall-clock time.
      expect(addLocalDays(new Date("2026-03-07T13:00:00Z"), 1, HALIFAX).toISOString()).toBe(
        "2026-03-08T12:00:00.000Z",
      );
    } finally {
      process.env.TZ = original;
    }
    expect(new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset()).toBe(-330);
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
    const at = new Date("2026-10-22T02:30:00Z");
    expect(localDateString(at, HALIFAX)).toBe("2026-10-21");
    expect(localDateString(at, "UTC")).toBe("2026-10-22");
    // 03:30Z is already the 22nd in Halifax but still the 21st in Toronto.
    expect(localDateString(new Date("2026-10-22T03:30:00Z"), HALIFAX)).toBe("2026-10-22");
    expect(localDateString(new Date("2026-10-22T03:30:00Z"), TORONTO)).toBe("2026-10-21");
  });
});

describe("addLocalDays", () => {
  it("keeps the wall-clock time across spring forward", () => {
    const visit = new Date("2026-03-10T12:00:00Z"); // 09:00 ADT
    expect(addLocalDays(visit, -3, HALIFAX).toISOString()).toBe("2026-03-07T13:00:00.000Z");
    expect(addLocalDays(visit, -3).toISOString()).toBe("2026-03-07T13:00:00.000Z");
  });

  it("keeps the wall-clock time across fall back", () => {
    const visit = new Date("2026-10-30T12:00:00Z"); // 09:00 ADT
    expect(addLocalDays(visit, 3, HALIFAX).toISOString()).toBe("2026-11-02T13:00:00.000Z");
    expect(addLocalDays(visit, 3).toISOString()).toBe("2026-11-02T13:00:00.000Z");
  });
});

describe("misc", () => {
  it("validates zones", () => {
    expect(isValidTimeZone("America/Halifax")).toBe(true);
    expect(isValidTimeZone("America/Toronto")).toBe(true);
    expect(isValidTimeZone("America/Yellowknife")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });

  it("asserts valid dates", () => {
    expect(() => assertValidDate(new Date("nope"))).toThrow(RangeError);
    expect(() => assertValidDate("2026-01-01" as unknown as Date)).toThrow(RangeError);
    expect(() => assertValidDate(new Date())).not.toThrow();
  });

  it("ends a sentence once after a time", () => {
    expect(endSentence("Waiting until Tuesday at 8:00 a.m.")).toBe(
      "Waiting until Tuesday at 8:00 a.m.",
    );
    expect(endSentence("Waiting until Tuesday")).toBe("Waiting until Tuesday.");
  });

  it("adds milliseconds without mutating", () => {
    const at = new Date("2026-01-01T00:00:00Z");
    expect(addMilliseconds(at, 1000).toISOString()).toBe("2026-01-01T00:00:01.000Z");
    expect(at.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});
