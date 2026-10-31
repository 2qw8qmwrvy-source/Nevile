import { hasVerifiedContact, type Session } from "@nevile/auth";
import { MS_PER_DAY, MS_PER_HOUR, PHOTO_MAX_BYTES } from "@nevile/core";
import {
  and,
  asc,
  businessMembers,
  conversations,
  count,
  type Database,
  type DbExecutor,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  messages,
  privatePhotos,
  quoteRequests,
} from "@nevile/db";
import {
  ImageRejectedError,
  type MediaStorage,
  type PrivatePhotoPurpose,
  privatePhotoKey,
  processImage,
} from "@nevile/storage";
import { TRPCError } from "@trpc/server";
import { deleteQuietly } from "./media.ts";

/** Uploads one person may make per hour (quote and chat photos together). */
const UPLOADS_PER_HOUR = 60;

/** Unattached uploads are deleted after this long (scheduled job). */
const UNATTACHED_TTL_MS = MS_PER_DAY;

/** The owner and managers of a business see its quote requests and chat (SPEC §20). */
export const CONVERSATION_ROLES = ["owner", "manager"] as const;

export type PrivateUploadResult =
  | { ok: true; id: string; width: number; height: number }
  | { ok: false; status: 400 | 401 | 403 | 413 | 429; message: string };

const fail = (status: Extract<PrivateUploadResult, { ok: false }>["status"], message: string) =>
  ({ ok: false, status, message }) as const;

/**
 * Saves a private photo for a quote request or chat message (SPEC §20): re-encoded with
 * all metadata removed, stored under a random private key and recorded unattached. The
 * request or message it's added to attaches it (`attachPhotos`).
 */
export async function savePrivatePhoto(input: {
  db: Database;
  storage: MediaStorage;
  session: Session | null;
  purpose: PrivatePhotoPurpose;
  bytes: Uint8Array;
  now?: Date;
}): Promise<PrivateUploadResult> {
  const { db, storage, session, purpose, bytes } = input;
  const now = input.now ?? new Date();
  if (!session) return fail(401, "Sign in to continue.");
  if (!hasVerifiedContact(session.user)) {
    return fail(403, "Confirm your email address or phone number to continue.");
  }
  if (bytes.byteLength === 0) return fail(400, "Choose a photo to upload.");
  if (bytes.byteLength > PHOTO_MAX_BYTES) return fail(413, "Photos can be up to 10 MB.");
  const [recent] = await db
    .select({ n: count() })
    .from(privatePhotos)
    .where(
      and(
        eq(privatePhotos.ownerUserId, session.user.id),
        gte(privatePhotos.createdAt, new Date(now.getTime() - MS_PER_HOUR)),
      ),
    );
  if ((recent?.n ?? 0) >= UPLOADS_PER_HOUR) {
    return fail(429, "That's a lot of photos. Please wait a little before adding more.");
  }

  let image: Awaited<ReturnType<typeof processImage>>;
  try {
    image = await processImage(bytes, "photo");
  } catch (error) {
    if (error instanceof ImageRejectedError) return fail(400, error.message);
    throw error;
  }
  const key = privatePhotoKey(purpose);
  await storage.put(key, image.data, image.contentType);
  try {
    const [row] = await db
      .insert(privatePhotos)
      .values({
        ownerUserId: session.user.id,
        storageKey: key,
        width: image.width,
        height: image.height,
      })
      .returning({ id: privatePhotos.id });
    if (!row) throw new Error("photo insert returned nothing");
    return { ok: true, id: row.id, width: image.width, height: image.height };
  } catch (error) {
    await deleteQuietly(storage, key);
    throw error;
  }
}

/**
 * Attaches the caller's own unattached uploads, in the given order. Refuses ids that
 * aren't theirs, are already used, or don't exist.
 */
export async function attachPhotos(
  tx: DbExecutor,
  ownerUserId: string,
  photoIds: readonly string[],
  target: { quoteRequestGroupId: string } | { messageId: string },
): Promise<void> {
  if (photoIds.length === 0) return;
  const rows = await tx
    .select({ id: privatePhotos.id })
    .from(privatePhotos)
    .where(
      and(
        inArray(privatePhotos.id, [...photoIds]),
        eq(privatePhotos.ownerUserId, ownerUserId),
        isNull(privatePhotos.quoteRequestGroupId),
        isNull(privatePhotos.messageId),
      ),
    )
    .for("update");
  if (rows.length !== photoIds.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "One of the photos couldn't be added. Remove it and try again.",
    });
  }
  for (const [sortOrder, id] of photoIds.entries()) {
    await tx
      .update(privatePhotos)
      .set({ ...target, sortOrder })
      .where(eq(privatePhotos.id, id));
  }
}

/** Photos attached to quote request groups or messages, in order, as `{ id, w, h }`. */
export async function photosFor(
  db: DbExecutor,
  where: { groupIds: string[] } | { messageIds: string[] },
): Promise<Map<string, Array<{ id: string; width: number; height: number }>>> {
  const ids = "groupIds" in where ? where.groupIds : where.messageIds;
  if (ids.length === 0) return new Map();
  const column = "groupIds" in where ? privatePhotos.quoteRequestGroupId : privatePhotos.messageId;
  const rows = await db
    .select({
      id: privatePhotos.id,
      width: privatePhotos.width,
      height: privatePhotos.height,
      owner: column,
    })
    .from(privatePhotos)
    .where(inArray(column, ids))
    .orderBy(asc(privatePhotos.sortOrder));
  const map = new Map<string, Array<{ id: string; width: number; height: number }>>();
  for (const row of rows) {
    if (!row.owner) continue;
    const list = map.get(row.owner) ?? [];
    list.push({ id: row.id, width: row.width, height: row.height });
    map.set(row.owner, list);
  }
  return map;
}

/** Whether `userId` is the owner or a manager of `businessId`. */
async function managesBusiness(db: DbExecutor, userId: string, businessIds: string[]) {
  if (businessIds.length === 0) return false;
  const [row] = await db
    .select({ id: businessMembers.id })
    .from(businessMembers)
    .where(
      and(
        inArray(businessMembers.businessId, businessIds),
        eq(businessMembers.userId, userId),
        eq(businessMembers.active, true),
        inArray(businessMembers.role, [...CONVERSATION_ROLES]),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * The storage key of a private photo if `userId` may see it: its uploader; for a quote
 * request photo, the customer and the owner/managers of each pro it was sent to; for a
 * chat photo, the two sides of that conversation. Null otherwise (callers answer 404).
 */
export async function privatePhotoKeyFor(
  db: DbExecutor,
  userId: string,
  photoId: string,
): Promise<string | null> {
  const [photo] = await db.select().from(privatePhotos).where(eq(privatePhotos.id, photoId));
  if (!photo) return null;
  if (photo.ownerUserId === userId) return photo.storageKey;
  if (photo.quoteRequestGroupId) {
    const copies = await db
      .select({ customerId: quoteRequests.customerId, businessId: quoteRequests.businessId })
      .from(quoteRequests)
      .where(eq(quoteRequests.groupId, photo.quoteRequestGroupId));
    if (copies.some((copy) => copy.customerId === userId)) return photo.storageKey;
    const allowed = await managesBusiness(
      db,
      userId,
      copies.map((copy) => copy.businessId),
    );
    return allowed ? photo.storageKey : null;
  }
  if (photo.messageId) {
    const [row] = await db
      .select({ customerId: conversations.customerId, businessId: conversations.businessId })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(eq(messages.id, photo.messageId));
    if (!row) return null;
    if (row.customerId === userId) return photo.storageKey;
    return (await managesBusiness(db, userId, [row.businessId])) ? photo.storageKey : null;
  }
  return null;
}

/** Deletes uploads never attached to a request or message (scheduled job). */
export async function cleanUpUnattachedPhotos(
  db: Database,
  storage: MediaStorage,
  now: Date,
): Promise<number> {
  const stale = await db
    .select({ id: privatePhotos.id, key: privatePhotos.storageKey })
    .from(privatePhotos)
    .where(
      and(
        isNull(privatePhotos.quoteRequestGroupId),
        isNull(privatePhotos.messageId),
        lt(privatePhotos.createdAt, new Date(now.getTime() - UNATTACHED_TTL_MS)),
      ),
    )
    .limit(500);
  for (const photo of stale) {
    await db.delete(privatePhotos).where(eq(privatePhotos.id, photo.id));
    await deleteQuietly(storage, photo.key);
  }
  return stale.length;
}
