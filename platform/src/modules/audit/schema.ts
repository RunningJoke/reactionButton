import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Every write and every agent call (spec §4, §7.3). Rows outlive users: actor ids are not foreign keys. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    orgId: uuid("org_id"),
    actorUserId: uuid("actor_user_id"),
    actorKind: text("actor_kind").notNull(),
    via: text("via").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("audit_org_idx").on(t.orgId, t.id), index("audit_actor_idx").on(t.actorUserId)],
);
