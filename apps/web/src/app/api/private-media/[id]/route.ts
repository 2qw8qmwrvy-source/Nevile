import { privatePhotoKeyFor } from "@nevile/api";
import { auth } from "@nevile/auth";
import { db } from "@nevile/db";
import { isSafeKey, lazyStorage } from "@nevile/storage";
import { z } from "zod";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * A private photo (quote request or chat), streamed only to the people allowed to see it
 * (SPEC §20). Everyone else, signed in or not, gets 404, so photo ids can't be probed.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return notFound();
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return notFound();
  const key = await privatePhotoKeyFor(db, session.user.id, id.data);
  if (!key || !isSafeKey(key) || !key.startsWith("private/")) return notFound();
  const object = await lazyStorage.get(key);
  if (!object) return notFound();
  return new Response(object.body.slice(), {
    headers: {
      "content-type": "image/webp",
      // Personal content: never in shared caches.
      "cache-control": "private, max-age=3600",
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
    },
  });
}
