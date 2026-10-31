import { saveBusinessImage } from "@nevile/api";
import { auth } from "@nevile/auth";
import { PHOTO_MAX_BYTES } from "@nevile/core";
import { db } from "@nevile/db";
import { lazyStorage } from "@nevile/storage";
import { z } from "zod";
import { crossSiteRefused, isForeignOrigin } from "@/lib/same-origin.ts";
import { readUploadForm } from "@/lib/upload-form.ts";

const fieldsSchema = z.object({
  businessId: z.uuid(),
  kind: z.enum(["photo", "logo"]),
});

function error(status: number, message: string): Response {
  return Response.json({ error: { message } }, { status });
}

/**
 * Logo and work-photo uploads from the business dashboard (SPEC §18): multipart form data
 * with `businessId`, `kind` ("photo" | "logo") and `file`. The size is capped while the
 * body is read; `saveBusinessImage` checks the caller's role, re-encodes the image (no
 * metadata) and records it.
 */
export async function POST(req: Request): Promise<Response> {
  if (isForeignOrigin(req)) return crossSiteRefused();
  const upload = await readUploadForm(req);
  if (!upload.ok) return error(upload.status, upload.message);
  const { form } = upload;
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
