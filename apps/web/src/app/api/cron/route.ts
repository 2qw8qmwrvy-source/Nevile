import { timingSafeEqual } from "node:crypto";
import { runScheduledJobs } from "@nevile/api";
import { serverBookingDeps } from "@/lib/booking-deps.ts";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Runs the booking timers (SPEC §19): call it every 5 minutes from the host's scheduler
 * with `Authorization: Bearer $CRON_SECRET`. Every step is safe to repeat.
 */
async function handler(req: Request): Promise<Response> {
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: { message: "CRON_SECRET is not set." } }, { status: 503 });
  }
  if (!authorized(req))
    return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  const report = await runScheduledJobs(serverBookingDeps());
  return Response.json({ ok: true, report });
}

export { handler as GET, handler as POST };
