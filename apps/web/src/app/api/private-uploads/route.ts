import { savePrivatePhoto } from "@nevile/api";
import { auth } from "@nevile/auth";
import { PHOTO_MAX_BYTES } from "@nevile/core";
import { db } from "@nevile/db";
import { lazyStorage } from "@nevile/storage";
import { z } from "zod";
import { crossSiteRefused, isForeignOrigin } from "@/lib/same-origin.ts";
import { readUploadForm } from "@/lib/upload-form.ts";

const fieldsSchema = z.object({ purpose: z.enum(["quotes", "chat"]) });

function error(status: number, message: string): Response {
  return Response.json({ error: { message } }, { status });
}

/**
 * Private photo uploads for quote requests and chat (SPEC §20): multipart form data with
 * `purpose` ("quotes" | "chat") and `file`. Returns the photo's id, which the request or
 * message then attaches. Only signed-in people with a confirmed contact can upload.
 */
export async function POST(req: Request): Promise<Response> {
  if (isForeignOrigin(req)) return crossSiteRefused();
  const upload = await readUploadForm(req);
  if (!upload.ok) return error(upload.status, upload.message);
  const { form } = upload;
  const fields = fieldsSchema.safeParse({ purpose: form.get("purpose") });
  const file = form.get("file");
  if (!fields.success || !(file instanceof File)) return error(400, "Choose a photo to upload.");
  if (file.size > PHOTO_MAX_BYTES) return error(413, "Photos can be up to 10 MB.");
  const session = await auth.api.getSession({ headers: req.headers });
  const result = await savePrivatePhoto({
    db,
    storage: lazyStorage,
    session,
    purpose: fields.data.purpose,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  if (!result.ok) return error(result.status, result.message);
  return Response.json(result, { status: 201 });
}
