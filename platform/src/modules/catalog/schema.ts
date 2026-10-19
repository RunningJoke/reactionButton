import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { users } from "../identity/schema";
import { organizations } from "../orgs/schema";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const VISIBILITIES = ["private", "team", "org", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const LICENCES = ["CC-BY-4.0", "CC0-1.0"] as const;
export type Licence = (typeof LICENCES)[number];

/** A shared program; its content lives in immutable revisions (spec §3.3). Soft-deleted so revisions stay usable. */
export const programs = pgTable(
  "programs",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    tags: text("tags").array().notNull().default([]),
    /** pods the program needs (peripherals + 1), from the latest published revision */
    pods: integer("pods").notNull().default(1),
    language: text("language").notNull().default("en"),
    licence: text("licence").$type<Licence>().notNull().default("CC-BY-4.0"),
    visibility: text("visibility").$type<Visibility>().notNull().default("private"),
    teamIds: uuid("team_ids").array().notNull().default([]),
    forkOf: uuid("fork_of").references((): AnyPgColumn => programRevisions.id, { onDelete: "set null" }),
    latestRevision: integer("latest_revision").notNull().default(0),
    publishedRevision: integer("published_revision"),
    ratingSum: integer("rating_sum").notNull().default(0),
    ratingCount: integer("rating_count").notNull().default(0),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [index("programs_org_idx").on(t.orgId), index("programs_visibility_idx").on(t.visibility, t.publishedRevision)],
);

/** One saved version of a program: the file text exactly as on the pod. Never changed after insert, except draft → published. */
export const programRevisions = pgTable(
  "program_revisions",
  {
    id: uuid("id").primaryKey(),
    programId: uuid("program_id")
      .notNull()
      .references((): AnyPgColumn => programs.id, { onDelete: "cascade" }),
    n: integer("n").notNull(),
    /** pod path the program was saved under, e.g. /prog/sprint.json */
    path: text("path").notNull(),
    text: text("text").notNull(),
    json: jsonb("json").$type<Record<string, unknown>>().notNull(),
    sha256: text("sha256").notNull(),
    programFormat: integer("program_format").notNull(),
    errors: integer("errors").notNull(),
    warnings: integer("warnings").notNull(),
    status: text("status").$type<"draft" | "published">().notNull(),
    via: text("via").notNull(),
    note: text("note").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("revisions_program_idx").on(t.programId, t.n)],
);

/** Named variable overrides of a program revision (spec §3.4). */
export const presets = pgTable(
  "presets",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => programRevisions.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    variables: jsonb("variables").$type<Record<string, number>>().notNull(),
    target: jsonb("target").$type<{ pods?: number; ageGroup?: string; level?: "easy" | "medium" | "hard" }>().notNull().default({}),
    notes: text("notes").notNull().default(""),
    visibility: text("visibility").$type<Visibility>().notNull().default("private"),
    teamIds: uuid("team_ids").array().notNull().default([]),
    /** draft = made by an AI client, waits for a person (spec §7.3) */
    status: text("status").$type<"draft" | "ready">().notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [index("presets_org_idx").on(t.orgId), index("presets_revision_idx").on(t.revisionId)],
);

/** A menu with its programs: what a pod set runs (spec §3.5). */
export const sets = pgTable(
  "sets",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    visibility: text("visibility").$type<Visibility>().notNull().default("private"),
    teamIds: uuid("team_ids").array().notNull().default([]),
    status: text("status").$type<"draft" | "ready">().notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [index("sets_org_idx").on(t.orgId)],
);

/** Menu entries in order; each points to a program revision or a preset. */
export const setItems = pgTable(
  "set_items",
  {
    setId: uuid("set_id")
      .notNull()
      .references(() => sets.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    revisionId: uuid("revision_id").references(() => programRevisions.id, { onDelete: "restrict" }),
    presetId: uuid("preset_id").references(() => presets.id, { onDelete: "restrict" }),
  },
  (t) => [primaryKey({ columns: [t.setId, t.position] })],
);

export const ratings = pgTable(
  "ratings",
  {
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stars: integer("stars").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.programId, t.userId] })],
);

/** Reports about public content; handled by platform admins (moderation tools in PL5). */
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey(),
    resourceType: text("resource_type").$type<"program" | "preset" | "set">().notNull(),
    resourceId: uuid("resource_id").notNull(),
    reason: text("reason").$type<"abuse" | "broken" | "licence" | "other">().notNull(),
    text: text("text").notNull().default(""),
    reportedBy: uuid("reported_by").references(() => users.id, { onDelete: "set null" }),
    state: text("state").$type<"open" | "hidden" | "dismissed">().notNull().default("open"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("reports_state_idx").on(t.state)],
);
