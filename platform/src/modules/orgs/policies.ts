import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "../../adapters/db";
import { userId } from "../../core/auth";
import type { Ctx } from "../../core/context";
import { forbidden, invalidInput, notFound } from "../../core/errors";
import { memberships, organizations, teams, type Role } from "./schema";

const RANK: Record<Role, number> = { owner: 5, admin: 4, coach: 3, athlete: 2, viewer: 1 };

export const atLeast = (role: Role, min: Role) => RANK[role] >= RANK[min];

export type Member = { orgId: string; userId: string; role: Role; teamIds: string[]; orgKind: "personal" | "club" };

/**
 * The caller's membership in `orgId` with at least role `min`. Non-members get 404, so the
 * existence of a club is not revealed; members below `min` get 403.
 */
export async function requireMember(tx: Tx, ctx: Ctx, orgId: string, min: Role = "viewer"): Promise<Member> {
  const uid = userId(ctx);
  const [row] = await tx
    .select({ role: memberships.role, teamIds: memberships.teamIds, orgKind: organizations.kind })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, uid)));
  if (!row) throw notFound("Club not found.");
  if (!atLeast(row.role, min)) throw forbidden(`Needs role ${min} or higher.`);
  return { orgId, userId: uid, ...row };
}

/** true if the member may act on all of `teamIds` (a whole-club membership may act on every team). */
export function coversTeams(member: Member, teamIds: readonly string[]): boolean {
  if (member.teamIds.length === 0) return true;
  return teamIds.length > 0 && teamIds.every((t) => member.teamIds.includes(t));
}

/** true if the member sees something assigned to `teamIds` (overlap; whole-club members see everything). */
export function seesTeams(member: Member, teamIds: readonly string[]): boolean {
  return member.teamIds.length === 0 || teamIds.some((t) => member.teamIds.includes(t));
}

export function requireClub(member: Member): void {
  if (member.orgKind !== "club") throw forbidden("Only possible in a club, not in a personal space.");
}

/** All of `teamIds` must be teams of the club. */
export async function requireTeamsOfOrg(tx: Tx, orgId: string, teamIds: readonly string[]): Promise<void> {
  if (teamIds.length === 0) return;
  const found = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.orgId, orgId), inArray(teams.id, [...teamIds])));
  if (found.length !== new Set(teamIds).size) throw invalidInput("Unknown team in teamIds.");
}
