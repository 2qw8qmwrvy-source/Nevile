import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Context } from "./context.ts";
import { createCaller } from "./root.ts";
import { createHarness, type Harness, trpcError } from "./test/harness.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
/** Halifax wall-clock time on 2026-11-dd (Atlantic Standard Time, UTC−4). */
const novAt = (day: number, hour: number) => new Date(Date.UTC(2026, 10, day, hour + 4));

describe.skipIf(!TEST_DATABASE_URL)("roles in the team tools (SPEC §19, §20)", () => {
  let harness: Harness;
  let owner: Context;
  let manager: Context;
  let crew: Context;
  let businessId = "";
  const ids = { owner: "", manager: "", crew: "" };

  const call = (ctx: Context) => createCaller(ctx);

  /** Invites someone by email and signs them up through the link, like the app and site do. */
  async function join(inviter: Context, email: string, name: string, role: "manager" | "crew") {
    harness.emails.length = 0;
    await call(inviter).team.invite({ businessId, email, role });
    const link = harness.emails.find((message) => message.to === email)?.text ?? "";
    const token = link.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1] ?? "";
    const ctx = (await harness.signUp(email, name)).ctx;
    await call(ctx).team.acceptInvite({ token });
    return ctx;
  }

  beforeAll(async () => {
    harness = await createHarness(TEST_DATABASE_URL as string);
    harness.clock.set(novAt(2, 9));
    owner = (await harness.signUp("olive@example.com", "Olive Owner")).ctx;
    businessId = (await call(owner).business.create({ name: "Olive's Yards", province: "NS" })).id;
    manager = await join(owner, "max@example.com", "Max Manager", "manager");
    crew = await join(manager, "cal@example.com", "Cal Crew", "crew");
    const team = await call(owner).team.members({ businessId });
    ids.owner = team.find((row) => row.role === "owner")?.id ?? "";
    ids.manager = team.find((row) => row.role === "manager")?.id ?? "";
    ids.crew = team.find((row) => row.role === "crew")?.id ?? "";
  });

  afterAll(async () => {
    await harness?.close();
  });

  it("lets owners invite managers and crew, managers only crew, and crew nobody", async () => {
    const managerInvitesManager = await trpcError(
      call(manager).team.invite({ businessId, email: "mia@example.com", role: "manager" }),
    );
    expect(managerInvitesManager.code).toBe("FORBIDDEN");
    const crewInvites = await trpcError(
      call(crew).team.invite({ businessId, email: "cy@example.com", role: "crew" }),
    );
    expect(crewInvites.code).toBe("FORBIDDEN");
    expect((await trpcError(call(crew).team.invites({ businessId }))).code).toBe("FORBIDDEN");
    // An invite to someone already on the team is refused.
    const again = await trpcError(
      call(owner).team.invite({ businessId, email: "cal@example.com", role: "crew" }),
    );
    expect(again.code).toBe("CONFLICT");
  });

  it("shows crew the team without email addresses", async () => {
    const asCrew = await call(crew).team.members({ businessId });
    expect(asCrew.every((member) => member.email === null)).toBe(true);
    const asOwner = await call(owner).team.members({ businessId });
    expect(asOwner.find((member) => member.id === ids.crew)?.email).toBe("cal@example.com");
  });

  it("lets crew change only their own hours and time off", async () => {
    const hours = [{ weekday: 1, startMinute: 480, endMinute: 960 }];
    await call(crew).team.setHours({ businessId, memberId: ids.crew, hours });
    const mine = (await call(crew).team.members({ businessId })).find((m) => m.id === ids.crew);
    expect(mine?.hours).toEqual(hours);

    await call(crew).team.addTimeOff({
      businessId,
      memberId: ids.crew,
      startsAt: novAt(9, 0),
      endsAt: novAt(11, 0),
      reason: "Away",
    });
    const offs = (await call(crew).team.members({ businessId })).find(
      (m) => m.id === ids.crew,
    )?.timeOff;
    expect(offs).toHaveLength(1);

    const forOwner = await trpcError(
      call(crew).team.addTimeOff({
        businessId,
        memberId: ids.owner,
        startsAt: novAt(9, 0),
        endsAt: novAt(10, 0),
      }),
    );
    expect(forOwner.code).toBe("FORBIDDEN");
    // Someone else's time off can't be removed by crew either.
    await call(owner).team.addTimeOff({
      businessId,
      memberId: ids.owner,
      startsAt: novAt(12, 0),
      endsAt: novAt(13, 0),
    });
    const ownerOff = (await call(owner).team.members({ businessId })).find(
      (m) => m.id === ids.owner,
    )?.timeOff[0];
    const removeOwners = await trpcError(
      call(crew).team.removeTimeOff({ businessId, timeOffId: ownerOff?.id ?? "" }),
    );
    expect(removeOwners.code).toBe("FORBIDDEN");
    await call(crew).team.removeTimeOff({ businessId, timeOffId: offs?.[0]?.id ?? "" });
  });

  it("keeps booking windows, quotes and payouts to the right roles", async () => {
    const settings = await call(crew).team.settings({ businessId });
    const crewSettings = await trpcError(
      call(crew).team.updateSettings({
        businessId,
        windows: settings.windows.map(({ startMinute, endMinute }) => ({ startMinute, endMinute })),
        minNoticeDays: settings.minNoticeDays,
        maxDaysAhead: settings.maxDaysAhead,
      }),
    );
    expect(crewSettings.code).toBe("FORBIDDEN");
    expect((await trpcError(call(crew).businessQuotes.list({ businessId }))).code).toBe(
      "FORBIDDEN",
    );
    expect((await call(manager).businessQuotes.list({ businessId })).needsReply).toEqual([]);
    expect((await trpcError(call(crew).payouts.status({ businessId }))).code).toBe("FORBIDDEN");
    expect((await call(manager).payouts.status({ businessId })).payoutsEnabled).toBe(false);
    // Only the owner sets up payouts, from the website or the app.
    const managerStart = await trpcError(
      call(manager).payouts.start({ businessId, returnTo: "app" }),
    );
    expect(managerStart.code).toBe("FORBIDDEN");
    expect((await trpcError(call(crew).listing.publish({ businessId }))).code).toBe("FORBIDDEN");
  });

  it("removes people only as their role allows, and cuts off their access", async () => {
    expect(
      (await trpcError(call(manager).team.deactivate({ businessId, memberId: ids.owner }))).code,
    ).toBe("FORBIDDEN");
    expect(
      (await trpcError(call(owner).team.deactivate({ businessId, memberId: ids.owner }))).code,
    ).toBe("FORBIDDEN");
    expect(
      (await trpcError(call(crew).team.deactivate({ businessId, memberId: ids.manager }))).code,
    ).toBe("FORBIDDEN");

    await call(manager).team.deactivate({ businessId, memberId: ids.crew });
    // Removed crew lose the business: it's no longer theirs to see.
    expect((await trpcError(call(crew).businessBookings.inbox({ businessId }))).code).toBe(
      "NOT_FOUND",
    );
    expect((await call(crew).me.get()).businesses).toEqual([]);
  });
});
