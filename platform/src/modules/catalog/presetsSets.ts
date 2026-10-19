import { and, arrayOverlaps, asc, desc, eq, inArray, ne, or, type SQL } from "drizzle-orm";
import { formatIndex, formatProgram, pathForName, resolveProgram } from "@reactpod/program-model";
import { z } from "zod";
import type { Tx } from "../../adapters/db";
import { userId } from "../../core/auth";
import type { Ctx } from "../../core/context";
import { conflict, forbidden, invalidInput, notFound } from "../../core/errors";
import { uuidv7 } from "../../core/ids";
import { Id, iso, Ok, ok, Timestamp } from "../../core/schemas";
import { defineUseCase } from "../../core/useCase";
import { recordAudit } from "../audit/record";
import { edits, loadReader, requireAuthor, sees, type Reader } from "./access";
import { loadProgram, loadRevision, VisibilitySchema } from "./programs";
import { presets, programRevisions, programs, reports, setItems, sets } from "./schema";

type PresetRow = typeof presets.$inferSelect;
type RevisionRow = typeof programRevisions.$inferSelect;

/** Drafts (made by AI clients) are visible to their creator only until a person marks them ready. */
const seesDraftAware = (reader: Reader, item: PresetRow | typeof sets.$inferSelect) =>
  item.status === "ready" ? sees(reader, item) : item.createdBy !== null && item.createdBy === reader.userId;

/** Status of new content: drafts when an AI client makes it (spec §7.3). */
const newStatus = (ctx: Ctx) => (ctx.via === "mcp" ? "draft" : "ready");

/** Visibility filter for presets and sets in SQL (same rules as `sees`). */
function visibleWhere(reader: Reader, table: typeof presets | typeof sets): SQL {
  const parts: SQL[] = [and(eq(table.visibility, "public"), eq(table.status, "ready"))!];
  if (reader.userId) {
    parts.push(eq(table.createdBy, reader.userId));
    for (const [orgId, m] of reader.orgs) {
      parts.push(
        and(
          eq(table.orgId, orgId),
          ne(table.visibility, "private"),
          eq(table.status, "ready"),
          m.teamIds.length > 0 ? or(ne(table.visibility, "team"), arrayOverlaps(table.teamIds, m.teamIds)) : undefined,
        )!,
      );
    }
  }
  return or(...parts)!;
}

// ---------- presets ----------

const Variables = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.number().int());
const Target = z.object({
  pods: z.number().int().min(1).max(8).optional(),
  ageGroup: z.string().max(30).optional(),
  level: z.enum(["easy", "medium", "hard"]).optional(),
});

const PresetSchema = z.object({
  id: Id,
  orgId: Id,
  programId: Id,
  revision: z.number().int(),
  name: z.string(),
  variables: z.record(z.string(), z.number().int()),
  target: Target,
  notes: z.string(),
  visibility: VisibilitySchema,
  teamIds: z.array(Id),
  status: z.enum(["draft", "ready"]).describe("draft = made by an AI client, a person marks it ready"),
  canEdit: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

async function presetRevision(tx: Tx, preset: PresetRow): Promise<RevisionRow> {
  const [r] = await tx.select().from(programRevisions).where(eq(programRevisions.id, preset.revisionId));
  return r!;
}

async function toPreset(tx: Tx, p: PresetRow, reader: Reader) {
  const r = await presetRevision(tx, p);
  return {
    id: p.id,
    orgId: p.orgId,
    programId: r.programId,
    revision: r.n,
    name: p.name,
    variables: p.variables,
    target: p.target,
    notes: p.notes,
    visibility: p.visibility,
    teamIds: p.teamIds,
    status: p.status,
    canEdit: edits(reader, p),
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
  };
}

/** Variables a preset may override: those the program (with its library includes) declares. */
function programVariables(ctx: Ctx, r: RevisionRow): Record<string, number> {
  const source = (path: string) => (path === r.path ? r.text : ctx.ports.library[path]);
  return resolveProgram(r.path, source).variables;
}

function checkVariables(ctx: Ctx, r: RevisionRow, variables: Record<string, number>) {
  const known = programVariables(ctx, r);
  const unknown = Object.keys(variables).filter((v) => !(v in known));
  if (unknown.length > 0) throw invalidInput(`The program has no variable ${unknown.join(", ")}.`, { unknown, known: Object.keys(known) });
}

/** The program file with the preset's variables (and its name), as pushed to a pod. */
function renderPreset(r: RevisionRow, p: PresetRow, name = true): string {
  const json = r.json;
  const variables = { ...((json.variables as Record<string, number>) ?? {}), ...p.variables };
  return formatProgram({ ...json, ...(name ? { name: p.name } : {}), variables });
}

async function loadPreset(tx: Tx, reader: Reader, presetId: string): Promise<PresetRow> {
  const [p] = await tx.select().from(presets).where(eq(presets.id, presetId));
  if (!p || !seesDraftAware(reader, p)) throw notFound("Preset not found.");
  return p;
}

const PresetPath = z.object({ presetId: Id });

export const listPresets = defineUseCase({
  name: "list_presets",
  title: "Presets",
  description: "Presets (named variable sets) the caller can see, optionally of one program or club.",
  http: { method: "get", path: "/v1/presets" },
  tag: "presets",
  agent: "allow",
  readOnly: true,
  input: z.object({
    programId: Id.optional(),
    orgId: Id.optional(),
    offset: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  output: z.object({ presets: z.array(PresetSchema), more: z.boolean() }),
  run: async (ctx, { programId, orgId, offset, limit }) => {
    const db = ctx.ports.db;
    const reader = await loadReader(db, ctx);
    let revisionIds: string[] | undefined;
    if (programId) {
      await loadProgram(db, reader, programId);
      revisionIds = (await db.select({ id: programRevisions.id }).from(programRevisions).where(eq(programRevisions.programId, programId))).map((r) => r.id);
      if (revisionIds.length === 0) return { presets: [], more: false };
    }
    const rows = await db
      .select()
      .from(presets)
      .where(and(visibleWhere(reader, presets), orgId ? eq(presets.orgId, orgId) : undefined, revisionIds ? inArray(presets.revisionId, revisionIds) : undefined))
      .orderBy(asc(presets.name), desc(presets.id))
      .offset(offset)
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return { presets: await Promise.all(page.map((p) => toPreset(db, p, reader))), more: rows.length > limit };
  },
});

export const getPreset = defineUseCase({
  name: "get_preset",
  title: "One preset",
  description: "A preset with its variables and program.",
  http: { method: "get", path: "/v1/presets/{presetId}" },
  tag: "presets",
  agent: "allow",
  readOnly: true,
  input: PresetPath,
  output: PresetSchema,
  run: async (ctx, { presetId }) => {
    const db = ctx.ports.db;
    const reader = await loadReader(db, ctx);
    return toPreset(db, await loadPreset(db, reader, presetId), reader);
  },
});

export const renderPresetProgram = defineUseCase({
  name: "render_preset",
  title: "Program file of a preset",
  description: "The program file with the preset's variables applied (named after the preset), ready to push to a pod.",
  http: { method: "get", path: "/v1/presets/{presetId}/program" },
  tag: "presets",
  agent: "allow",
  readOnly: true,
  input: PresetPath,
  output: z.object({ path: z.string(), text: z.string() }),
  run: async (ctx, { presetId }) => {
    const db = ctx.ports.db;
    const reader = await loadReader(db, ctx);
    const p = await loadPreset(db, reader, presetId);
    const r = await presetRevision(db, p);
    return { path: r.path, text: renderPreset(r, p) };
  },
});

export const createPreset = defineUseCase({
  name: "create_preset",
  title: "Create a preset",
  description:
    "Saves a named set of variable values for a program revision (e.g. easier timing for U12). Only variables the " +
    "program declares can be set. AI clients create drafts that a person marks ready.",
  http: { method: "post", path: "/v1/presets", status: 201 },
  tag: "presets",
  scope: "programs:write",
  agent: "draft",
  input: z.object({
    orgId: Id,
    programId: Id,
    revision: z.number().int().min(1).optional().describe("default: the published revision"),
    name: z.string().trim().min(1).max(60),
    variables: Variables,
    target: Target.default({}),
    notes: z.string().max(1000).default(""),
    visibility: VisibilitySchema.default("private"),
    teamIds: z.array(Id).max(50).default([]),
  }),
  output: PresetSchema,
  run: async (ctx, input) =>
    ctx.ports.db.transaction(async (tx) => {
      userId(ctx);
      const reader = await loadReader(tx, ctx);
      const program = await loadProgram(tx, reader, input.programId);
      const r = await loadRevision(tx, reader, program, input.revision);
      checkVariables(ctx, r, input.variables);
      const me = await requireAuthor(tx, ctx, input.orgId, input.visibility, input.teamIds);
      const now = ctx.ports.clock();
      const [p] = await tx
        .insert(presets)
        .values({
          id: uuidv7(now.getTime()),
          orgId: input.orgId,
          revisionId: r.id,
          name: input.name,
          variables: input.variables,
          target: input.target,
          notes: input.notes,
          visibility: input.visibility,
          teamIds: input.teamIds,
          status: newStatus(ctx),
          createdBy: me.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await recordAudit(tx, ctx, { orgId: input.orgId, action: "preset.created", resourceType: "preset", resourceId: p!.id });
      return toPreset(tx, p!, await loadReader(tx, ctx));
    }),
});

async function requirePresetEditor(tx: Tx, ctx: Ctx, presetId: string) {
  userId(ctx);
  const reader = await loadReader(tx, ctx);
  const p = await loadPreset(tx, reader, presetId);
  if (!edits(reader, p)) throw forbidden("You cannot change this preset.");
  return { reader, p };
}

export const updatePreset = defineUseCase({
  name: "update_preset",
  title: "Change a preset",
  description: "Name, variables, target, notes, visibility; `status: ready` confirms a draft made by an AI client.",
  http: { method: "patch", path: "/v1/presets/{presetId}" },
  tag: "presets",
  scope: "programs:write",
  agent: "deny",
  input: PresetPath.extend({
    name: z.string().trim().min(1).max(60).optional(),
    variables: Variables.optional(),
    target: Target.optional(),
    notes: z.string().max(1000).optional(),
    visibility: VisibilitySchema.optional(),
    teamIds: z.array(Id).max(50).optional(),
    status: z.literal("ready").optional(),
  }),
  output: PresetSchema,
  run: async (ctx, { presetId, ...patch }) =>
    ctx.ports.db.transaction(async (tx) => {
      const { reader, p } = await requirePresetEditor(tx, ctx, presetId);
      if (patch.variables) checkVariables(ctx, await presetRevision(tx, p), patch.variables);
      const visibility = patch.visibility ?? p.visibility;
      const teamIds = patch.teamIds ?? (patch.visibility && patch.visibility !== "team" ? [] : p.teamIds);
      if (patch.visibility || patch.teamIds) await requireAuthor(tx, ctx, p.orgId, visibility, teamIds);
      const [updated] = await tx
        .update(presets)
        .set({ ...patch, visibility, teamIds, updatedAt: ctx.ports.clock() })
        .where(eq(presets.id, presetId))
        .returning();
      await recordAudit(tx, ctx, { orgId: p.orgId, action: "preset.updated", resourceType: "preset", resourceId: presetId, details: { fields: Object.keys(patch) } });
      return toPreset(tx, updated!, reader);
    }),
});

export const deletePreset = defineUseCase({
  name: "delete_preset",
  title: "Delete a preset",
  description: "Deletes a preset that no set uses.",
  http: { method: "delete", path: "/v1/presets/{presetId}" },
  tag: "presets",
  scope: "programs:write",
  agent: "deny",
  input: PresetPath,
  output: Ok,
  run: async (ctx, { presetId }) =>
    ctx.ports.db.transaction(async (tx) => {
      const { p } = await requirePresetEditor(tx, ctx, presetId);
      const [used] = await tx.select({ setId: setItems.setId }).from(setItems).where(eq(setItems.presetId, presetId)).limit(1);
      if (used) throw conflict("A set uses this preset. Remove it from the set first.");
      await tx.delete(presets).where(eq(presets.id, presetId));
      await recordAudit(tx, ctx, { orgId: p.orgId, action: "preset.deleted", resourceType: "preset", resourceId: presetId });
      return ok;
    }),
});

// ---------- sets ----------

const ItemInput = z.union([
  z.object({ programId: Id, revision: z.number().int().min(1).optional() }),
  z.object({ presetId: Id }),
]);

const Item = z.object({
  position: z.number().int(),
  programId: Id,
  revision: z.number().int(),
  title: z.string().describe("program title, or the preset name"),
  presetId: Id.nullable(),
});

const SetSchema = z.object({
  id: Id,
  orgId: Id,
  name: z.string(),
  description: z.string(),
  visibility: VisibilitySchema,
  teamIds: z.array(Id),
  status: z.enum(["draft", "ready"]),
  items: z.array(Item),
  canEdit: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

type SetRow = typeof sets.$inferSelect;

async function itemsOf(tx: Tx, setId: string) {
  return tx
    .select({
      position: setItems.position,
      presetId: setItems.presetId,
      presetName: presets.name,
      revision: programRevisions,
      title: programs.title,
    })
    .from(setItems)
    .leftJoin(presets, eq(presets.id, setItems.presetId))
    .innerJoin(programRevisions, or(eq(programRevisions.id, setItems.revisionId), eq(programRevisions.id, presets.revisionId)))
    .innerJoin(programs, eq(programs.id, programRevisions.programId))
    .where(eq(setItems.setId, setId))
    .orderBy(asc(setItems.position));
}

async function toSet(tx: Tx, s: SetRow, reader: Reader) {
  const items = await itemsOf(tx, s.id);
  return {
    id: s.id,
    orgId: s.orgId,
    name: s.name,
    description: s.description,
    visibility: s.visibility,
    teamIds: s.teamIds,
    status: s.status,
    items: items.map((i) => ({
      position: i.position,
      programId: i.revision.programId,
      revision: i.revision.n,
      title: i.presetName ?? i.title,
      presetId: i.presetId,
    })),
    canEdit: edits(reader, s),
    createdAt: iso(s.createdAt),
    updatedAt: iso(s.updatedAt),
  };
}

/** Resolves menu entries to revision / preset ids the caller may use. */
async function resolveItems(tx: Tx, reader: Reader, items: z.infer<typeof ItemInput>[]) {
  const out: { revisionId: string | null; presetId: string | null }[] = [];
  for (const item of items) {
    if ("presetId" in item) {
      const p = await loadPreset(tx, reader, item.presetId);
      if (p.status !== "ready") throw invalidInput("Draft presets cannot be used in a set.");
      out.push({ revisionId: null, presetId: p.id });
    } else {
      const program = await loadProgram(tx, reader, item.programId);
      const r = await loadRevision(tx, reader, program, item.revision);
      out.push({ revisionId: r.id, presetId: null });
    }
  }
  return out;
}

async function writeItems(tx: Tx, setId: string, items: { revisionId: string | null; presetId: string | null }[]) {
  await tx.delete(setItems).where(eq(setItems.setId, setId));
  if (items.length > 0) await tx.insert(setItems).values(items.map((i, position) => ({ setId, position, ...i })));
}

async function loadSet(tx: Tx, reader: Reader, setId: string): Promise<SetRow> {
  const [s] = await tx.select().from(sets).where(eq(sets.id, setId));
  if (!s || !seesDraftAware(reader, s)) throw notFound("Set not found.");
  return s;
}

const SetPath = z.object({ setId: Id });
const Items = z.array(ItemInput).max(30).describe("menu entries in order: a program (revision) or a preset");

export const listSets = defineUseCase({
  name: "list_sets",
  title: "Sets",
  description: "Sets (a menu with its programs) the caller can see, optionally of one club.",
  http: { method: "get", path: "/v1/sets" },
  tag: "sets",
  agent: "allow",
  readOnly: true,
  input: z.object({
    orgId: Id.optional(),
    offset: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  output: z.object({ sets: z.array(SetSchema), more: z.boolean() }),
  run: async (ctx, { orgId, offset, limit }) => {
    const db = ctx.ports.db;
    const reader = await loadReader(db, ctx);
    const rows = await db
      .select()
      .from(sets)
      .where(and(visibleWhere(reader, sets), orgId ? eq(sets.orgId, orgId) : undefined))
      .orderBy(asc(sets.name), desc(sets.id))
      .offset(offset)
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return { sets: await Promise.all(page.map((s) => toSet(db, s, reader))), more: rows.length > limit };
  },
});

export const getSet = defineUseCase({
  name: "get_set",
  title: "One set",
  description: "A set with its menu entries.",
  http: { method: "get", path: "/v1/sets/{setId}" },
  tag: "sets",
  agent: "allow",
  readOnly: true,
  input: SetPath,
  output: SetSchema,
  run: async (ctx, { setId }) => {
    const db = ctx.ports.db;
    const reader = await loadReader(db, ctx);
    return toSet(db, await loadSet(db, reader, setId), reader);
  },
});

export const createSet = defineUseCase({
  name: "create_set",
  title: "Create a set",
  description: "Saves a menu of programs and presets as a set. AI clients create drafts that a person marks ready.",
  http: { method: "post", path: "/v1/sets", status: 201 },
  tag: "sets",
  scope: "programs:write",
  agent: "draft",
  input: z.object({
    orgId: Id,
    name: z.string().trim().min(1).max(60),
    description: z.string().max(1000).default(""),
    visibility: VisibilitySchema.default("private"),
    teamIds: z.array(Id).max(50).default([]),
    items: Items,
  }),
  output: SetSchema,
  run: async (ctx, input) =>
    ctx.ports.db.transaction(async (tx) => {
      userId(ctx);
      const reader = await loadReader(tx, ctx);
      const items = await resolveItems(tx, reader, input.items);
      const me = await requireAuthor(tx, ctx, input.orgId, input.visibility, input.teamIds);
      const now = ctx.ports.clock();
      const [s] = await tx
        .insert(sets)
        .values({
          id: uuidv7(now.getTime()),
          orgId: input.orgId,
          name: input.name,
          description: input.description,
          visibility: input.visibility,
          teamIds: input.teamIds,
          status: newStatus(ctx),
          createdBy: me.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await writeItems(tx, s!.id, items);
      await recordAudit(tx, ctx, { orgId: input.orgId, action: "set.created", resourceType: "set", resourceId: s!.id });
      return toSet(tx, s!, await loadReader(tx, ctx));
    }),
});

async function requireSetEditor(tx: Tx, ctx: Ctx, setId: string) {
  userId(ctx);
  const reader = await loadReader(tx, ctx);
  const s = await loadSet(tx, reader, setId);
  if (!edits(reader, s)) throw forbidden("You cannot change this set.");
  return { reader, s };
}

export const updateSet = defineUseCase({
  name: "update_set",
  title: "Change a set",
  description: "Name, description, visibility, menu entries; `status: ready` confirms a draft made by an AI client.",
  http: { method: "patch", path: "/v1/sets/{setId}" },
  tag: "sets",
  scope: "programs:write",
  agent: "deny",
  input: SetPath.extend({
    name: z.string().trim().min(1).max(60).optional(),
    description: z.string().max(1000).optional(),
    visibility: VisibilitySchema.optional(),
    teamIds: z.array(Id).max(50).optional(),
    status: z.literal("ready").optional(),
    items: Items.optional(),
  }),
  output: SetSchema,
  run: async (ctx, { setId, items, ...patch }) =>
    ctx.ports.db.transaction(async (tx) => {
      const { reader, s } = await requireSetEditor(tx, ctx, setId);
      const visibility = patch.visibility ?? s.visibility;
      const teamIds = patch.teamIds ?? (patch.visibility && patch.visibility !== "team" ? [] : s.teamIds);
      if (patch.visibility || patch.teamIds) await requireAuthor(tx, ctx, s.orgId, visibility, teamIds);
      if (items) await writeItems(tx, setId, await resolveItems(tx, reader, items));
      const [updated] = await tx.update(sets).set({ ...patch, visibility, teamIds, updatedAt: ctx.ports.clock() }).where(eq(sets.id, setId)).returning();
      await recordAudit(tx, ctx, {
        orgId: s.orgId,
        action: "set.updated",
        resourceType: "set",
        resourceId: setId,
        details: { fields: [...Object.keys(patch), ...(items ? ["items"] : [])] },
      });
      return toSet(tx, updated!, reader);
    }),
});

export const deleteSet = defineUseCase({
  name: "delete_set",
  title: "Delete a set",
  description: "Deletes a set (not its programs or presets).",
  http: { method: "delete", path: "/v1/sets/{setId}" },
  tag: "sets",
  scope: "programs:write",
  agent: "deny",
  input: SetPath,
  output: Ok,
  run: async (ctx, { setId }) =>
    ctx.ports.db.transaction(async (tx) => {
      const { s } = await requireSetEditor(tx, ctx, setId);
      await tx.delete(sets).where(eq(sets.id, setId));
      await recordAudit(tx, ctx, { orgId: s.orgId, action: "set.deleted", resourceType: "set", resourceId: setId });
      return ok;
    }),
});

export const exportSet = defineUseCase({
  name: "export_set",
  title: "Files of a set",
  description:
    "The pod files of a set: /programs.json (the menu) and every program, presets applied, plus the library parts " +
    "they include – the layout of firmware/data and of the app's set .zip. Entries the caller can no longer read are skipped.",
  http: { method: "get", path: "/v1/sets/{setId}/files" },
  tag: "sets",
  agent: "allow",
  readOnly: true,
  input: SetPath,
  output: z.object({
    files: z.record(z.string(), z.string()).describe("store path → file text"),
    skipped: z.array(z.number().int()).describe("positions left out"),
  }),
  run: async (ctx, { setId }) => {
    const db = ctx.ports.db;
    const reader = await loadReader(db, ctx);
    await loadSet(db, reader, setId);
    const items = await itemsOf(db, setId);
    const files: Record<string, string> = {};
    const menu: string[] = [];
    const skipped: number[] = [];
    const taken = new Set<string>();
    for (const item of items) {
      const [program] = await db.select().from(programs).where(eq(programs.id, item.revision.programId));
      const preset = item.presetId ? (await db.select().from(presets).where(eq(presets.id, item.presetId)))[0] : undefined;
      const readable =
        program && sees(reader, program) && (item.revision.status === "published" || edits(reader, program)) && (!preset || seesDraftAware(reader, preset));
      if (!readable) {
        skipped.push(item.position);
        continue;
      }
      const r = item.revision;
      const path = preset ? pathForName(preset.name, taken) : taken.has(r.path) ? pathForName(String(r.json.name ?? "program"), taken) : r.path;
      taken.add(path);
      files[path] = preset ? renderPreset(r, preset) : r.text;
      menu.push(path);
      for (const file of resolveProgram(path, (p) => (p === path ? files[path] : ctx.ports.library[p])).files.keys()) {
        if (file !== path && ctx.ports.library[file]) files[file] = ctx.ports.library[file]!;
      }
    }
    files["/programs.json"] = formatIndex(menu);
    return { files, skipped };
  },
});

// ---------- reports ----------

export const reportContent = defineUseCase({
  name: "report_content",
  title: "Report content",
  description: "Reports a program, preset or set (abuse, broken, licence). Platform admins review reports.",
  http: { method: "post", path: "/v1/reports", status: 201 },
  tag: "reports",
  scope: "programs:read",
  agent: "deny",
  input: z.object({
    resourceType: z.enum(["program", "preset", "set"]),
    resourceId: Id,
    reason: z.enum(["abuse", "broken", "licence", "other"]),
    text: z.string().max(2000).default(""),
  }),
  output: z.object({ id: Id }),
  run: async (ctx, input) =>
    ctx.ports.db.transaction(async (tx) => {
      const uid = userId(ctx);
      const reader = await loadReader(tx, ctx);
      if (input.resourceType === "program") await loadProgram(tx, reader, input.resourceId);
      else if (input.resourceType === "preset") await loadPreset(tx, reader, input.resourceId);
      else await loadSet(tx, reader, input.resourceId);
      const now = ctx.ports.clock();
      const id = uuidv7(now.getTime());
      await tx.insert(reports).values({ id, ...input, reportedBy: uid, createdAt: now });
      await recordAudit(tx, ctx, { action: "content.reported", resourceType: input.resourceType, resourceId: input.resourceId, details: { reason: input.reason } });
      return { id };
    }),
});

export const catalogExtraUseCases = [
  listPresets,
  getPreset,
  renderPresetProgram,
  createPreset,
  updatePreset,
  deletePreset,
  listSets,
  getSet,
  createSet,
  updateSet,
  deleteSet,
  exportSet,
  reportContent,
];
