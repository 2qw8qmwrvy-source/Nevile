import { describe, expect, it } from "vitest";
import {
  arrivalWindowsSchema,
  availableDays,
  bookingRequestSchema,
  canTakeBookings,
  checkWindow,
  DEFAULT_ARRIVAL_WINDOWS,
  DEFAULT_WORKING_HOURS,
  fitsInWindow,
  formatArrivalWindow,
  formatMinuteOfDay,
  type MemberAvailability,
  memberMinutesInSlot,
  payoutSetupDueAt,
  planDay,
  windowSlotsForDate,
  workingHoursSchema,
} from "./scheduling.ts";

const MONDAY = { year: 2026, month: 11, day: 2 };
const SATURDAY = { year: 2026, month: 11, day: 7 };
const owner: MemberAvailability = { memberId: "owner", hours: DEFAULT_WORKING_HOURS, timeOff: [] };
const crew: MemberAvailability = { memberId: "crew", hours: DEFAULT_WORKING_HOURS, timeOff: [] };

/** Halifax wall-clock time on 2026-11-02 (Atlantic Standard Time, UTC−4). */
const mondayAt = (hour: number, minute = 0) => new Date(Date.UTC(2026, 10, 2, hour + 4, minute));

describe("formatting", () => {
  it("reads windows the way people say them", () => {
    expect(DEFAULT_ARRIVAL_WINDOWS.map(formatArrivalWindow)).toEqual([
      "8–11 am",
      "11 am–2 pm",
      "2–5 pm",
    ]);
    expect(formatArrivalWindow({ startMinute: 720, endMinute: 900 })).toBe("12–3 pm");
    expect(formatArrivalWindow({ startMinute: 450, endMinute: 630 })).toBe("7:30–10:30 am");
    expect(formatMinuteOfDay(1260)).toBe("9 pm");
  });
});

describe("arrival windows and hours", () => {
  it("accepts the defaults and sorts windows", () => {
    expect(arrivalWindowsSchema.parse([...DEFAULT_ARRIVAL_WINDOWS].reverse())).toEqual(
      DEFAULT_ARRIVAL_WINDOWS,
    );
  });

  it("rejects overlaps, odd lengths, odd times and hours outside 6 am–9 pm", () => {
    const bad = [
      [
        { startMinute: 480, endMinute: 660 },
        { startMinute: 600, endMinute: 780 },
      ],
      [{ startMinute: 480, endMinute: 510 }],
      [{ startMinute: 480, endMinute: 900 }],
      [{ startMinute: 485, endMinute: 665 }],
      [{ startMinute: 300, endMinute: 480 }],
      [{ startMinute: 1140, endMinute: 1320 }],
      [],
    ];
    for (const windows of bad) {
      expect(arrivalWindowsSchema.safeParse(windows).success, JSON.stringify(windows)).toBe(false);
    }
  });

  it("allows one span of working hours per day", () => {
    expect(workingHoursSchema.safeParse(DEFAULT_WORKING_HOURS).success).toBe(true);
    expect(
      workingHoursSchema.safeParse([
        { weekday: 1, startMinute: 480, endMinute: 720 },
        { weekday: 1, startMinute: 780, endMinute: 1020 },
      ]).success,
    ).toBe(false);
    expect(
      workingHoursSchema.safeParse([{ weekday: 2, startMinute: 600, endMinute: 600 }]).success,
    ).toBe(false);
  });
});

describe("capacity", () => {
  it("places windows on the local calendar, across the daylight-saving change", () => {
    const [first] = windowSlotsForDate(MONDAY, DEFAULT_ARRIVAL_WINDOWS);
    expect(first?.startsAt.toISOString()).toBe("2026-11-02T12:00:00.000Z");
    const [summer] = windowSlotsForDate({ year: 2026, month: 7, day: 6 }, DEFAULT_ARRIVAL_WINDOWS);
    expect(summer?.startsAt.toISOString()).toBe("2026-07-06T11:00:00.000Z");
  });

  it("adds up the crew's minutes in each window", () => {
    const monday = planDay({
      date: MONDAY,
      windows: DEFAULT_ARRIVAL_WINDOWS,
      members: [owner, crew],
      placed: [],
    });
    expect(monday.map((slot) => slot.capacityMinutes)).toEqual([360, 360, 360]);
    const saturday = planDay({
      date: SATURDAY,
      windows: DEFAULT_ARRIVAL_WINDOWS,
      members: [owner],
      placed: [],
    });
    expect(saturday.map((slot) => slot.capacityMinutes)).toEqual([0, 0, 0]);
  });

  it("counts partial hours and subtracts time off", () => {
    const mornings: MemberAvailability = {
      memberId: "mornings",
      hours: [{ weekday: 1, startMinute: 480, endMinute: 720 }],
      timeOff: [],
    };
    const dentist: MemberAvailability = {
      ...owner,
      timeOff: [{ startsAt: mondayAt(9), endsAt: mondayAt(10, 30) }],
    };
    const [first, second] = windowSlotsForDate(MONDAY, DEFAULT_ARRIVAL_WINDOWS);
    expect(memberMinutesInSlot(second as never, mornings)).toBe(60);
    expect(memberMinutesInSlot(first as never, dentist)).toBe(90);
    const overlapping: MemberAvailability = {
      ...owner,
      timeOff: [
        { startsAt: mondayAt(8), endsAt: mondayAt(9) },
        { startsAt: mondayAt(8, 30), endsAt: mondayAt(9, 30) },
      ],
    };
    expect(memberMinutesInSlot(first as never, overlapping)).toBe(90);
  });

  it("uses up a window by time and spills long jobs into the next", () => {
    const plan = planDay({
      date: MONDAY,
      windows: DEFAULT_ARRIVAL_WINDOWS,
      members: [owner],
      placed: [
        { startsAt: mondayAt(8), workMinutes: 60 },
        { startsAt: mondayAt(11), workMinutes: 240 },
      ],
    });
    expect(plan.map((slot) => slot.freeMinutes)).toEqual([120, 0, 120]);
  });

  it("fits several short jobs, but not a job that would start too late", () => {
    const plan = planDay({
      date: MONDAY,
      windows: DEFAULT_ARRIVAL_WINDOWS,
      members: [owner],
      placed: [{ startsAt: mondayAt(8), workMinutes: 150 }],
    });
    expect(fitsInWindow(plan, 0, 30)).toBe(true);
    expect(fitsInWindow(plan, 0, 60)).toBe(false);
    // A 4-hour job from 11 am needs 3 hours of the 11–2 window and 1 hour after 2 pm.
    expect(fitsInWindow(plan, 1, 240)).toBe(true);
    // From the last window there is nowhere to spill.
    expect(fitsInWindow(plan, 2, 240)).toBe(false);
  });

  it("keeps the plan consistent when existing work overflows", () => {
    const plan = planDay({
      date: MONDAY,
      windows: DEFAULT_ARRIVAL_WINDOWS,
      members: [owner],
      placed: [
        { startsAt: mondayAt(8), workMinutes: 180 },
        { startsAt: mondayAt(8), workMinutes: 120 },
      ],
    });
    expect(plan.map((slot) => slot.freeMinutes)).toEqual([0, 180, 180]);
  });
});

describe("bookable days", () => {
  const base = {
    windows: DEFAULT_ARRIVAL_WINDOWS,
    members: [owner],
    placed: [],
    workMinutes: 60,
  };

  it("starts tomorrow by default and stops at the limit", () => {
    const now = new Date("2026-11-01T14:00:00Z"); // Sunday 10 am in Halifax
    const days = availableDays({
      ...base,
      now,
      rules: { minNoticeDays: 1, maxDaysAhead: 7 },
      days: 30,
    });
    expect(days[0]?.date).toBe("2026-11-02");
    expect(days.at(-1)?.date).toBe("2026-11-08");
    expect(days[0]?.windows.every((window) => window.available)).toBe(true);
    const saturday = days.find((day) => day.date === "2026-11-07");
    expect(saturday?.windows.some((window) => window.available)).toBe(false);
  });

  it("allows same-day windows that start at least two hours from now", () => {
    const now = mondayAt(9, 30);
    const [today] = availableDays({
      ...base,
      now,
      rules: { minNoticeDays: 0, maxDaysAhead: 7 },
      days: 1,
    });
    expect(today?.windows.map((window) => window.available)).toEqual([false, false, true]);
  });

  it("checks a requested window on the server", () => {
    const now = new Date("2026-11-01T14:00:00Z");
    const rules = { minNoticeDays: 1, maxDaysAhead: 30 };
    const check = (date: typeof MONDAY, startMinute: number, extra: object = {}) =>
      checkWindow({ ...base, now, rules, date, startMinute, ...extra }).ok ||
      (checkWindow({ ...base, now, rules, date, startMinute, ...extra }) as { reason: string })
        .reason;
    expect(check(MONDAY, 480)).toBe(true);
    expect(check(MONDAY, 500)).toBe("no_window");
    expect(check({ year: 2026, month: 11, day: 1 }, 840)).toBe("too_soon");
    expect(check({ year: 2027, month: 1, day: 4 }, 480)).toBe("too_far");
    expect(check(MONDAY, 480, { placed: [{ startsAt: mondayAt(8), workMinutes: 180 }] })).toBe(
      "full",
    );
  });
});

describe("payout setup", () => {
  it("gives a business 7 days from its first paid booking", () => {
    const first = new Date("2026-11-02T15:00:00Z");
    const due = payoutSetupDueAt(first);
    expect(due.toISOString()).toBe("2026-11-09T15:00:00.000Z");
    expect(canTakeBookings({ payoutsEnabled: false, payoutSetupDueAt: null, now: first })).toBe(
      true,
    );
    expect(canTakeBookings({ payoutsEnabled: false, payoutSetupDueAt: due, now: first })).toBe(
      true,
    );
    expect(canTakeBookings({ payoutsEnabled: false, payoutSetupDueAt: due, now: due })).toBe(false);
    expect(canTakeBookings({ payoutsEnabled: true, payoutSetupDueAt: due, now: due })).toBe(true);
  });
});

describe("booking request", () => {
  const valid = {
    serviceId: "0e6f4c1a-3b7d-4c55-9a1e-6f2b8d9c0a11",
    date: "2026-11-02",
    windowStart: 480,
    address: { line1: "12 Example Lane", line2: "", city: "Halifax", postalCode: "b3h1a1" },
    notes: "",
  };

  it("normalises the address and notes", () => {
    const parsed = bookingRequestSchema.parse(valid);
    expect(parsed.address).toEqual({
      line1: "12 Example Lane",
      line2: null,
      city: "Halifax",
      postalCode: "B3H 1A1",
    });
    expect(parsed.notes).toBeNull();
  });

  it("rejects addresses outside Nova Scotia, bad dates and control characters", () => {
    expect(
      bookingRequestSchema.safeParse({
        ...valid,
        address: { ...valid.address, postalCode: "M5V 2T6" },
      }).success,
    ).toBe(false);
    expect(bookingRequestSchema.safeParse({ ...valid, date: "2026-02-30" }).success).toBe(false);
    expect(bookingRequestSchema.safeParse({ ...valid, notes: "gate\u0007code" }).success).toBe(
      false,
    );
    expect(
      bookingRequestSchema.safeParse({ ...valid, notes: "Gate is\non the left" }).success,
    ).toBe(true);
  });
});
