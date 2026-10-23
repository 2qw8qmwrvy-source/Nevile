import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { assertSafeKey, contentTypeOfKey } from "./keys.ts";

export type StoredObject = { body: Uint8Array; contentType: string };

/** Where processed media lives (SPEC §18). Keys are always validated by `assertSafeKey`. */
export interface MediaStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  /** URL a browser can load the object from. */
  publicUrl(key: string): string;
}

/** Media served through the web app (`/api/media/<key>`) when there is no public bucket URL. */
export const MEDIA_ROUTE_PREFIX = "/api/media/";

function proxiedUrl(key: string): string {
  return `${MEDIA_ROUTE_PREFIX}${key}`;
}

/** Development storage: files in a local folder, served through the web app. */
export function createLocalStorage(rootDir: string): MediaStorage {
  const root = resolve(rootDir);
  const pathOf = (key: string) => {
    assertSafeKey(key);
    const path = resolve(join(root, key));
    if (!path.startsWith(root + sep)) throw new Error("Invalid storage key.");
    return path;
  };
  return {
    async put(key, body) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
    async get(key) {
      try {
        return {
          body: new Uint8Array(await readFile(pathOf(key))),
          contentType: contentTypeOfKey(key),
        };
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return null;
        throw error;
      }
    },
    async delete(key) {
      await rm(pathOf(key), { force: true });
    },
    publicUrl: proxiedUrl,
  };
}

export type S3StorageOptions = {
  bucket: string;
  /** e.g. https://<account>.r2.cloudflarestorage.com for Cloudflare R2. */
  endpoint?: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Public base URL of the bucket (custom domain); without it media is proxied. */
  publicBaseUrl?: string;
};

/** Production storage: any S3-compatible bucket (Cloudflare R2, AWS S3, …). */
export function createS3Storage(options: S3StorageOptions): MediaStorage {
  const client = new S3Client({
    region: options.region ?? "auto",
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
  });
  const base = options.publicBaseUrl?.replace(/\/+$/, "");
  return {
    async put(key, body, contentType) {
      assertSafeKey(key);
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // Keys are unique per upload, so objects never change.
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    },
    async get(key) {
      assertSafeKey(key);
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: options.bucket, Key: key }),
        );
        if (!result.Body) return null;
        return {
          body: await result.Body.transformToByteArray(),
          contentType: result.ContentType ?? contentTypeOfKey(key),
        };
      } catch (error) {
        if (error instanceof NoSuchKey) return null;
        throw error;
      }
    },
    async delete(key) {
      assertSafeKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: key }));
    },
    publicUrl: (key) => (base ? `${base}/${key}` : proxiedUrl(key)),
  };
}

/**
 * Storage from the environment:
 * - MEDIA_STORAGE=local (default outside production): MEDIA_LOCAL_DIR, default `<repo>/.media`
 * - MEDIA_STORAGE=s3 (required in production): S3_BUCKET, S3_ENDPOINT, S3_REGION,
 *   S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, optional MEDIA_PUBLIC_BASE_URL
 */
export function createStorageFromEnv(env: NodeJS.ProcessEnv = process.env): MediaStorage {
  const mode = env.MEDIA_STORAGE ?? (env.NODE_ENV === "production" ? "s3" : "local");
  if (mode === "local") {
    if (env.NODE_ENV === "production") {
      throw new Error("MEDIA_STORAGE=local is for development only; use s3 in production.");
    }
    const fallback = new URL("../../../.media", import.meta.url).pathname;
    return createLocalStorage(env.MEDIA_LOCAL_DIR || fallback);
  }
  if (mode !== "s3") throw new Error(`MEDIA_STORAGE must be "local" or "s3", got "${mode}".`);
  const missing = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter(
    (name) => !env[name],
  );
  if (missing.length > 0) throw new Error(`Media storage needs ${missing.join(", ")}.`);
  return createS3Storage({
    bucket: env.S3_BUCKET as string,
    endpoint: env.S3_ENDPOINT || undefined,
    region: env.S3_REGION || undefined,
    accessKeyId: env.S3_ACCESS_KEY_ID as string,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY as string,
    publicBaseUrl: env.MEDIA_PUBLIC_BASE_URL || undefined,
  });
}

let shared: MediaStorage | undefined;

/** One storage instance per process, created on first use. */
export function getStorage(): MediaStorage {
  shared ??= createStorageFromEnv();
  return shared;
}

/**
 * The process-wide storage, resolved on first use: a missing production configuration
 * fails the requests that touch media instead of every request.
 */
export const lazyStorage: MediaStorage = {
  put: (key, body, contentType) => getStorage().put(key, body, contentType),
  get: (key) => getStorage().get(key),
  delete: (key) => getStorage().delete(key),
  publicUrl: (key) => getStorage().publicUrl(key),
};
