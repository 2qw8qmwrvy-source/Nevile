import { PHOTO_MAX_BYTES } from "@nevile/core";

/** Room for the multipart boundaries and the small text fields next to the photo. */
export const UPLOAD_MAX_REQUEST_BYTES = PHOTO_MAX_BYTES + 64 * 1024;

export type UploadForm =
  | { ok: true; form: FormData }
  | { ok: false; status: number; message: string };

const TOO_LARGE = "Photos can be up to 10 MB.";
const NOT_A_FORM = "Send the photo as a form upload.";

/**
 * Reads a multipart photo upload, never more than `maxBytes`. Browsers send Content-Length,
 * which is checked up front; Android's networking streams file parts without it (chunked),
 * so the limit is also enforced while reading.
 */
export async function readUploadForm(
  req: Request,
  maxBytes = UPLOAD_MAX_REQUEST_BYTES,
): Promise<UploadForm> {
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length <= 0) {
      return { ok: false, status: 400, message: NOT_A_FORM };
    }
    if (length > maxBytes) return { ok: false, status: 413, message: TOO_LARGE };
  }
  if (!req.body) return { ok: false, status: 400, message: NOT_A_FORM };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, status: 413, message: TOO_LARGE };
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const form = await new Response(body, {
      headers: { "content-type": req.headers.get("content-type") ?? "" },
    }).formData();
    return { ok: true, form };
  } catch {
    return { ok: false, status: 400, message: NOT_A_FORM };
  }
}
