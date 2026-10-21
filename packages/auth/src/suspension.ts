import { type DbExecutor, eq, session, user } from "@nevile/db";

/**
 * Account suspension (SPEC §11 "suspend"). Nevile owns these columns (`user.suspended_at`,
 * `user.suspension_reason`); Better Auth's admin plugin is not used. A suspended user's
 * sessions are revoked here, and `createAuth` refuses to start a new session for them
 * (any sign-in method). The admin API must also write the audit log entry.
 */
export async function suspendUser(
  db: DbExecutor,
  userId: string,
  reason: string,
  at: Date = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ suspendedAt: at, suspensionReason: reason })
      .where(eq(user.id, userId));
    await tx.delete(session).where(eq(session.userId, userId));
  });
}

/** Lifts a suspension; the user signs in again as usual. */
export async function unsuspendUser(db: DbExecutor, userId: string): Promise<void> {
  await db
    .update(user)
    .set({ suspendedAt: null, suspensionReason: null })
    .where(eq(user.id, userId));
}

/** Whether `userId` is currently suspended. */
export async function isUserSuspended(db: DbExecutor, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ suspendedAt: user.suspendedAt })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row?.suspendedAt != null;
}
