import { unreadCounts } from "@nevile/api";
import { auth } from "@nevile/auth";
import { db } from "@nevile/db";

/** The header's Inbox badge: unread conversations plus unread updates (SPEC §20). */
export async function GET(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ count: 0 }, { headers: { "cache-control": "no-store" } });
  const counts = await unreadCounts(db, session.user.id);
  return Response.json(
    { count: counts.conversations + counts.notifications },
    { headers: { "cache-control": "no-store" } },
  );
}
