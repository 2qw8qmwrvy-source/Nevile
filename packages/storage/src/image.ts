import sharp from "sharp";
import type { MediaKind } from "./keys.ts";

/** Formats accepted on upload (SPEC §18). The output is always WebP. */
export const ACCEPTED_IMAGE_FORMATS = ["jpeg", "png", "webp", "heif"] as const;
export const ACCEPTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

/** Refuse decompression bombs: 50 megapixels is far above any phone camera's output. */
const MAX_INPUT_PIXELS = 50_000_000;
const PHOTO_MAX_EDGE = 1600;
const LOGO_SIZE = 512;

export type ProcessedImage = {
  data: Uint8Array;
  width: number;
  height: number;
  contentType: "image/webp";
};

export class ImageRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageRejectedError";
  }
}

/**
 * Re-encodes an uploaded image (SPEC §18): honours the camera's orientation, then writes a
 * fresh WebP with **no metadata** (EXIF, GPS, XMP, ICC comments). Photos fit inside 1600 px;
 * logos become a 512 px square. Anything sharp can't decode, or that isn't an accepted
 * format, is rejected without being stored.
 */
export async function processImage(input: Uint8Array, kind: MediaKind): Promise<ProcessedImage> {
  const metadata = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .metadata()
    .catch(() => {
      throw new ImageRejectedError("That file isn't an image we can read.");
    });
  if (
    !metadata.format ||
    !(ACCEPTED_IMAGE_FORMATS as readonly string[]).includes(metadata.format)
  ) {
    throw new ImageRejectedError("Use a JPEG, PNG, WebP or HEIC photo.");
  }

  const pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
    // Apply the EXIF orientation, so the picture looks right once the EXIF is gone.
    .rotate();
  const resized =
    kind === "logo"
      ? pipeline.resize(LOGO_SIZE, LOGO_SIZE, { fit: "cover", position: "attention" })
      : pipeline.resize(PHOTO_MAX_EDGE, PHOTO_MAX_EDGE, {
          fit: "inside",
          withoutEnlargement: true,
        });

  try {
    // sharp writes no metadata unless asked (withMetadata/keepExif), so the output is clean.
    const { data, info } = await resized
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    return {
      data: new Uint8Array(data),
      width: info.width,
      height: info.height,
      contentType: "image/webp",
    };
  } catch {
    // The bundled libvips decodes AVIF-style HEIF only; iPhone HEIC (HEVC) lands here. Browsers
    // and the app send iPhone photos as JPEG, so this is rare (a file copied off a phone).
    throw new ImageRejectedError(
      metadata.format === "heif"
        ? "We couldn't read that HEIC photo. Save it as a JPEG and try again."
        : "That image couldn't be processed. Try another file.",
    );
  }
}
