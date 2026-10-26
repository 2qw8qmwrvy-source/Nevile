import { agreementFileFor } from "@nevile/api";
import { auth } from "@nevile/auth";
import { db } from "@nevile/db";
import { isSafeKey, lazyStorage } from "@nevile/storage";
import { z } from "zod";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * A snow contract's agreement PDF (SPEC §21), for its customer and the business's owner
 * and managers. Everyone else, signed in or not, gets 404.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ bookingId: string }> },
): Promise<Response> {
  const id = z.uuid().safeParse((await params).bookingId);
  if (!id.success) return notFound();
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return notFound();
  const key = await agreementFileFor(db, session.user.id, id.data);
  if (!key || !isSafeKey(key) || !key.startsWith("private/agreements/")) return notFound();
  const object = await lazyStorage.get(key);
  if (!object) return notFound();
  return new Response(object.body.slice(), {
    headers: {
      "content-type": "application/pdf",
      "cache-control": "private, max-age=3600",
      "content-disposition": 'inline; filename="nevile-snow-agreement.pdf"',
      "x-content-type-options": "nosniff",
    },
  });
}
