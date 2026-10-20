import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { Id, iso, Timestamp } from "../../core/schemas";
import { defineUseCase } from "../../core/useCase";
import { requireMember } from "../orgs/policies";
import { auditLog } from "./schema";

const Entry = z.object({
  id: Id,
  at: Timestamp,
  actorUserId: Id.nullable(),
  actorKind: z.string(),
  via: z.string().describe("rest, mcp or internal"),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
});

export const listAuditLog = defineUseCase({
  name: "list_audit_log",
  title: "Club activity log",
  description: "Who changed what in a club, newest first, including every AI client call. Admins and owners.",
  http: { method: "get", path: "/v1/orgs/{orgId}/audit" },
  tag: "audit",
  scope: "audit:read",
  agent: "allow",
  readOnly: true,
  input: z.object({
    orgId: Id,
    cursor: Id.optional().describe("`nextCursor` of the previous page"),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),
  output: z.object({ entries: z.array(Entry), nextCursor: Id.nullable() }),
  run: async (ctx, { orgId, cursor, limit }) => {
    const db = ctx.ports.db;
    await requireMember(db, ctx, orgId, "admin");
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.orgId, orgId), cursor ? lt(auditLog.id, cursor) : undefined))
      .orderBy(desc(auditLog.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      entries: page.map((r) => ({ ...r, at: iso(r.at) })),
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
    };
  },
});

export const auditUseCases = [listAuditLog];
