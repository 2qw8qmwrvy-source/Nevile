import { saveBusinessImage } from "@nevile/api";
import { auth } from "@nevile/auth";
import { PHOTO_MAX_BYTES } from "@nevile/core";
import { db } from "@nevile/db";
import { lazyStorage } from "@nevile/storage";
import { z } from "zod";
import { crossSiteRefused, isForeignOrigin } from "@/lib/same-origin.ts";

// Room for the multipart boundaries and the two small text fields.
const MAX_REQUEST_BYTES = PHOTO_MAX_BYTES + 64 * 1024;

const fieldsSchema = z.object({
  businessId: z.uuid(),
  kind: z.enum(["photo", "logo"]),
});

function error(status: number, message: string): Response {
  return Response.json({ error: { message } }, { status });
}

/**
 * Logo and work-photo uploads from the business dashboard (SPEC §18): multipart form data
 * with `businessId`, `kind` ("photo" | "logo") and `file`. The size is checked before the
 * body is read; `saveBusinessImage` checks the caller's role, re-encodes the image (no
 * metadata) and records it.
 */
export async function POST(req: Request): Promise<Response> {
  if (isForeignOrigin(req)) return crossSiteRefused();
  const length = Number(req.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0)
    return error(411, "Send the photo as a form upload.");
  if (length > MAX_REQUEST_BYTES) return error(413, "Photos can be up to 10 MB.");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return error(400, "Send the photo as a form upload.");
  }
  const fields = fieldsSchema.safeParse({
    businessId: form.get("businessId"),
    kind: form.get("kind"),
  });
  const file = form.get("file");
  if (!fields.success || !(file instanceof File)) return error(400, "Choose a photo to upload.");
  if (file.size > PHOTO_MAX_BYTES) return error(413, "Photos can be up to 10 MB.");

  const session = await auth.api.getSession({ headers: req.headers });
  const result = await saveBusinessImage({
    db,
    storage: lazyStorage,
    session,
    businessId: fields.data.businessId,
    kind: fields.data.kind,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  if (!result.ok) return error(result.status, result.message);
  return Response.json(result, { status: 201 });
}
