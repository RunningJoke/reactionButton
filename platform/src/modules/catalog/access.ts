import { eq } from "drizzle-orm";
import type { Tx } from "../../adapters/db";
import type { Ctx } from "../../core/context";
import { forbidden, invalidInput } from "../../core/errors";
import { atLeast, coversTeams, requireMember, requireTeamsOfOrg, seesTeams, type Member } from "../orgs/policies";
import { memberships, type Role } from "../orgs/schema";
import type { Visibility } from "./schema";

/** Who reads the catalog: anonymous callers (or tokens without programs:read) see public content only. */
export type Reader = { userId: string | null; orgs: Map<string, { role: Role; teamIds: string[] }> };

export type Shared = { orgId: string; visibility: Visibility; teamIds: string[]; createdBy: string | null };

export async function loadReader(tx: Tx, ctx: Ctx): Promise<Reader> {
  if (ctx.actor.kind === "anonymous" || !ctx.scopes.includes("programs:read")) return { userId: null, orgs: new Map() };
  const uid = ctx.actor.userId;
  const rows = await tx.select().from(memberships).where(eq(memberships.userId, uid));
  return { userId: uid, orgs: new Map(rows.map((m) => [m.orgId, { role: m.role, teamIds: m.teamIds }])) };
}

const asMember = (orgId: string, uid: string, m: { role: Role; teamIds: string[] }): Member => ({
  orgId,
  userId: uid,
  role: m.role,
  teamIds: m.teamIds,
  orgKind: "club",
});

/** May the reader see the item at all (drafts and unpublished content need `edits` as well)? */
export function sees(reader: Reader, item: Shared): boolean {
  if (item.visibility === "public") return true;
  if (!reader.userId) return false;
  if (item.visibility === "private") return item.createdBy === reader.userId;
  const m = reader.orgs.get(item.orgId);
  if (!m) return false;
  return item.visibility === "org" || seesTeams(asMember(item.orgId, reader.userId, m), item.teamIds);
}

/**
 * May the reader change the item? Coaches and above of the owning club; team-limited coaches only
 * team items of their teams and what they created; private items only their creator.
 */
export function edits(reader: Reader, item: Shared): boolean {
  if (!reader.userId) return false;
  if (item.createdBy === reader.userId && reader.orgs.has(item.orgId)) return true;
  if (item.visibility === "private") return false;
  const m = reader.orgs.get(item.orgId);
  if (!m || !atLeast(m.role, "coach")) return false;
  return m.teamIds.length === 0 || (item.visibility === "team" && coversTeams(asMember(item.orgId, reader.userId, m), item.teamIds));
}

/**
 * Checks where new content goes: the caller is coach or above in `orgId` (owner of a personal space
 * counts), team visibility names teams the caller covers, and AI clients cannot publish to everyone.
 */
export async function requireAuthor(
  tx: Tx,
  ctx: Ctx,
  orgId: string,
  visibility: Visibility,
  teamIds: readonly string[],
): Promise<Member> {
  const me = await requireMember(tx, ctx, orgId, "coach");
  if (visibility === "public" && ctx.via === "mcp") throw forbidden("AI clients cannot make content public; a person does that in the app.");
  if (visibility === "team") {
    if (teamIds.length === 0) throw invalidInput("Team visibility needs teamIds.");
    if (!coversTeams(me, teamIds)) throw forbidden("Share with your own teams only.");
    await requireTeamsOfOrg(tx, orgId, teamIds);
  } else if (teamIds.length > 0) {
    throw invalidInput("teamIds are only used with visibility team.");
  }
  return me;
}
