import { boolean, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "../identity/schema";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const ROLES = ["owner", "admin", "coach", "athlete", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey(),
  kind: text("kind").$type<"personal" | "club">().notNull(),
  name: text("name").notNull(),
  country: text("country"),
  /** club admins allow AI clients to see athletes' real names (spec §7.3) */
  agentRealNames: boolean("agent_real_names").notNull().default(false),
  createdAt: ts("created_at").notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<Role>().notNull(),
    /** empty = whole club; otherwise the membership is limited to these teams */
    teamIds: uuid("team_ids").array().notNull().default([]),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index("memberships_user_idx").on(t.userId)],
);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    leaderboard: boolean("leaderboard").notNull().default(false),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("teams_org_idx").on(t.orgId)],
);

/** Athletes belong to the club; userId is set once a user claimed the profile. */
export const athletes = pgTable(
  "athletes",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    birthYear: integer("birth_year"),
    teamIds: uuid("team_ids").array().notNull().default([]),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("athletes_org_idx").on(t.orgId)],
);

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull().unique(),
    email: text("email"),
    role: text("role").$type<Role>().notNull(),
    teamIds: uuid("team_ids").array().notNull().default([]),
    /** accepting the invite links this athlete profile to the user (claim) */
    athleteId: uuid("athlete_id").references(() => athletes.id, { onDelete: "cascade" }),
    maxUses: integer("max_uses").notNull().default(1),
    uses: integer("uses").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("invites_org_idx").on(t.orgId)],
);
