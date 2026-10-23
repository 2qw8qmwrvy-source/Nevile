import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  businessIdOfKey,
  businessMediaKey,
  createLocalStorage,
  createStorageFromEnv,
  ImageRejectedError,
  isSafeKey,
  processImage,
} from "./index.ts";

const BUSINESS_ID = "0e6f4c1a-3b7d-4c55-9a1e-6f2b8d9c0a11";

async function jpeg(width: number, height: number, exif?: Record<string, Record<string, string>>) {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 120, b: 80 } },
  }).jpeg();
  return new Uint8Array(await (exif ? image.withExif(exif) : image).toBuffer());
}

describe("storage keys", () => {
  it("builds unique WebP keys per business and kind", () => {
    const photo = businessMediaKey(BUSINESS_ID, "photo");
    const logo = businessMediaKey(BUSINESS_ID, "logo");
    expect(photo).toMatch(new RegExp(`^businesses/${BUSINESS_ID}/photos/[0-9a-f-]{36}\\.webp$`));
    expect(logo).toMatch(new RegExp(`^businesses/${BUSINESS_ID}/logo/[0-9a-f-]{36}\\.webp$`));
    expect(businessMediaKey(BUSINESS_ID, "photo")).not.toBe(photo);
    expect(businessIdOfKey(photo)).toBe(BUSINESS_ID);
    expect(businessIdOfKey("other/thing.webp")).toBeNull();
  });

  it("rejects traversal and odd characters", () => {
    for (const key of [
      "../etc/passwd",
      "businesses/../../x",
      "/abs/path.webp",
      "a//b.webp",
      "Upper/Case.webp",
      "a\\b.webp",
      "a b.webp",
      "",
      `${"a".repeat(260)}.webp`,
    ]) {
      expect(isSafeKey(key), key).toBe(false);
    }
    expect(isSafeKey(`businesses/${BUSINESS_ID}/photos/x.webp`)).toBe(true);
  });
});

describe("local storage", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nevile-media-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("stores, reads and deletes objects", async () => {
    const storage = createLocalStorage(dir);
    const key = businessMediaKey(BUSINESS_ID, "photo");
    const body = new Uint8Array([1, 2, 3, 4]);
    await storage.put(key, body, "image/webp");
    expect(await storage.get(key)).toEqual({ body, contentType: "image/webp" });
    expect(storage.publicUrl(key)).toBe(`/api/media/${key}`);
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
    await storage.delete(key); // deleting twice is fine
  });

  it("never touches paths outside its folder", async () => {
    const storage = createLocalStorage(join(dir, "inner"));
    await expect(storage.put("../escape.webp", new Uint8Array([1]), "image/webp")).rejects.toThrow(
      "Invalid storage key.",
    );
    await expect(storage.get("../../etc/passwd")).rejects.toThrow("Invalid storage key.");
    expect(await readdir(dir)).not.toContain("escape.webp");
  });
});

describe("storage from env", () => {
  it("defaults to local outside production and refuses local in production", () => {
    expect(() =>
      createStorageFromEnv({ NODE_ENV: "development", MEDIA_LOCAL_DIR: "/tmp/x" }),
    ).not.toThrow();
    expect(() => createStorageFromEnv({ NODE_ENV: "production", MEDIA_STORAGE: "local" })).toThrow(
      /development only/,
    );
  });

  it("needs bucket credentials for s3", () => {
    expect(() => createStorageFromEnv({ NODE_ENV: "production" })).toThrow(
      "Media storage needs S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.",
    );
    const storage = createStorageFromEnv({
      NODE_ENV: "production",
      S3_BUCKET: "nevile-media",
      S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
      S3_ACCESS_KEY_ID: "id",
      S3_SECRET_ACCESS_KEY: "secret",
      MEDIA_PUBLIC_BASE_URL: "https://media.example.com/",
    });
    expect(storage.publicUrl("businesses/x/photos/y.webp")).toBe(
      "https://media.example.com/businesses/x/photos/y.webp",
    );
  });

  it("rejects unknown modes", () => {
    expect(() => createStorageFromEnv({ MEDIA_STORAGE: "ftp" })).toThrow(/must be "local" or "s3"/);
  });
});

describe("processImage", () => {
  it("re-encodes photos as WebP without EXIF or GPS", async () => {
    const input = await jpeg(800, 600, {
      IFD0: { Copyright: "secret-owner", Make: "PhoneCo" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "44/1 38/1 0/1" },
    });
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined();

    const result = await processImage(input, "photo");
    expect(result.contentType).toBe("image/webp");
    expect([result.width, result.height]).toEqual([800, 600]);
    const after = await sharp(result.data).metadata();
    expect(after.format).toBe("webp");
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(Buffer.from(result.data).includes("secret-owner")).toBe(false);
    expect(Buffer.from(result.data).includes("GPS")).toBe(false);
  });

  it("fits large photos inside 1600 px and never enlarges small ones", async () => {
    const large = await processImage(await jpeg(4000, 3000), "photo");
    expect([large.width, large.height]).toEqual([1600, 1200]);
    const small = await processImage(await jpeg(300, 200), "photo");
    expect([small.width, small.height]).toEqual([300, 200]);
  });

  it("applies the camera orientation before dropping it", async () => {
    const rotated = new Uint8Array(
      await sharp({ create: { width: 400, height: 200, channels: 3, background: "#336699" } })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer(),
    );
    const result = await processImage(rotated, "photo");
    expect([result.width, result.height]).toEqual([200, 400]);
  });

  it("makes logos a 512 px square", async () => {
    const result = await processImage(await jpeg(900, 400), "logo");
    expect([result.width, result.height]).toEqual([512, 512]);
  });

  it("accepts PNG and WebP", async () => {
    const png = new Uint8Array(
      await sharp({ create: { width: 50, height: 50, channels: 4, background: "#fff0" } })
        .png()
        .toBuffer(),
    );
    const webp = new Uint8Array(
      await sharp({ create: { width: 50, height: 50, channels: 3, background: "#000" } })
        .webp()
        .toBuffer(),
    );
    await expect(processImage(png, "photo")).resolves.toMatchObject({ width: 50 });
    await expect(processImage(webp, "logo")).resolves.toMatchObject({ width: 512 });
  });

  it("rejects files that aren't accepted images", async () => {
    const text = new TextEncoder().encode("hello, not an image");
    await expect(processImage(text, "photo")).rejects.toBeInstanceOf(ImageRejectedError);
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    await expect(processImage(svg, "photo")).rejects.toThrow(
      "Use a JPEG, PNG, WebP or HEIC photo.",
    );
    const gif = new Uint8Array(
      await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } })
        .gif()
        .toBuffer(),
    );
    await expect(processImage(gif, "photo")).rejects.toThrow(
      "Use a JPEG, PNG, WebP or HEIC photo.",
    );
  });

  it("refuses decompression bombs", async () => {
    // 10000 × 6000 = 60 MP, above the 50 MP limit, but tiny as a PNG.
    const bomb = new Uint8Array(
      await sharp({ create: { width: 10000, height: 6000, channels: 3, background: "#000" } })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    );
    await expect(processImage(bomb, "photo")).rejects.toBeInstanceOf(ImageRejectedError);
  });
});
