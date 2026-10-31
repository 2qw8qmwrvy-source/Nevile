import { hasVerifiedContact, type Session } from "@nevile/auth";
import { MAX_BUSINESS_PHOTOS, PHOTO_MAX_BYTES } from "@nevile/core";
import {
  and,
  businesses,
  businessMembers,
  businessPhotos,
  count,
  type Database,
  eq,
  max,
} from "@nevile/db";
import {
  businessMediaKey,
  ImageRejectedError,
  type MediaKind,
  type MediaStorage,
  processImage,
} from "@nevile/storage";
import { LISTING_EDITOR_ROLES, withListingLock } from "./listing-state.ts";

/** Outcome of an upload, mapped to an HTTP status by the web route. */
export type UploadResult =
  | { ok: true; kind: MediaKind; id: string | null; url: string; width: number; height: number }
  | { ok: false; status: 400 | 401 | 403 | 404 | 409 | 413; message: string };

const fail = (status: Extract<UploadResult, { ok: false }>["status"], message: string) =>
  ({ ok: false, status, message }) as const;

export type SaveBusinessImageInput = {
  db: Database;
  storage: MediaStorage;
  session: Session | null;
  businessId: string;
  kind: MediaKind;
  bytes: Uint8Array;
};

/**
 * Saves a logo or work photo (SPEC §18). Server-only: called by the website's upload route
 * after it has read the request body. Checks the caller is a verified owner or manager,
 * re-encodes the image (dropping all metadata), stores it, then records it. A new logo
 * replaces the old one, whose file is deleted.
 */
export async function saveBusinessImage(input: SaveBusinessImageInput): Promise<UploadResult> {
  const { db, storage, session, businessId, kind, bytes } = input;
  if (!session) return fail(401, "Sign in to continue.");
  if (!hasVerifiedContact(session.user)) {
    return fail(403, "Confirm your email address or phone number to continue.");
  }
  if (bytes.byteLength === 0) return fail(400, "Choose a photo to upload.");
  if (bytes.byteLength > PHOTO_MAX_BYTES) return fail(413, "Photos can be up to 10 MB.");

  const [membership] = await db
    .select({ role: businessMembers.role })
    .from(businessMembers)
    .where(
      and(
        eq(businessMembers.businessId, businessId),
        eq(businessMembers.userId, session.user.id),
        eq(businessMembers.active, true),
      ),
    )
    .limit(1);
  if (!membership) return fail(404, "Business not found.");
  if (!(LISTING_EDITOR_ROLES as readonly string[]).includes(membership.role)) {
    return fail(403, "Only the owner and managers can change photos.");
  }
  if (kind === "photo" && (await photoCount(db, businessId)) >= MAX_BUSINESS_PHOTOS) {
    return fail(409, `You can add up to ${MAX_BUSINESS_PHOTOS} photos. Remove one first.`);
  }

  let image: Awaited<ReturnType<typeof processImage>>;
  try {
    image = await processImage(bytes, kind);
  } catch (error) {
    if (error instanceof ImageRejectedError) return fail(400, error.message);
    throw error;
  }

  const key = businessMediaKey(businessId, kind);
  await storage.put(key, image.data, image.contentType);
  let replacedKey: string | null = null;
  try {
    const recorded = await withListingLock(db, businessId, async (tx, business) => {
      if (kind === "logo") {
        replacedKey = business.logoKey;
        await tx.update(businesses).set({ logoKey: key }).where(eq(businesses.id, businessId));
        return { id: null };
      }
      // Checked again under the lock: two uploads at once can't pass the limit.
      if ((await photoCount(tx, businessId)) >= MAX_BUSINESS_PHOTOS) return null;
      const [last] = await tx
        .select({ value: max(businessPhotos.sortOrder) })
        .from(businessPhotos)
        .where(eq(businessPhotos.businessId, businessId));
      const [row] = await tx
        .insert(businessPhotos)
        .values({
          businessId,
          storageKey: key,
          width: image.width,
          height: image.height,
          sortOrder: (last?.value ?? -1) + 1,
        })
        .returning({ id: businessPhotos.id });
      return { id: row?.id ?? null };
    });
    if (!recorded) {
      await storage.delete(key);
      return fail(409, `You can add up to ${MAX_BUSINESS_PHOTOS} photos. Remove one first.`);
    }
    if (replacedKey) await deleteQuietly(storage, replacedKey);
    return {
      ok: true,
      kind,
      id: recorded.id,
      url: storage.publicUrl(key),
      width: image.width,
      height: image.height,
    };
  } catch (error) {
    await deleteQuietly(storage, key);
    throw error;
  }
}

async function photoCount(db: Pick<Database, "select">, businessId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(businessPhotos)
    .where(eq(businessPhotos.businessId, businessId));
  return row?.n ?? 0;
}

/**
 * Removes a stored file after its row is gone. A failure leaves an orphaned file (never a
 * broken page), so it is logged rather than surfaced.
 */
export async function deleteQuietly(storage: MediaStorage, key: string): Promise<void> {
  try {
    await storage.delete(key);
  } catch (error) {
    console.error("Could not delete stored media", { key, error });
  }
}
