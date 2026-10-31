import {
  and,
  asc,
  type Database,
  type DbExecutor,
  eq,
  gt,
  inArray,
  isNull,
  notifications,
  pushTokens,
  sql,
} from "@nevile/db";

/** One push to one device (Expo push token). `path` is the website path it opens. */
export type PushMessage = { to: string; title: string; body: string; path: string };

/** Sends pushes; returns the tokens the push service says are no longer valid. */
export interface PushSender {
  send(messages: PushMessage[]): Promise<{ invalidTokens: string[] }>;
}

/** Expo push tokens look like `ExponentPushToken[xxxx]`. */
export const EXPO_PUSH_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,180}\]$/;

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_BATCH = 100;

/** Expo's push service (it relays to Apple and Google). */
export function expoPushSender(accessToken?: string): PushSender {
  return {
    async send(messages) {
      const invalidTokens: string[] = [];
      for (let start = 0; start < messages.length; start += EXPO_BATCH) {
        const batch = messages.slice(start, start + EXPO_BATCH);
        const response = await fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify(
            batch.map((message) => ({
              to: message.to,
              title: message.title,
              body: message.body,
              data: { path: message.path },
              sound: "default",
            })),
          ),
        });
        if (!response.ok) throw new Error(`Expo push failed with HTTP ${response.status}`);
        const tickets = (
          (await response.json()) as {
            data?: Array<{ status: string; details?: { error?: string } }>;
          }
        ).data;
        tickets?.forEach((ticket, index) => {
          const message = batch[index];
          if (
            message &&
            ticket.status === "error" &&
            ticket.details?.error === "DeviceNotRegistered"
          ) {
            invalidTokens.push(message.to);
          }
        });
      }
      return { invalidTokens };
    },
  };
}

/** Development: prints pushes (never the device tokens) instead of sending them. */
export const consolePushSender: PushSender = {
  async send(messages) {
    for (const message of messages) {
      console.info(`[dev push] ${message.title}: ${message.body} (${message.path})`);
    }
    return { invalidTokens: [] };
  },
};

/** Expo in production; the console elsewhere unless `NEVILE_DEV_PUSH=expo`. */
export function createPushSenderFromEnv(env: NodeJS.ProcessEnv = process.env): PushSender {
  const real = env.NODE_ENV === "production" || env.NEVILE_DEV_PUSH === "expo";
  return real ? expoPushSender(env.EXPO_ACCESS_TOKEN || undefined) : consolePushSender;
}

let shared: PushSender | undefined;
export const defaultPushSender: PushSender = {
  send: (messages) => {
    shared ??= createPushSenderFromEnv();
    return shared.send(messages);
  },
};

/** Pushes one message to every registered device of the given people. Never throws. */
export async function pushToUsers(
  deps: { db: DbExecutor; push: PushSender },
  userIds: readonly string[],
  message: Omit<PushMessage, "to">,
): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  try {
    const devices = await deps.db
      .select({ token: pushTokens.token })
      .from(pushTokens)
      .where(inArray(pushTokens.userId, unique));
    if (devices.length === 0) return;
    const { invalidTokens } = await deps.push.send(
      devices.map((device) => ({ ...message, to: device.token })),
    );
    if (invalidTokens.length > 0) {
      await deps.db.delete(pushTokens).where(inArray(pushTokens.token, invalidTokens));
    }
  } catch (error) {
    console.error("[push] could not send", error);
  }
}

/**
 * Pushes in-app notifications that haven't been pushed yet (created in the last hour),
 * claiming each one first so two callers never push it twice. Called after the flows that
 * notify, and by the scheduled jobs as a fallback. Never throws.
 */
export async function deliverPendingNotifications(deps: {
  db: Database;
  push: PushSender;
  now: () => Date;
}): Promise<number> {
  const now = deps.now();
  try {
    const pending = await deps.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          isNull(notifications.pushedAt),
          // Rows are stamped by the database clock, so compare with it.
          gt(notifications.createdAt, sql`now() - interval '1 hour'`),
        ),
      )
      .orderBy(asc(notifications.createdAt))
      .limit(200);
    if (pending.length === 0) return 0;
    const claimed = await deps.db
      .update(notifications)
      .set({ pushedAt: now })
      .where(
        and(
          inArray(
            notifications.id,
            pending.map((row) => row.id),
          ),
          isNull(notifications.pushedAt),
        ),
      )
      .returning({ userId: notifications.userId, payload: notifications.payload });
    for (const row of claimed) {
      const payload = row.payload as { text?: unknown; path?: unknown };
      if (typeof payload.text !== "string") continue;
      await pushToUsers(deps, [row.userId], {
        title: "Nevile",
        body: payload.text,
        path: typeof payload.path === "string" ? payload.path : "/inbox",
      });
    }
    return claimed.length;
  } catch (error) {
    console.error("[push] could not deliver notifications", error);
    return 0;
  }
}

/** Registers (or moves to this person) a device's push token. */
export async function registerPushToken(
  db: DbExecutor,
  userId: string,
  token: string,
  platform: "ios" | "android",
  now: Date,
): Promise<void> {
  await db
    .insert(pushTokens)
    .values({ userId, token, platform, lastSeenAt: now })
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: { userId, platform, lastSeenAt: now, updatedAt: sql`now()` },
    });
}

export async function unregisterPushToken(
  db: DbExecutor,
  userId: string,
  token: string,
): Promise<void> {
  await db
    .delete(pushTokens)
    .where(and(eq(pushTokens.token, token), eq(pushTokens.userId, userId)));
}
