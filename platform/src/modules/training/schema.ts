import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { programRevisions, presets } from "../catalog/schema";
import { users } from "../identity/schema";
import { athletes, organizations } from "../orgs/schema";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export type MetricStats = { count: number; average: number; best: number; worst: number };

/**
 * One athlete on one pod set running one program (spec §3.7). `clientId` is the app's UUID, so a
 * repeated upload finds the session again (P22).
 */
export const trainingSessions = pgTable(
  "training_sessions",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    /** the pod set's setId (firmware, hex) */
    setId: text("set_id"),
    /** pod path of the program, e.g. /prog/dreieck.json */
    programPath: text("program_path").notNull(),
    revisionId: uuid("revision_id").references(() => programRevisions.id, { onDelete: "set null" }),
    presetId: uuid("preset_id").references(() => presets.id, { onDelete: "set null" }),
    contentSha256: text("content_sha256"),
    startedAt: ts("started_at").notNull(),
    notes: text("notes").notNull().default(""),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [unique("training_sessions_client_uq").on(t.orgId, t.clientId), index("training_sessions_athlete_idx").on(t.athleteId, t.startedAt)],
);

/** One report of a `communicate` block (#41), as the firmware sent it. */
export const trainingReports = pgTable(
  "training_reports",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => trainingSessions.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    /** the pod's report id; restarts after a reboot, so not a key */
    podReportId: integer("pod_report_id"),
    cycle: integer("cycle"),
    startMs: bigint("start_ms", { mode: "number" }),
    endMs: bigint("end_ms", { mode: "number" }),
    recordedAt: ts("recorded_at").notNull(),
    /** the firmware's statistics per metric, kept as sent */
    stats: jsonb("stats").$type<Record<string, MetricStats>>().notNull().default({}),
    vars: jsonb("vars").$type<Record<string, number>>().notNull().default({}),
    /** followed by a `repeat`: kept, not counted */
    discarded: boolean("discarded").notNull().default(false),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [unique("training_reports_client_uq").on(t.orgId, t.clientId), index("training_reports_session_idx").on(t.sessionId)],
);

/** Single measurements of a report. */
export const trainingValues = pgTable(
  "training_values",
  {
    reportId: uuid("report_id")
      .notNull()
      .references(() => trainingReports.id, { onDelete: "cascade" }),
    n: integer("n").notNull(),
    /** pod time (ms since boot of the central) */
    t: bigint("t", { mode: "number" }).notNull(),
    metric: text("metric").notNull(),
    pod: integer("pod").notNull(),
    ms: integer("ms").notNull(),
  },
  (t) => [primaryKey({ columns: [t.reportId, t.n] })],
);
