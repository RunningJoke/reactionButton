import { and, arrayOverlaps, asc, desc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../../adapters/db";
import type { Ctx } from "../../core/context";
import { conflict, forbidden, invalidInput, notFound } from "../../core/errors";
import { uuidv7 } from "../../core/ids";
import { Id, iso, Ok, ok, Timestamp } from "../../core/schemas";
import { defineUseCase } from "../../core/useCase";
import { recordAudit } from "../audit/record";
import { loadReader, sees, type Reader } from "../catalog/access";
import { presets, programRevisions, programs } from "../catalog/schema";
import { atLeast, requireMember, seesTeams, type Member } from "../orgs/policies";
import { athletes, organizations, teams } from "../orgs/schema";
import { pseudonym } from "../orgs/useCases";
import { trainingReports, trainingSessions, trainingValues } from "./schema";

/** Most single values in one upload (all sessions and reports together). */
export const MAX_UPLOAD_VALUES = 20_000;

const Metric = z.string().min(1).max(32);
const ProgramPath = z.string().startsWith("/").max(31).describe("pod path of the program, e.g. /prog/dreieck.json");
const SetId = z
  .string()
  .regex(/^[0-9a-fA-F]{1,16}$/)
  .describe("the pod set's setId (hex, from the firmware)");
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

const Value = z.object({
  t: z.number().int().min(0).describe("pod time, ms since the central started"),
  metric: Metric,
  pod: z.number().int().min(0).max(255),
  ms: z.number().int().min(0).max(86_400_000),
});
const Stats = z.record(
  Metric,
  z.object({ count: z.number().int().min(0), average: z.number(), best: z.number(), worst: z.number() }),
);
const Vars = z.record(z.string().min(1).max(32), z.number());

const ReportIn = z.object({
  id: Id.describe("UUID made by the app; a repeated upload with the same id stores nothing twice"),
  podReportId: z.number().int().min(0).optional().describe("the pod's report id (restarts after a reboot)"),
  cycle: z.number().int().min(0).optional(),
  startMs: z.number().int().min(0).optional(),
  endMs: z.number().int().min(0).optional(),
  recordedAt: Timestamp.describe("when the app received the report"),
  discarded: z.boolean().default(false).describe("followed by a repeat: kept, not counted"),
  values: z.array(Value).max(2000).default([]),
  stats: Stats.default({}).describe("the firmware's statistics, kept as sent"),
  vars: Vars.default({}),
});

const SessionIn = z.object({
  id: Id.describe("UUID made by the app"),
  athleteId: Id,
  setId: SetId.optional(),
  programPath: ProgramPath,
  revisionId: Id.optional().describe("platform revision the program came from, if known"),
  presetId: Id.optional().describe("platform preset the program came from, if known"),
  contentSha256: Sha256.optional().describe("SHA-256 of the program file on the pod"),
  startedAt: Timestamp,
  notes: z.string().max(500).default(""),
  reports: z.array(ReportIn).max(200).default([]),
});

const AthleteRef = z.object({ id: Id, name: z.string().describe("pseudonym for AI clients unless the club allows real names") });

const SessionSummary = z.object({
  id: Id,
  clientId: Id,
  athlete: AthleteRef,
  setId: z.string().nullable(),
  programPath: z.string(),
  revisionId: Id.nullable(),
  presetId: Id.nullable(),
  contentSha256: z.string().nullable(),
  startedAt: Timestamp,
  notes: z.string(),
  reports: z.number().int(),
  discardedReports: z.number().int(),
  createdAt: Timestamp,
});

const ReportOut = z.object({
  id: Id,
  clientId: Id,
  podReportId: z.number().int().nullable(),
  cycle: z.number().int().nullable(),
  startMs: z.number().int().nullable(),
  endMs: z.number().int().nullable(),
  recordedAt: Timestamp,
  discarded: z.boolean(),
  values: z.array(Value),
  stats: Stats,
  vars: Vars,
});

const OrgPath = z.object({ orgId: Id });

// ---------- rights ----------

type AthleteRow = typeof athletes.$inferSelect;

/** Who reads results in a club: coaches and above (their teams), athletes (their own profile). Viewers get 403. */
type Viewer = { me: Member; realNames: boolean; via: Ctx["via"] };

async function resultViewer(tx: Tx, ctx: Ctx, orgId: string): Promise<Viewer> {
  const me = await requireMember(tx, ctx, orgId, "athlete");
  const [org] = await tx.select({ realNames: organizations.agentRealNames }).from(organizations).where(eq(organizations.id, orgId));
  return { me, realNames: org!.realNames, via: ctx.via };
}

const isCoach = (v: Viewer) => atLeast(v.me.role, "coach");

function seesAthlete(v: Viewer, a: Pick<AthleteRow, "teamIds" | "userId">): boolean {
  return isCoach(v) ? seesTeams(v.me, a.teamIds) : a.userId === v.me.userId;
}

/** The same rule as `seesAthlete`, as SQL on the athletes table. */
function athleteFilter(v: Viewer): SQL | undefined {
  if (!isCoach(v)) return eq(athletes.userId, v.me.userId);
  return v.me.teamIds.length > 0 ? arrayOverlaps(athletes.teamIds, v.me.teamIds) : undefined;
}

const athleteName = (v: Viewer, a: { id: string; name: string }) => (v.via === "mcp" && !v.realNames ? pseudonym(a.id) : a.name);

async function loadAthlete(tx: Tx, v: Viewer, orgId: string, athleteId: string): Promise<AthleteRow> {
  const [a] = await tx.select().from(athletes).where(and(eq(athletes.id, athleteId), eq(athletes.orgId, orgId)));
  if (!a || !seesAthlete(v, a)) throw notFound("Athlete not found.");
  return a;
}

function requireCoach(v: Viewer): void {
  if (!isCoach(v)) throw forbidden("Needs role coach or higher.");
}

/** A revision or preset named by an upload must exist and be visible to the caller (or belong to the club). */
async function checkSource(tx: Tx, reader: Reader, orgId: string, revisionId?: string, presetId?: string): Promise<void> {
  if (revisionId) {
    const [p] = await tx
      .select({ orgId: programs.orgId, visibility: programs.visibility, teamIds: programs.teamIds, createdBy: programs.createdBy })
      .from(programRevisions)
      .innerJoin(programs, eq(programs.id, programRevisions.programId))
      .where(eq(programRevisions.id, revisionId));
    if (!p || (p.orgId !== orgId && !sees(reader, p))) throw invalidInput("Unknown revisionId.");
  }
  if (presetId) {
    const [p] = await tx.select().from(presets).where(eq(presets.id, presetId));
    if (!p || (p.orgId !== orgId && !sees(reader, p))) throw invalidInput("Unknown presetId.");
  }
}

// ---------- reading ----------

type SessionRow = typeof trainingSessions.$inferSelect;

const reportCount = sql<number>`(select count(*)::int from ${trainingReports} where ${trainingReports.sessionId} = ${trainingSessions.id})`;
const discardedCount = sql<number>`(select count(*)::int from ${trainingReports} where ${trainingReports.sessionId} = ${trainingSessions.id} and ${trainingReports.discarded})`;

function toSummary(v: Viewer, s: SessionRow, a: { id: string; name: string }, counts: { reports: number; discarded: number }) {
  return {
    id: s.id,
    clientId: s.clientId,
    athlete: { id: a.id, name: athleteName(v, a) },
    setId: s.setId,
    programPath: s.programPath,
    revisionId: s.revisionId,
    presetId: s.presetId,
    contentSha256: s.contentSha256,
    startedAt: iso(s.startedAt),
    notes: s.notes,
    reports: counts.reports,
    discardedReports: counts.discarded,
    createdAt: iso(s.createdAt),
  };
}

/** Reports with their values, per session id, in recording order. */
export async function reportsOf(tx: Tx, sessionIds: string[]): Promise<Map<string, z.input<typeof ReportOut>[]>> {
  const out = new Map<string, z.input<typeof ReportOut>[]>();
  if (sessionIds.length === 0) return out;
  const reports = await tx
    .select()
    .from(trainingReports)
    .where(inArray(trainingReports.sessionId, sessionIds))
    .orderBy(asc(trainingReports.recordedAt), asc(trainingReports.id));
  const values = reports.length
    ? await tx
        .select()
        .from(trainingValues)
        .where(inArray(trainingValues.reportId, reports.map((r) => r.id)))
        .orderBy(asc(trainingValues.reportId), asc(trainingValues.n))
    : [];
  const byReport = new Map<string, z.input<typeof Value>[]>();
  for (const x of values) {
    const list = byReport.get(x.reportId) ?? [];
    list.push({ t: x.t, metric: x.metric, pod: x.pod, ms: x.ms });
    byReport.set(x.reportId, list);
  }
  for (const r of reports) {
    const list = out.get(r.sessionId) ?? [];
    list.push({
      id: r.id,
      clientId: r.clientId,
      podReportId: r.podReportId,
      cycle: r.cycle,
      startMs: r.startMs,
      endMs: r.endMs,
      recordedAt: iso(r.recordedAt),
      discarded: r.discarded,
      values: byReport.get(r.id) ?? [],
      stats: r.stats,
      vars: r.vars,
    });
    out.set(r.sessionId, list);
  }
  return out;
}

/** Sessions with reports of the given athletes (data export of claimed profiles). */
export async function resultsOfAthletes(tx: Tx, athleteIds: string[]) {
  if (athleteIds.length === 0) return [];
  const sessions = await tx
    .select()
    .from(trainingSessions)
    .where(inArray(trainingSessions.athleteId, athleteIds))
    .orderBy(asc(trainingSessions.startedAt));
  const reports = await reportsOf(tx, sessions.map((s) => s.id));
  return sessions.map((s) => ({
    id: s.id,
    athleteId: s.athleteId,
    setId: s.setId,
    programPath: s.programPath,
    startedAt: iso(s.startedAt),
    notes: s.notes,
    reports: reports.get(s.id) ?? [],
  }));
}

const encodeCursor = (s: { startedAt: Date; id: string }) => Buffer.from(JSON.stringify([s.startedAt.toISOString(), s.id])).toString("base64url");

function decodeCursor(cursor: string): { startedAt: Date; id: string } {
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, "base64url").toString()) as [string, string];
    const startedAt = new Date(at);
    if (Number.isNaN(startedAt.getTime()) || !Id.safeParse(id).success) throw new Error();
    return { startedAt, id };
  } catch {
    throw invalidInput("Invalid cursor.");
  }
}

export const listTrainingSessions = defineUseCase({
  name: "list_training_sessions",
  title: "Training sessions",
  description:
    "Training sessions of a club, newest first, optionally of one athlete or team and in a time range. " +
    "Coaches see their teams' athletes, athletes their own profile. AI clients get pseudonyms unless the club allows real names.",
  http: { method: "get", path: "/v1/orgs/{orgId}/training/sessions" },
  tag: "training",
  scope: "results:read",
  agent: "allow",
  readOnly: true,
  input: OrgPath.extend({
    athleteId: Id.optional(),
    teamId: Id.optional(),
    from: Timestamp.optional().describe("sessions started at or after"),
    to: Timestamp.optional().describe("sessions started before"),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  output: z.object({ sessions: z.array(SessionSummary), nextCursor: z.string().nullable() }),
  run: async (ctx, { orgId, athleteId, teamId, from, to, cursor, limit }) => {
    const db = ctx.ports.db;
    const v = await resultViewer(db, ctx, orgId);
    const after = cursor ? decodeCursor(cursor) : null;
    const rows = await db
      .select({ s: trainingSessions, a: { id: athletes.id, name: athletes.name }, reports: reportCount, discarded: discardedCount })
      .from(trainingSessions)
      .innerJoin(athletes, eq(athletes.id, trainingSessions.athleteId))
      .where(
        and(
          eq(trainingSessions.orgId, orgId),
          athleteFilter(v),
          athleteId ? eq(trainingSessions.athleteId, athleteId) : undefined,
          teamId ? sql`${teamId}::uuid = any(${athletes.teamIds})` : undefined,
          from ? gte(trainingSessions.startedAt, new Date(from)) : undefined,
          to ? lt(trainingSessions.startedAt, new Date(to)) : undefined,
          after
            ? or(
                lt(trainingSessions.startedAt, after.startedAt),
                and(eq(trainingSessions.startedAt, after.startedAt), lt(trainingSessions.id, after.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(trainingSessions.startedAt), desc(trainingSessions.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      sessions: page.map((r) => toSummary(v, r.s, r.a, r)),
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]!.s) : null,
    };
  },
});

const SessionPath = OrgPath.extend({ sessionId: Id });

/** The session if the viewer sees its athlete, else 404. */
async function loadSession(tx: Tx, v: Viewer, orgId: string, sessionId: string) {
  const [row] = await tx
    .select({ s: trainingSessions, a: athletes })
    .from(trainingSessions)
    .innerJoin(athletes, eq(athletes.id, trainingSessions.athleteId))
    .where(and(eq(trainingSessions.id, sessionId), eq(trainingSessions.orgId, orgId)));
  if (!row || !seesAthlete(v, row.a)) throw notFound("Training session not found.");
  return row;
}

export const getTrainingSession = defineUseCase({
  name: "get_training_session",
  title: "A training session",
  description: "A training session with all its reports and single values.",
  http: { method: "get", path: "/v1/orgs/{orgId}/training/sessions/{sessionId}" },
  tag: "training",
  scope: "results:read",
  agent: "allow",
  readOnly: true,
  input: SessionPath,
  output: SessionSummary.extend({ reportList: z.array(ReportOut) }),
  run: async (ctx, { orgId, sessionId }) => {
    const db = ctx.ports.db;
    const v = await resultViewer(db, ctx, orgId);
    const { s, a } = await loadSession(db, v, orgId, sessionId);
    const reportList = (await reportsOf(db, [s.id])).get(s.id) ?? [];
    const discarded = reportList.filter((r) => r.discarded).length;
    return { ...toSummary(v, s, a, { reports: reportList.length, discarded }), reportList };
  },
});

// ---------- writing ----------

export const uploadTraining = defineUseCase({
  name: "upload_training",
  title: "Upload training results",
  description:
    "Uploads training sessions with their reports from the app's offline queue. Idempotent: sessions and " +
    "reports are found again by the app's ids, so a retry stores nothing twice; a repeated report may only " +
    "change `discarded`. Coaches upload for their athletes, athletes for their own profile.",
  http: { method: "post", path: "/v1/orgs/{orgId}/training/upload" },
  tag: "training",
  scope: "results:write",
  agent: "deny",
  input: OrgPath.extend({ sessions: z.array(SessionIn).min(1).max(50) }),
  output: z.object({
    sessions: z.array(z.object({ clientId: Id, id: Id, created: z.boolean() })),
    reports: z.array(z.object({ clientId: Id, id: Id, status: z.enum(["created", "updated", "unchanged"]) })),
  }),
  run: async (ctx, { orgId, sessions }) => {
    const total = sessions.reduce((n, s) => n + s.reports.reduce((m, r) => m + r.values.length, 0), 0);
    if (total > MAX_UPLOAD_VALUES) throw invalidInput(`At most ${MAX_UPLOAD_VALUES} values per upload; split it.`);
    const reportIds = sessions.flatMap((s) => s.reports.map((r) => r.id));
    if (new Set(reportIds).size !== reportIds.length || new Set(sessions.map((s) => s.id)).size !== sessions.length) {
      throw invalidInput("Duplicate ids in the upload.");
    }
    return ctx.ports.db.transaction(async (tx) => {
      const v = await resultViewer(tx, ctx, orgId);
      const reader = await loadReader(tx, ctx);
      const now = ctx.ports.clock();
      const out = { sessions: [] as { clientId: string; id: string; created: boolean }[], reports: [] as { clientId: string; id: string; status: "created" | "updated" | "unchanged" }[] };

      for (const s of sessions) {
        const a = await loadAthlete(tx, v, orgId, s.athleteId);
        if (!isCoach(v) && a.userId !== v.me.userId) throw forbidden("Upload results for your own profile only.");
        await checkSource(tx, reader, orgId, s.revisionId, s.presetId);

        const [inserted] = await tx
          .insert(trainingSessions)
          .values({
            id: uuidv7(now.getTime()),
            orgId,
            clientId: s.id,
            athleteId: s.athleteId,
            setId: s.setId?.toLowerCase() ?? null,
            programPath: s.programPath,
            revisionId: s.revisionId ?? null,
            presetId: s.presetId ?? null,
            contentSha256: s.contentSha256 ?? null,
            startedAt: new Date(s.startedAt),
            notes: s.notes,
            uploadedBy: v.me.userId,
            createdAt: now,
          })
          .onConflictDoNothing({ target: [trainingSessions.orgId, trainingSessions.clientId] })
          .returning();
        let session = inserted;
        if (!session) {
          [session] = await tx.select().from(trainingSessions).where(and(eq(trainingSessions.orgId, orgId), eq(trainingSessions.clientId, s.id)));
          if (session!.athleteId !== s.athleteId) throw conflict("This session id is already used for another athlete.");
        }
        out.sessions.push({ clientId: s.id, id: session!.id, created: Boolean(inserted) });

        for (const r of s.reports) {
          const [report] = await tx
            .insert(trainingReports)
            .values({
              id: uuidv7(now.getTime()),
              orgId,
              sessionId: session!.id,
              clientId: r.id,
              podReportId: r.podReportId ?? null,
              cycle: r.cycle ?? null,
              startMs: r.startMs ?? null,
              endMs: r.endMs ?? null,
              recordedAt: new Date(r.recordedAt),
              stats: r.stats,
              vars: r.vars,
              discarded: r.discarded,
              createdAt: now,
            })
            .onConflictDoNothing({ target: [trainingReports.orgId, trainingReports.clientId] })
            .returning({ id: trainingReports.id });
          if (report) {
            for (let i = 0; i < r.values.length; i += 1000) {
              await tx.insert(trainingValues).values(r.values.slice(i, i + 1000).map((x, k) => ({ reportId: report.id, n: i + k, ...x })));
            }
            out.reports.push({ clientId: r.id, id: report.id, status: "created" });
            continue;
          }
          const [old] = await tx.select().from(trainingReports).where(and(eq(trainingReports.orgId, orgId), eq(trainingReports.clientId, r.id)));
          if (old!.sessionId !== session!.id) throw conflict("This report id is already used in another session.");
          if (old!.discarded !== r.discarded) {
            await tx.update(trainingReports).set({ discarded: r.discarded }).where(eq(trainingReports.id, old!.id));
          }
          out.reports.push({ clientId: r.id, id: old!.id, status: old!.discarded !== r.discarded ? "updated" : "unchanged" });
        }
      }

      const created = out.reports.filter((r) => r.status === "created").length;
      const updated = out.reports.filter((r) => r.status === "updated").length;
      const newSessions = out.sessions.filter((s) => s.created).map((s) => s.id);
      if (newSessions.length || created || updated) {
        await recordAudit(tx, ctx, {
          orgId,
          action: "training.uploaded",
          resourceType: "training_session",
          resourceId: out.sessions.length === 1 ? out.sessions[0]!.id : null,
          details: { newSessions, reportsCreated: created, reportsUpdated: updated },
        });
      }
      return out;
    });
  },
});

export const deleteTrainingSession = defineUseCase({
  name: "delete_training_session",
  title: "Delete a training session",
  description: "Deletes a training session with all its reports. Coaches for their teams.",
  http: { method: "delete", path: "/v1/orgs/{orgId}/training/sessions/{sessionId}" },
  tag: "training",
  scope: "results:write",
  agent: "deny",
  input: SessionPath,
  output: Ok,
  run: async (ctx, { orgId, sessionId }) =>
    ctx.ports.db.transaction(async (tx) => {
      const v = await resultViewer(tx, ctx, orgId);
      await loadSession(tx, v, orgId, sessionId);
      requireCoach(v);
      await tx.delete(trainingSessions).where(eq(trainingSessions.id, sessionId));
      await recordAudit(tx, ctx, { orgId, action: "training.session_deleted", resourceType: "training_session", resourceId: sessionId });
      return ok;
    }),
});

const ReportPath = OrgPath.extend({ reportId: Id });

async function loadReport(tx: Tx, v: Viewer, orgId: string, reportId: string) {
  const [row] = await tx
    .select({ r: trainingReports, a: athletes })
    .from(trainingReports)
    .innerJoin(trainingSessions, eq(trainingSessions.id, trainingReports.sessionId))
    .innerJoin(athletes, eq(athletes.id, trainingSessions.athleteId))
    .where(and(eq(trainingReports.id, reportId), eq(trainingReports.orgId, orgId)));
  if (!row || !seesAthlete(v, row.a)) throw notFound("Report not found.");
  return row.r;
}

export const updateTrainingReport = defineUseCase({
  name: "update_training_report",
  title: "Count or discard a report",
  description: "Marks a report as discarded (not counted in statistics) or counts it again. Coaches for their teams.",
  http: { method: "patch", path: "/v1/orgs/{orgId}/training/reports/{reportId}" },
  tag: "training",
  scope: "results:write",
  agent: "deny",
  input: ReportPath.extend({ discarded: z.boolean() }),
  output: Ok,
  run: async (ctx, { orgId, reportId, discarded }) =>
    ctx.ports.db.transaction(async (tx) => {
      const v = await resultViewer(tx, ctx, orgId);
      await loadReport(tx, v, orgId, reportId);
      requireCoach(v);
      await tx.update(trainingReports).set({ discarded }).where(eq(trainingReports.id, reportId));
      await recordAudit(tx, ctx, { orgId, action: "training.report_updated", resourceType: "training_report", resourceId: reportId, details: { discarded } });
      return ok;
    }),
});

export const deleteTrainingReport = defineUseCase({
  name: "delete_training_report",
  title: "Delete a report",
  description: "Deletes one report with its values. Coaches for their teams.",
  http: { method: "delete", path: "/v1/orgs/{orgId}/training/reports/{reportId}" },
  tag: "training",
  scope: "results:write",
  agent: "deny",
  input: ReportPath,
  output: Ok,
  run: async (ctx, { orgId, reportId }) =>
    ctx.ports.db.transaction(async (tx) => {
      const v = await resultViewer(tx, ctx, orgId);
      await loadReport(tx, v, orgId, reportId);
      requireCoach(v);
      await tx.delete(trainingReports).where(eq(trainingReports.id, reportId));
      await recordAudit(tx, ctx, { orgId, action: "training.report_deleted", resourceType: "training_report", resourceId: reportId });
      return ok;
    }),
});

// ---------- statistics ----------

const SourceFilter = z.object({
  programPath: ProgramPath.optional(),
  revisionId: Id.optional(),
  presetId: Id.optional(),
  from: Timestamp.optional().describe("reports recorded at or after"),
  to: Timestamp.optional().describe("reports recorded before"),
});

/** Counted values only (discarded reports excluded), with the optional program / time filters. */
function countedValues(orgId: string, f: z.output<typeof SourceFilter>): SQL {
  return and(
    eq(trainingSessions.orgId, orgId),
    eq(trainingReports.discarded, false),
    f.programPath ? eq(trainingSessions.programPath, f.programPath) : undefined,
    f.revisionId ? eq(trainingSessions.revisionId, f.revisionId) : undefined,
    f.presetId ? eq(trainingSessions.presetId, f.presetId) : undefined,
    f.from ? gte(trainingReports.recordedAt, new Date(f.from)) : undefined,
    f.to ? lt(trainingReports.recordedAt, new Date(f.to)) : undefined,
  )!;
}

const count = sql<number>`count(*)::int`;
const best = sql<number>`min(${trainingValues.ms})::int`;
const average = sql<number>`round(avg(${trainingValues.ms}))::int`;
const worst = sql<number>`max(${trainingValues.ms})::int`;
const week = sql<string>`to_char(date_trunc('week', ${trainingReports.recordedAt} at time zone 'UTC'), 'YYYY-MM-DD')`;

const MetricSummary = z.object({
  metric: z.string(),
  count: z.number().int(),
  best: z.number().int().describe("lowest value (ms)"),
  average: z.number().int(),
  worst: z.number().int(),
  weeks: z.array(
    z.object({ week: z.string().describe("Monday of the ISO week (UTC)"), count: z.number().int(), best: z.number().int(), average: z.number().int() }),
  ),
});

export const getAthleteStats = defineUseCase({
  name: "get_athlete_stats",
  title: "Statistics of an athlete",
  description:
    "Count, best, average and worst per metric, and a weekly trend, from the athlete's counted reports " +
    "(discarded ones excluded). Optionally for one program (pod path, revision or preset) and a time range. Values are ms; lower is better.",
  http: { method: "get", path: "/v1/orgs/{orgId}/athletes/{athleteId}/stats" },
  tag: "training",
  scope: "results:read",
  agent: "allow",
  readOnly: true,
  input: OrgPath.extend({ athleteId: Id }).merge(SourceFilter),
  output: z.object({
    athlete: AthleteRef,
    sessions: z.number().int(),
    reports: z.number().int(),
    metrics: z.array(MetricSummary),
  }),
  run: async (ctx, { orgId, athleteId, ...filter }) => {
    const db = ctx.ports.db;
    const v = await resultViewer(db, ctx, orgId);
    const a = await loadAthlete(db, v, orgId, athleteId);
    const where = and(countedValues(orgId, filter), eq(trainingSessions.athleteId, athleteId));
    const fromValues = () =>
      db
        .select({ metric: trainingValues.metric, count, best, average, worst, week })
        .from(trainingValues)
        .innerJoin(trainingReports, eq(trainingReports.id, trainingValues.reportId))
        .innerJoin(trainingSessions, eq(trainingSessions.id, trainingReports.sessionId))
        .where(where);
    const totals = await db
      .select({ metric: trainingValues.metric, count, best, average, worst })
      .from(trainingValues)
      .innerJoin(trainingReports, eq(trainingReports.id, trainingValues.reportId))
      .innerJoin(trainingSessions, eq(trainingSessions.id, trainingReports.sessionId))
      .where(where)
      .groupBy(trainingValues.metric)
      .orderBy(trainingValues.metric);
    const weeks = await fromValues().groupBy(trainingValues.metric, week).orderBy(trainingValues.metric, week);
    const [n] = await db
      .select({ sessions: sql<number>`count(distinct ${trainingSessions.id})::int`, reports: count })
      .from(trainingReports)
      .innerJoin(trainingSessions, eq(trainingSessions.id, trainingReports.sessionId))
      .where(where);
    return {
      athlete: { id: a.id, name: athleteName(v, a) },
      sessions: n?.sessions ?? 0,
      reports: n?.reports ?? 0,
      metrics: totals.map((t) => ({
        ...t,
        weeks: weeks.filter((w) => w.metric === t.metric).map((w) => ({ week: w.week, count: w.count, best: w.best, average: w.average })),
      })),
    };
  },
});

export const getTeamLeaderboard = defineUseCase({
  name: "get_team_leaderboard",
  title: "Team leaderboard",
  description:
    "Best value per athlete of a team for one metric, lowest first, from counted reports. Only when the team has " +
    "its leaderboard switched on; visible to the team's members (not viewers).",
  http: { method: "get", path: "/v1/orgs/{orgId}/teams/{teamId}/leaderboard" },
  tag: "training",
  scope: "results:read",
  agent: "allow",
  readOnly: true,
  input: OrgPath.extend({ teamId: Id, metric: Metric }).merge(SourceFilter),
  output: z.object({
    team: z.object({ id: Id, name: z.string() }),
    metric: z.string(),
    entries: z.array(z.object({ rank: z.number().int(), athlete: AthleteRef, best: z.number().int(), count: z.number().int() })),
  }),
  run: async (ctx, { orgId, teamId, metric, ...filter }) => {
    const db = ctx.ports.db;
    const v = await resultViewer(db, ctx, orgId);
    const [team] = await db.select().from(teams).where(and(eq(teams.id, teamId), eq(teams.orgId, orgId)));
    if (!team || !seesTeams(v.me, [teamId])) throw notFound("Team not found.");
    if (!team.leaderboard) throw forbidden("The leaderboard of this team is switched off.");
    const rows = await db
      .select({ id: athletes.id, name: athletes.name, best, count })
      .from(trainingValues)
      .innerJoin(trainingReports, eq(trainingReports.id, trainingValues.reportId))
      .innerJoin(trainingSessions, eq(trainingSessions.id, trainingReports.sessionId))
      .innerJoin(athletes, eq(athletes.id, trainingSessions.athleteId))
      .where(and(countedValues(orgId, filter), eq(trainingValues.metric, metric), sql`${teamId}::uuid = any(${athletes.teamIds})`))
      .groupBy(athletes.id, athletes.name)
      .orderBy(best, athletes.id)
      .limit(100);
    let rank = 0;
    let last: number | null = null;
    const entries = rows.map((r, i) => {
      if (r.best !== last) rank = i + 1;
      last = r.best;
      return { rank, athlete: { id: r.id, name: athleteName(v, r) }, best: r.best, count: r.count };
    });
    return { team: { id: team.id, name: team.name }, metric, entries };
  },
});

export const trainingUseCases = [
  uploadTraining,
  listTrainingSessions,
  getTrainingSession,
  deleteTrainingSession,
  updateTrainingReport,
  deleteTrainingReport,
  getAthleteStats,
  getTeamLeaderboard,
];
