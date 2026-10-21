import { bigint, boolean, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, tstz, updatedAt } from "./columns.ts";

/**
 * Better Auth 1.7 core tables for the drizzle adapter (`provider: "pg"`, `usePlural: false`).
 * Property keys must match Better Auth field names exactly; database columns are snake_case.
 * IDs are text because Better Auth generates them. Extra columns must stay nullable or
 * defaulted, otherwise Better Auth's schema check rejects inserts it never fills.
 * Better Auth's admin plugin is not used: platform admins and suspensions are Nevile's
 * own columns below, enforced by @nevile/auth (`suspendUser`, session-creation hook).
 */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // phone-number plugin
  phoneNumber: text("phone_number").unique(),
  phoneNumberVerified: boolean("phone_number_verified").default(false),
  // Nevile-owned (not Better Auth fields, so never settable through the auth API).
  // Platform admin for the admin panel (SPEC §11).
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  // Suspension (SPEC §11): set with `suspendUser` from @nevile/auth, which also revokes
  // the user's sessions; a suspended user cannot start a new session.
  suspendedAt: tstz("suspended_at"),
  suspensionReason: text("suspension_reason"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: tstz("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tstz("access_token_expires_at"),
    refreshTokenExpiresAt: tstz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("account_user_id_idx").on(t.userId),
    uniqueIndex("account_provider_account_uidx").on(t.providerId, t.accountId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/** Used when Better Auth is configured with `rateLimit.storage: "database"`. */
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  // Epoch milliseconds, as Better Auth writes it.
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});
