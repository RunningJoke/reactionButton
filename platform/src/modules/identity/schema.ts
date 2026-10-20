import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  /** lower-case */
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull().default(""),
  locale: text("locale").notNull().default("en"),
  createdAt: ts("created_at").notNull(),
});

/** A sign-in by email: link token and 6-digit code, both stored hashed. */
export const loginRequests = pgTable(
  "login_requests",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: ts("created_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    ip: text("ip"),
  },
  (t) => [index("login_requests_email_idx").on(t.email)],
);

export type TokenKind = "session" | "pat" | "oauth" | "agent";

/** Opaque bearer tokens (hashed). Sessions now; personal access, OAuth and agent tokens in PL4. */
export const accessTokens = pgTable(
  "access_tokens",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    kind: text("kind").$type<TokenKind>().notNull(),
    scopes: text("scopes").array().notNull(),
    label: text("label").notNull().default(""),
    createdAt: ts("created_at").notNull(),
    lastUsedAt: ts("last_used_at"),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("access_tokens_user_idx").on(t.userId)],
);
