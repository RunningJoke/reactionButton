import { and, arrayOverlaps, asc, desc, eq, ilike, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { MAX_FILE_SIZE } from "@reactpod/program-model";
import { z } from "zod";
import type { Tx } from "../../adapters/db";
import { userId } from "../../core/auth";
import type { Ctx } from "../../core/context";
import { AppError, conflict, forbidden, notFound } from "../../core/errors";
import { uuidv7 } from "../../core/ids";
import { Id, iso, Ok, ok, Timestamp } from "../../core/schemas";
import { defineUseCase } from "../../core/useCase";
import { recordAudit } from "../audit/record";
import { atLeast } from "../orgs/policies";
import { edits, loadReader, requireAuthor, sees, type Reader } from "./access";
import { checkProgram, likePattern, sha256 } from "./content";
import { LICENCES, programRevisions, programs, ratings, VISIBILITIES } from "./schema";

export const VisibilitySchema = z.enum(VISIBILITIES);
const LicenceSchema = z.enum(LICENCES);
const Tags = z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10);
const ProgramText = z.string().max(MAX_FILE_SIZE * 2).describe("the program file as stored on the pod (JSON text)");
const ProgramPath = z.string().max(31).describe("pod path, e.g. /prog/sprint.json");

const IssueSchema = z.object({
  severity: z.enum(["error", "warning"]),
  code: z.string(),
  file: z.string(),
  block: z.string().optional(),
  field: z.string().optional(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

export const ProgramSchema = z.object({
  id: Id,
  orgId: Id,
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  pods: z.number().int().describe("pods the program needs"),
  language: z.string(),
  licence: LicenceSchema,
  visibility: VisibilitySchema,
  teamIds: z.array(Id),
  forkOf: z
    .object({ programId: Id, revision: z.number().int(), title: z.string() })
    .nullable()
    .describe("the program this one was copied from (attribution)"),
  latestRevision: z.number().int(),
  publishedRevision: z.number().int().nullable(),
  rating: z.object({ average: z.number().nullable(), count: z.number().int() }),
  canEdit: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const RevisionSummary = z.object({
  id: Id,
  n: z.number().int(),
  path: z.string(),
  status: z.enum(["draft", "published"]),
  errors: z.number().int(),
  warnings: z.number().int(),
  sha256: z.string(),
  note: z.string(),
  via: z.string().describe("rest or mcp (made by an AI client)"),
  createdAt: Timestamp,
});
export const Revision = RevisionSummary.extend({
  programFormat: z.number().int(),
  text: z.string(),
  json: z.record(z.string(), z.unknown()),
});

type ProgramRow = typeof programs.$inferSelect;
type RevisionRow = typeof programRevisions.$inferSelect;

async function forkInfo(tx: Tx, revisionId: string | null) {
  if (!revisionId) return null;
  const [row] = await tx
    .select({ programId: programRevisions.programId, n: programRevisions.n, title: programs.title })
    .from(programRevisions)
    .innerJoin(programs, eq(programs.id, programRevisions.programId))
    .where(eq(programRevisions.id, revisionId));
  return row ? { programId: row.programId, revision: row.n, title: row.title } : null;
}

export async function toProgram(tx: Tx, p: ProgramRow, reader: Reader) {
  return {
    id: p.id,
    orgId: p.orgId,
    title: p.title,
    description: p.description,
    tags: p.tags,
    pods: p.pods,
    language: p.language,
    licence: p.licence,
    visibility: p.visibility,
    teamIds: p.teamIds,
    forkOf: await forkInfo(tx, p.forkOf),
    latestRevision: p.latestRevision,
    publishedRevision: p.publishedRevision,
    rating: { average: p.ratingCount ? Math.round((p.ratingSum / p.ratingCount) * 10) / 10 : null, count: p.ratingCount },
    canEdit: edits(reader, p),
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
  };
}

const toSummary = (r: RevisionRow) => ({
  id: r.id,
  n: r.n,
  path: r.path,
  status: r.status,
  errors: r.errors,
  warnings: r.warnings,
  sha256: r.sha256,
  note: r.note,
  via: r.via,
  createdAt: iso(r.createdAt),
});
export const toRevision = (r: RevisionRow) => ({ ...toSummary(r), programFormat: r.programFormat, text: r.text, json: r.json });

/** The program if the reader may see it: published, or editable (drafts). Others get 404. */
export async function loadProgram(tx: Tx, reader: Reader, programId: string): Promise<ProgramRow> {
  const [p] = await tx.select().from(programs).where(and(eq(programs.id, programId), isNull(programs.deletedAt)));
  if (!p || !sees(reader, p) || (p.publishedRevision === null && !edits(reader, p))) throw notFound("Program not found.");
  return p;
}

/** A revision the reader may use: published ones for readers, any for editors. `n` omitted = published, or latest for editors. */
export async function loadRevision(tx: Tx, reader: Reader, p: ProgramRow, n?: number): Promise<RevisionRow> {
  const editor = edits(reader, p);
  const wanted = n ?? p.publishedRevision ?? (editor ? p.latestRevision : null);
  if (wanted === null) throw notFound("Revision not found.");
  const [r] = await tx.select().from(programRevisions).where(and(eq(programRevisions.programId, p.id), eq(programRevisions.n, wanted)));
  if (!r || (r.status !== "published" && !editor)) throw notFound("Revision not found.");
  return r;
}

async function requireEditor(tx: Tx, ctx: Ctx, programId: string) {
  userId(ctx);
  const reader = await loadReader(tx, ctx);
  const p = await loadProgram(tx, reader, programId);
  if (!edits(reader, p)) throw forbidden("You cannot change this program.");
  return { reader, p };
}

async function insertRevision(tx: Tx, ctx: Ctx, programId: string, n: number, checked: ReturnType<typeof checkProgram>, note: string) {
  const now = ctx.ports.clock();
  const [r] = await tx
    .insert(programRevisions)
    .values({
      id: uuidv7(now.getTime()),
      programId,
      n,
      path: checked.path,
      text: checked.text,
      json: checked.json,
      sha256: sha256(checked.text),
      programFormat: checked.programFormat,
      errors: checked.errors,
      warnings: checked.warnings,
      status: "draft",
      via: ctx.via,
      note,
      createdBy: ctx.actor.kind === "anonymous" ? null : ctx.actor.userId,
      createdAt: now,
    })
    .returning();
  return r!;
}

const ProgramPathParam = z.object({ programId: Id });
const SaveOutput = z.object({ program: ProgramSchema, revision: RevisionSummary, issues: z.array(IssueSchema) });

// ---------- read ----------

export const searchPrograms = defineUseCase({
  name: "search_programs",
  title: "Search programs",
  description:
    "Finds programs: public ones, and those of the caller's clubs. Filter by text, tags, number of pods or club. " +
    "Without sign-in only public programs are found.",
  http: { method: "get", path: "/v1/programs" },
  tag: "programs",
  agent: "allow",
  readOnly: true,
  input: z.object({
    q: z.string().max(100).optional().describe("text in title or description"),
    tags: z.string().max(200).optional().describe("comma-separated; programs with any of them"),
    pods: z.coerce.number().int().min(1).max(8).optional(),
    orgId: Id.optional().describe("only programs of this club"),
    sort: z.enum(["new", "rating", "title"]).default("new"),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
  output: z.object({ programs: z.array(ProgramSchema), more: z.boolean() }),
  run: async (ctx, input) => {
    const db = ctx.ports.db;
    const reader = await loadReader(db, ctx);
    const visible: SQL[] = [and(eq(programs.visibility, "public"), isNotNull(programs.publishedRevision))!];
    if (reader.userId) {
      visible.push(and(eq(programs.visibility, "private"), eq(programs.createdBy, reader.userId))!);
      for (const [orgId, m] of reader.orgs) {
        const parts: (SQL | undefined)[] = [eq(programs.orgId, orgId), ne(programs.visibility, "private")];
        if (m.teamIds.length > 0) parts.push(or(ne(programs.visibility, "team"), arrayOverlaps(programs.teamIds, m.teamIds)));
        if (!atLeast(m.role, "coach")) parts.push(isNotNull(programs.publishedRevision));
        visible.push(and(...parts)!);
      }
    }
    const tags = input.tags?.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) ?? [];
    const where = and(
      isNull(programs.deletedAt),
      or(...visible),
      input.q ? or(ilike(programs.title, likePattern(input.q)), ilike(programs.description, likePattern(input.q))) : undefined,
      tags.length ? arrayOverlaps(programs.tags, tags) : undefined,
      input.pods ? eq(programs.pods, input.pods) : undefined,
      input.orgId ? eq(programs.orgId, input.orgId) : undefined,
    );
    const order =
      input.sort === "rating"
        ? [sql`${programs.ratingSum}::float / nullif(${programs.ratingCount}, 0) desc nulls last`, desc(programs.ratingCount), desc(programs.id)]
        : input.sort === "title"
          ? [asc(programs.title), desc(programs.id)]
          : [desc(programs.id)];
    const rows = await db.select().from(programs).where(where).orderBy(...order).offset(input.offset).limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    return { programs: await Promise.all(page.map((p) => toProgram(db, p, reader))), more: rows.length > input.limit };
  },
});

export const getProgram = defineUseCase({
  name: "get_program",
  title: "Program with its file",
  description:
    "A program's details and the file of one revision (default: the published one; editors get the latest " +
    "draft while nothing is published).",
  http: { method: "get", path: "/v1/programs/{programId}" },
  tag: "programs",
  agent: "allow",
  readOnly: true,
  input: ProgramPathParam.extend({ revision: z.coerce.number().int().min(1).optional() }),
  output: z.object({ program: ProgramSchema, revision: Revision }),
  run: async (ctx, { programId, revision }) => {
    const db = ctx.ports.db;
    const reader = await loadReader(db, ctx);
    const p = await loadProgram(db, reader, programId);
    return { program: await toProgram(db, p, reader), revision: toRevision(await loadRevision(db, reader, p, revision)) };
  },
});

export const listRevisions = defineUseCase({
  name: "list_revisions",
  title: "Revisions of a program",
  description: "All saved versions, newest first. Readers see published revisions, editors also drafts.",
  http: { method: "get", path: "/v1/programs/{programId}/revisions" },
  tag: "programs",
  agent: "allow",
  readOnly: true,
  input: ProgramPathParam,
  output: z.object({ revisions: z.array(RevisionSummary) }),
  run: async (ctx, { programId }) => {
    const db = ctx.ports.db;
    const reader = await loadReader(db, ctx);
    const p = await loadProgram(db, reader, programId);
    const rows = await db
      .select()
      .from(programRevisions)
      .where(and(eq(programRevisions.programId, programId), edits(reader, p) ? undefined : eq(programRevisions.status, "published")))
      .orderBy(desc(programRevisions.n));
    return { revisions: rows.map(toSummary) };
  },
});

// ---------- write ----------

export const createProgram = defineUseCase({
  name: "create_program",
  title: "Save a new program (draft)",
  description:
    "Saves a program file as the first draft revision of a new program in a club or the personal space. " +
    "Drafts may have validation errors; publish_revision needs an error-free revision and is done by a person. " +
    "Includes are limited to the shipped library (/prog/lib/*). Returns the validation issues.",
  http: { method: "post", path: "/v1/programs", status: 201 },
  tag: "programs",
  scope: "programs:write",
  agent: "draft",
  input: z.object({
    orgId: Id,
    path: ProgramPath,
    text: ProgramText,
    title: z.string().trim().min(1).max(80).optional().describe("default: the program's name"),
    description: z.string().max(2000).default(""),
    tags: Tags.default([]),
    language: z.enum(["en", "de"]).default("en"),
    licence: LicenceSchema.default("CC-BY-4.0"),
    visibility: VisibilitySchema.default("private"),
    teamIds: z.array(Id).max(50).default([]),
    note: z.string().max(500).default(""),
  }),
  output: SaveOutput,
  run: async (ctx, input) => {
    const checked = checkProgram(ctx.ports, input.path, input.text);
    return ctx.ports.db.transaction(async (tx) => {
      const me = await requireAuthor(tx, ctx, input.orgId, input.visibility, input.teamIds);
      const now = ctx.ports.clock();
      const name = typeof checked.json.name === "string" && checked.json.name.trim() ? checked.json.name.trim() : "Program";
      const [p] = await tx
        .insert(programs)
        .values({
          id: uuidv7(now.getTime()),
          orgId: input.orgId,
          createdBy: me.userId,
          title: input.title ?? name.slice(0, 80),
          description: input.description,
          tags: [...new Set(input.tags)],
          pods: podsOf(checked.json),
          language: input.language,
          licence: input.licence,
          visibility: input.visibility,
          teamIds: input.teamIds,
          latestRevision: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const r = await insertRevision(tx, ctx, p!.id, 1, checked, input.note);
      await recordAudit(tx, ctx, { orgId: input.orgId, action: "program.created", resourceType: "program", resourceId: p!.id });
      const reader = await loadReader(tx, ctx);
      return { program: await toProgram(tx, p!, reader), revision: toSummary(r), issues: checked.issues };
    });
  },
});

const podsOf = (json: Record<string, unknown>) => (typeof json.peripherals === "number" ? json.peripherals + 1 : 1);

export const saveRevision = defineUseCase({
  name: "save_revision",
  title: "Save a new revision (draft)",
  description: "Saves a changed program file as the next draft revision. Editors of the program only.",
  http: { method: "post", path: "/v1/programs/{programId}/revisions", status: 201 },
  tag: "programs",
  scope: "programs:write",
  agent: "draft",
  input: ProgramPathParam.extend({ path: ProgramPath, text: ProgramText, note: z.string().max(500).default("") }),
  output: SaveOutput,
  run: async (ctx, { programId, path, text, note }) => {
    const checked = checkProgram(ctx.ports, path, text);
    return ctx.ports.db.transaction(async (tx) => {
      const { reader } = await requireEditor(tx, ctx, programId);
      const [bumped] = await tx
        .update(programs)
        .set({ latestRevision: sql`${programs.latestRevision} + 1`, updatedAt: ctx.ports.clock() })
        .where(eq(programs.id, programId))
        .returning();
      const r = await insertRevision(tx, ctx, programId, bumped!.latestRevision, checked, note);
      await recordAudit(tx, ctx, { orgId: bumped!.orgId, action: "program.revision_saved", resourceType: "program", resourceId: programId, details: { n: r.n } });
      return { program: await toProgram(tx, bumped!, reader), revision: toSummary(r), issues: checked.issues };
    });
  },
});

export const publishRevision = defineUseCase({
  name: "publish_revision",
  title: "Publish a revision",
  description:
    "Makes a draft revision the published version that readers get. Only revisions without validation errors. " +
    "Done by a person, not by AI clients.",
  http: { method: "post", path: "/v1/programs/{programId}/revisions/{n}/publish" },
  tag: "programs",
  scope: "programs:write",
  agent: "deny",
  input: ProgramPathParam.extend({ n: z.coerce.number().int().min(1) }),
  output: z.object({ program: ProgramSchema }),
  run: async (ctx, { programId, n }) =>
    ctx.ports.db.transaction(async (tx) => {
      const { reader, p } = await requireEditor(tx, ctx, programId);
      const r = await loadRevision(tx, reader, p, n);
      if (r.errors > 0) throw conflict(`Revision ${n} has ${r.errors} validation error(s) and cannot be published.`);
      await tx.update(programRevisions).set({ status: "published" }).where(eq(programRevisions.id, r.id));
      const [updated] = await tx
        .update(programs)
        .set({ publishedRevision: n, pods: podsOf(r.json), updatedAt: ctx.ports.clock() })
        .where(eq(programs.id, programId))
        .returning();
      await recordAudit(tx, ctx, { orgId: p.orgId, action: "program.published", resourceType: "program", resourceId: programId, details: { n } });
      return { program: await toProgram(tx, updated!, reader) };
    }),
});

export const updateProgram = defineUseCase({
  name: "update_program",
  title: "Change program details",
  description: "Title, description, tags, language, licence and who can see it. Editors only.",
  http: { method: "patch", path: "/v1/programs/{programId}" },
  tag: "programs",
  scope: "programs:write",
  agent: "deny",
  input: ProgramPathParam.extend({
    title: z.string().trim().min(1).max(80).optional(),
    description: z.string().max(2000).optional(),
    tags: Tags.optional(),
    language: z.enum(["en", "de"]).optional(),
    licence: LicenceSchema.optional(),
    visibility: VisibilitySchema.optional(),
    teamIds: z.array(Id).max(50).optional(),
  }),
  output: ProgramSchema,
  run: async (ctx, { programId, ...patch }) =>
    ctx.ports.db.transaction(async (tx) => {
      const { reader, p } = await requireEditor(tx, ctx, programId);
      const visibility = patch.visibility ?? p.visibility;
      const teamIds = patch.teamIds ?? (patch.visibility && patch.visibility !== "team" ? [] : p.teamIds);
      if (patch.visibility || patch.teamIds) await requireAuthor(tx, ctx, p.orgId, visibility, teamIds);
      const [updated] = await tx
        .update(programs)
        .set({ ...patch, ...(patch.tags ? { tags: [...new Set(patch.tags)] } : {}), visibility, teamIds, updatedAt: ctx.ports.clock() })
        .where(eq(programs.id, programId))
        .returning();
      await recordAudit(tx, ctx, { orgId: p.orgId, action: "program.updated", resourceType: "program", resourceId: programId, details: { fields: Object.keys(patch) } });
      return toProgram(tx, updated!, reader);
    }),
});

export const deleteProgram = defineUseCase({
  name: "delete_program",
  title: "Delete a program",
  description: "Removes a program from search and its club. Presets and sets that use its revisions keep working.",
  http: { method: "delete", path: "/v1/programs/{programId}" },
  tag: "programs",
  scope: "programs:write",
  agent: "deny",
  input: ProgramPathParam,
  output: Ok,
  run: async (ctx, { programId }) =>
    ctx.ports.db.transaction(async (tx) => {
      const { p } = await requireEditor(tx, ctx, programId);
      await tx.update(programs).set({ deletedAt: ctx.ports.clock() }).where(eq(programs.id, programId));
      await recordAudit(tx, ctx, { orgId: p.orgId, action: "program.deleted", resourceType: "program", resourceId: programId });
      return ok;
    }),
});

export const forkProgram = defineUseCase({
  name: "fork_program",
  title: "Copy a program (fork)",
  description:
    "Copies a revision of a program you can read into a club or your personal space as a new private draft. " +
    "The copy links to the original (attribution, CC BY).",
  http: { method: "post", path: "/v1/programs/{programId}/fork", status: 201 },
  tag: "programs",
  scope: "programs:write",
  agent: "draft",
  input: ProgramPathParam.extend({
    orgId: Id.describe("where the copy goes"),
    revision: z.number().int().min(1).optional().describe("default: the published revision"),
  }),
  output: SaveOutput,
  run: async (ctx, { programId, orgId, revision }) =>
    ctx.ports.db.transaction(async (tx) => {
      userId(ctx);
      const reader = await loadReader(tx, ctx);
      const source = await loadProgram(tx, reader, programId);
      const r = await loadRevision(tx, reader, source, revision);
      const me = await requireAuthor(tx, ctx, orgId, "private", []);
      const now = ctx.ports.clock();
      const [p] = await tx
        .insert(programs)
        .values({
          id: uuidv7(now.getTime()),
          orgId,
          createdBy: me.userId,
          title: source.title,
          description: source.description,
          tags: source.tags,
          pods: podsOf(r.json),
          language: source.language,
          licence: source.licence,
          visibility: "private",
          forkOf: r.id,
          latestRevision: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const checked = checkProgram(ctx.ports, r.path, r.text);
      const copy = await insertRevision(tx, ctx, p!.id, 1, checked, `copy of ${source.title} r${r.n}`);
      await recordAudit(tx, ctx, { orgId, action: "program.forked", resourceType: "program", resourceId: p!.id, details: { from: r.id } });
      return { program: await toProgram(tx, p!, await loadReader(tx, ctx)), revision: toSummary(copy), issues: checked.issues };
    }),
});

export const rateProgram = defineUseCase({
  name: "rate_program",
  title: "Rate a program",
  description: "1 to 5 stars for a published program; again to change. Not for your own programs.",
  http: { method: "put", path: "/v1/programs/{programId}/rating" },
  tag: "programs",
  scope: "programs:write",
  agent: "deny",
  input: ProgramPathParam.extend({ stars: z.number().int().min(1).max(5) }),
  output: z.object({ average: z.number().nullable(), count: z.number().int() }),
  run: async (ctx, { programId, stars }) =>
    ctx.ports.db.transaction(async (tx) => {
      const uid = userId(ctx);
      const reader = await loadReader(tx, ctx);
      const p = await loadProgram(tx, reader, programId);
      if (p.publishedRevision === null) throw new AppError(409, "conflict", "Only published programs can be rated.");
      if (p.createdBy === uid) throw forbidden("You cannot rate your own program.");
      const [old] = await tx.select().from(ratings).where(and(eq(ratings.programId, programId), eq(ratings.userId, uid)));
      if (old) await tx.update(ratings).set({ stars }).where(and(eq(ratings.programId, programId), eq(ratings.userId, uid)));
      else await tx.insert(ratings).values({ programId, userId: uid, stars, createdAt: ctx.ports.clock() });
      const [updated] = await tx
        .update(programs)
        .set({
          ratingSum: sql`${programs.ratingSum} + ${stars - (old?.stars ?? 0)}`,
          ratingCount: sql`${programs.ratingCount} + ${old ? 0 : 1}`,
        })
        .where(eq(programs.id, programId))
        .returning();
      return (await toProgram(tx, updated!, reader)).rating;
    }),
});

export const programUseCases = [
  searchPrograms,
  getProgram,
  listRevisions,
  createProgram,
  saveRevision,
  publishRevision,
  updateProgram,
  deleteProgram,
  forkProgram,
  rateProgram,
];
