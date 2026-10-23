import { isSafeKey, lazyStorage } from "@nevile/storage";

/**
 * Serves stored business media when there is no public bucket URL (development, or a
 * private bucket). Keys are random per upload, so responses never change and can be
 * cached for a year. Only processed WebP images are served.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const key = (await params).key.join("/");
  if (!isSafeKey(key) || !key.startsWith("businesses/") || !key.endsWith(".webp")) {
    return new Response("Not found", { status: 404 });
  }
  const object = await lazyStorage.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body.slice(), {
    headers: {
      "content-type": "image/webp",
      "cache-control": "public, max-age=31536000, immutable",
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
    },
  });
}
