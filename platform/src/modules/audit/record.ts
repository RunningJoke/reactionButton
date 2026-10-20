import type { Tx } from "../../adapters/db";
import type { Ctx } from "../../core/context";
import { uuidv7 } from "../../core/ids";
import { auditLog } from "./schema";

export type AuditEntry = {
  orgId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  /** ids and changed field names only – no personal data (names, emails) */
  details?: Record<string, unknown>;
};

/** Writes one audit entry in the caller's transaction. */
export async function recordAudit(tx: Tx, ctx: Ctx, entry: AuditEntry): Promise<void> {
  const at = ctx.ports.clock();
  await tx.insert(auditLog).values({
    id: uuidv7(at.getTime()),
    at,
    orgId: entry.orgId ?? null,
    actorUserId: ctx.actor.kind === "anonymous" ? null : ctx.actor.userId,
    actorKind: ctx.actor.kind,
    via: ctx.via,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    details: entry.details ?? {},
  });
}
