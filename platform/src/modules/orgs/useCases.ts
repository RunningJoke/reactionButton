import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../../adapters/db";
import { hashToken, newToken, userId } from "../../core/auth";
import type { Ctx } from "../../core/context";
import { conflict, forbidden, invalidInput, notFound } from "../../core/errors";
import { uuidv7 } from "../../core/ids";
import { Id, iso, isoOrNull, Ok, ok, Timestamp } from "../../core/schemas";
import { defineUseCase } from "../../core/useCase";
import { recordAudit } from "../audit/record";
import { users } from "../identity/schema";
import { appLink, inviteMail } from "../identity/mails";
import { trainingSessions } from "../training/schema";
import { atLeast, coversTeams, requireClub, requireMember, requireTeamsOfOrg, seesTeams, type Member } from "./policies";
import { athletes, invites, memberships, organizations, ROLES, teams, type Role } from "./schema";

const RoleSchema = z.enum(ROLES);
const Name = z.string().trim().min(1).max(80);
const TeamIds = z.array(Id).max(50);

// ---------- organisations ----------

const Org = z.object({
  id: Id,
  kind: z.enum(["personal", "club"]),
  name: z.string(),
  country: z.string().nullable(),
  agentRealNames: z.boolean().describe("AI clients see athletes' real names"),
  role: RoleSchema.describe("the caller's role"),
  teamIds: z.array(Id).describe("the caller's teams; empty = whole club"),
  createdAt: Timestamp,
});
type OrgRow = typeof organizations.$inferSelect;
const toOrg = (o: OrgRow, m: { role: Role; teamIds: string[] }) => ({ ...o, createdAt: iso(o.createdAt), role: m.role, teamIds: m.teamIds });

const OrgPath = z.object({ orgId: Id });

export const listMyOrgs = defineUseCase({
  name: "list_my_orgs",
  title: "My clubs",
  description: "Clubs and the personal space of the signed-in user, with the user's role in each.",
  http: { method: "get", path: "/v1/orgs" },
  tag: "orgs",
  scope: "org:read",
  agent: "allow",
  readOnly: true,
  input: z.object({}),
  output: z.object({ orgs: z.array(Org) }),
  run: async (ctx) => {
    const rows = await ctx.ports.db
      .select({ org: organizations, role: memberships.role, teamIds: memberships.teamIds })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(eq(memberships.userId, userId(ctx)))
      .orderBy(organizations.kind, organizations.name);
    return { orgs: rows.map((r) => toOrg(r.org, r)) };
  },
});

export const createOrg = defineUseCase({
  name: "create_org",
  title: "Create a club",
  description: "Creates a club; the caller becomes its owner.",
  http: { method: "post", path: "/v1/orgs", status: 201 },
  tag: "orgs",
  scope: "org:write",
  agent: "deny",
  input: z.object({ name: Name, country: z.string().regex(/^[A-Z]{2}$/).optional().describe("ISO 3166-1 alpha-2") }),
  output: Org,
  run: async (ctx, { name, country }) => {
    const uid = userId(ctx);
    const now = ctx.ports.clock();
    return ctx.ports.db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ id: uuidv7(now.getTime()), kind: "club", name, country: country ?? null, createdAt: now })
        .returning();
      await tx.insert(memberships).values({ orgId: org!.id, userId: uid, role: "owner", createdAt: now });
      await recordAudit(tx, ctx, { orgId: org!.id, action: "org.created", resourceType: "org", resourceId: org!.id });
      return toOrg(org!, { role: "owner", teamIds: [] });
    });
  },
});

async function loadOrg(tx: Tx, orgId: string): Promise<OrgRow> {
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) throw notFound("Club not found.");
  return org;
}

export const getOrg = defineUseCase({
  name: "get_org",
  title: "Club details",
  description: "One club (or the personal space) of the signed-in user.",
  http: { method: "get", path: "/v1/orgs/{orgId}" },
  tag: "orgs",
  scope: "org:read",
  agent: "allow",
  readOnly: true,
  input: OrgPath,
  output: Org,
  run: async (ctx, { orgId }) => {
    const db = ctx.ports.db;
    const m = await requireMember(db, ctx, orgId);
    return toOrg(await loadOrg(db, orgId), m);
  },
});

export const updateOrg = defineUseCase({
  name: "update_org",
  title: "Change a club",
  description: "Name, country and whether AI clients may see athletes' real names. Admins and owners.",
  http: { method: "patch", path: "/v1/orgs/{orgId}" },
  tag: "orgs",
  scope: "org:write",
  agent: "deny",
  input: OrgPath.extend({
    name: Name.optional(),
    country: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
    agentRealNames: z.boolean().optional(),
  }),
  output: Org,
  run: async (ctx, { orgId, ...patch }) =>
    ctx.ports.db.transaction(async (tx) => {
      const m = await requireMember(tx, ctx, orgId, "admin");
      const [org] = await tx.update(organizations).set(patch).where(eq(organizations.id, orgId)).returning();
      await recordAudit(tx, ctx, { orgId, action: "org.updated", resourceType: "org", resourceId: orgId, details: { fields: Object.keys(patch) } });
      return toOrg(org!, m);
    }),
});

export const deleteOrg = defineUseCase({
  name: "delete_org",
  title: "Delete a club",
  description: "Deletes a club with its teams, athletes and invitations. Owners only. The personal space cannot be deleted.",
  http: { method: "delete", path: "/v1/orgs/{orgId}" },
  tag: "orgs",
  scope: "org:write",
  agent: "deny",
  input: OrgPath,
  output: Ok,
  run: async (ctx, { orgId }) =>
    ctx.ports.db.transaction(async (tx) => {
      requireClub(await requireMember(tx, ctx, orgId, "owner"));
      await tx.delete(organizations).where(eq(organizations.id, orgId));
      await recordAudit(tx, ctx, { orgId, action: "org.deleted", resourceType: "org", resourceId: orgId });
      return ok;
    }),
});

// ---------- members ----------

const MemberSchema = z.object({
  userId: Id,
  displayName: z.string(),
  email: z.email().nullable().describe("only for admins and owners, never for AI clients"),
  role: RoleSchema,
  teamIds: z.array(Id),
  createdAt: Timestamp,
});

async function ownerCount(tx: Tx, orgId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "owner")));
  return row?.n ?? 0;
}

async function loadMember(tx: Tx, orgId: string, uid: string) {
  const [row] = await tx.select().from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, uid)));
  if (!row) throw notFound("Member not found.");
  return row;
}

export const listMembers = defineUseCase({
  name: "list_members",
  title: "Club members",
  description: "Members of a club with roles and teams. E-mail addresses are shown to admins and owners only.",
  http: { method: "get", path: "/v1/orgs/{orgId}/members" },
  tag: "orgs",
  scope: "org:read",
  agent: "allow",
  readOnly: true,
  input: OrgPath,
  output: z.object({ members: z.array(MemberSchema) }),
  run: async (ctx, { orgId }) => {
    const db = ctx.ports.db;
    const me = await requireMember(db, ctx, orgId);
    const showEmail = atLeast(me.role, "admin") && ctx.via !== "mcp";
    const rows = await db
      .select({ m: memberships, displayName: users.displayName, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, orgId))
      .orderBy(memberships.createdAt);
    return {
      members: rows.map((r) => ({
        userId: r.m.userId,
        displayName: r.displayName,
        email: showEmail ? r.email : null,
        role: r.m.role,
        teamIds: r.m.teamIds,
        createdAt: iso(r.m.createdAt),
      })),
    };
  },
});

export const updateMember = defineUseCase({
  name: "update_member",
  title: "Change a member",
  description:
    "Role and team limits of a member. Admins and owners; only owners grant or take the owner role. " +
    "Empty teamIds = whole club.",
  http: { method: "patch", path: "/v1/orgs/{orgId}/members/{userId}" },
  tag: "orgs",
  scope: "org:write",
  agent: "deny",
  input: OrgPath.extend({ userId: Id, role: RoleSchema.optional(), teamIds: TeamIds.optional() }),
  output: Ok,
  run: async (ctx, { orgId, userId: target, role, teamIds }) =>
    ctx.ports.db.transaction(async (tx) => {
      const me = await requireMember(tx, ctx, orgId, "admin");
      requireClub(me);
      const current = await loadMember(tx, orgId, target);
      if ((current.role === "owner" || role === "owner") && me.role !== "owner") throw forbidden("Only owners change owners.");
      if (current.role === "owner" && role && role !== "owner" && (await ownerCount(tx, orgId)) === 1) {
        throw conflict("A club needs an owner. Transfer the ownership first.");
      }
      if (teamIds) await requireTeamsOfOrg(tx, orgId, teamIds);
      const patch = { ...(role ? { role } : {}), ...(teamIds ? { teamIds } : {}) };
      if (Object.keys(patch).length > 0) {
        await tx.update(memberships).set(patch).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, target)));
      }
      await recordAudit(tx, ctx, { orgId, action: "member.updated", resourceType: "member", resourceId: target, details: patch });
      return ok;
    }),
});

export const removeMember = defineUseCase({
  name: "remove_member",
  title: "Remove a member",
  description: "Removes someone from the club. Admins and owners; owners only by owners. To leave yourself use leave_org.",
  http: { method: "delete", path: "/v1/orgs/{orgId}/members/{userId}" },
  tag: "orgs",
  scope: "org:write",
  agent: "deny",
  input: OrgPath.extend({ userId: Id }),
  output: Ok,
  run: async (ctx, { orgId, userId: target }) =>
    ctx.ports.db.transaction(async (tx) => {
      const me = await requireMember(tx, ctx, orgId, "admin");
      requireClub(me);
      if (target === me.userId) throw invalidInput("Use leave_org to leave a club.");
      const current = await loadMember(tx, orgId, target);
      if (current.role === "owner" && me.role !== "owner") throw forbidden("Only owners remove owners.");
      await tx.delete(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, target)));
      await recordAudit(tx, ctx, { orgId, action: "member.removed", resourceType: "member", resourceId: target });
      return ok;
    }),
});

export const leaveOrg = defineUseCase({
  name: "leave_org",
  title: "Leave a club",
  description: "The caller leaves the club. The last owner cannot leave.",
  http: { method: "post", path: "/v1/orgs/{orgId}/leave" },
  tag: "orgs",
  scope: "org:write",
  agent: "deny",
  input: OrgPath,
  output: Ok,
  run: async (ctx, { orgId }) =>
    ctx.ports.db.transaction(async (tx) => {
      const me = await requireMember(tx, ctx, orgId);
      requireClub(me);
      if (me.role === "owner" && (await ownerCount(tx, orgId)) === 1) {
        throw conflict("You are the last owner. Transfer the ownership or delete the club.");
      }
      await tx.delete(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, me.userId)));
      await recordAudit(tx, ctx, { orgId, action: "member.left", resourceType: "member", resourceId: me.userId });
      return ok;
    }),
});

export const transferOwnership = defineUseCase({
  name: "transfer_ownership",
  title: "Transfer ownership",
  description: "Makes another member owner (whole club); the caller becomes admin.",
  http: { method: "post", path: "/v1/orgs/{orgId}/transfer" },
  tag: "orgs",
  scope: "org:write",
  agent: "deny",
  input: OrgPath.extend({ userId: Id }),
  output: Ok,
  run: async (ctx, { orgId, userId: target }) =>
    ctx.ports.db.transaction(async (tx) => {
      const me = await requireMember(tx, ctx, orgId, "owner");
      requireClub(me);
      if (target === me.userId) throw invalidInput("You are already an owner.");
      await loadMember(tx, orgId, target);
      await tx.update(memberships).set({ role: "owner", teamIds: [] }).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, target)));
      await tx.update(memberships).set({ role: "admin" }).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, me.userId)));
      await recordAudit(tx, ctx, { orgId, action: "org.ownership_transferred", resourceType: "member", resourceId: target });
      return ok;
    }),
});

// ---------- teams ----------

const Team = z.object({ id: Id, orgId: Id, name: z.string(), leaderboard: z.boolean(), createdAt: Timestamp });
const toTeam = (t: typeof teams.$inferSelect) => ({ ...t, createdAt: iso(t.createdAt) });
const TeamPath = OrgPath.extend({ teamId: Id });

export const listTeams = defineUseCase({
  name: "list_teams",
  title: "Teams of a club",
  description: "Teams of a club. Members limited to some teams see only those.",
  http: { method: "get", path: "/v1/orgs/{orgId}/teams" },
  tag: "orgs",
  scope: "org:read",
  agent: "allow",
  readOnly: true,
  input: OrgPath,
  output: z.object({ teams: z.array(Team) }),
  run: async (ctx, { orgId }) => {
    const db = ctx.ports.db;
    const me = await requireMember(db, ctx, orgId);
    const rows = await db.select().from(teams).where(eq(teams.orgId, orgId)).orderBy(teams.name);
    return { teams: rows.filter((t) => seesTeams(me, [t.id])).map(toTeam) };
  },
});

export const createTeam = defineUseCase({
  name: "create_team",
  title: "Create a team",
  description: "Adds a team to a club. Admins and owners.",
  http: { method: "post", path: "/v1/orgs/{orgId}/teams", status: 201 },
  tag: "orgs",
  scope: "org:write",
  agent: "deny",
  input: OrgPath.extend({ name: Name, leaderboard: z.boolean().default(false) }),
  output: Team,
  run: async (ctx, { orgId, name, leaderboard }) =>
    ctx.ports.db.transaction(async (tx) => {
      requireClub(await requireMember(tx, ctx, orgId, "admin"));
      const now = ctx.ports.clock();
      const [team] = await tx.insert(teams).values({ id: uuidv7(now.getTime()), orgId, name, leaderboard, createdAt: now }).returning();
      await recordAudit(tx, ctx, { orgId, action: "team.created", resourceType: "team", resourceId: team!.id });
      return toTeam(team!);
    }),
});

export const updateTeam = defineUseCase({
  name: "update_team",
  title: "Change a team",
  description: "Name and leaderboard switch of a team. Admins and owners.",
  http: { method: "patch", path: "/v1/orgs/{orgId}/teams/{teamId}" },
  tag: "orgs",
  scope: "org:write",
  agent: "deny",
  input: TeamPath.extend({ name: Name.optional(), leaderboard: z.boolean().optional() }),
  output: Team,
  run: async (ctx, { orgId, teamId, ...patch }) =>
    ctx.ports.db.transaction(async (tx) => {
      await requireMember(tx, ctx, orgId, "admin");
      const [team] = await tx.update(teams).set(patch).where(and(eq(teams.id, teamId), eq(teams.orgId, orgId))).returning();
      if (!team) throw notFound("Team not found.");
      await recordAudit(tx, ctx, { orgId, action: "team.updated", resourceType: "team", resourceId: teamId, details: { fields: Object.keys(patch) } });
      return toTeam(team);
    }),
});

export const deleteTeam = defineUseCase({
  name: "delete_team",
  title: "Delete a team",
  description: "Deletes a team; members and athletes stay in the club. Admins and owners.",
  http: { method: "delete", path: "/v1/orgs/{orgId}/teams/{teamId}" },
  tag: "orgs",
  scope: "org:write",
  agent: "deny",
  input: TeamPath,
  output: Ok,
  run: async (ctx, { orgId, teamId }) =>
    ctx.ports.db.transaction(async (tx) => {
      await requireMember(tx, ctx, orgId, "admin");
      const done = await tx.delete(teams).where(and(eq(teams.id, teamId), eq(teams.orgId, orgId))).returning({ id: teams.id });
      if (done.length === 0) throw notFound("Team not found.");
      const remove = sql`array_remove(team_ids, ${teamId}::uuid)`;
      await tx.update(memberships).set({ teamIds: remove }).where(eq(memberships.orgId, orgId));
      await tx.update(athletes).set({ teamIds: remove }).where(eq(athletes.orgId, orgId));
      await tx.update(invites).set({ teamIds: remove }).where(eq(invites.orgId, orgId));
      await recordAudit(tx, ctx, { orgId, action: "team.deleted", resourceType: "team", resourceId: teamId });
      return ok;
    }),
});

// ---------- invitations ----------

const Invite = z.object({
  id: Id,
  orgId: Id,
  email: z.email().nullable(),
  role: RoleSchema,
  teamIds: z.array(Id),
  athleteId: Id.nullable(),
  maxUses: z.number().int(),
  uses: z.number().int(),
  createdAt: Timestamp,
  expiresAt: Timestamp,
});
const toInvite = (i: typeof invites.$inferSelect) => ({
  id: i.id,
  orgId: i.orgId,
  email: i.email,
  role: i.role,
  teamIds: i.teamIds,
  athleteId: i.athleteId,
  maxUses: i.maxUses,
  uses: i.uses,
  createdAt: iso(i.createdAt),
  expiresAt: iso(i.expiresAt),
});

/** Admins invite any role but owner; coaches invite athletes and viewers to their teams. */
function checkInviteRights(me: Member, role: Role, teamIds: readonly string[]) {
  if (role === "owner") throw invalidInput("Owners are not invited; use transfer_ownership.");
  if (atLeast(me.role, "admin")) return;
  if (me.role !== "coach" || !["athlete", "viewer"].includes(role)) throw forbidden("Coaches invite athletes and viewers only.");
  if (!coversTeams(me, teamIds)) throw forbidden("Coaches invite to their own teams only.");
}

export const createInvite = defineUseCase({
  name: "create_invite",
  title: "Invite to a club",
  description:
    "Creates an invitation code and link. With `email` the link is mailed. With `athleteId` the person " +
    "who accepts takes over that athlete profile. The code is shown only in this response.",
  http: { method: "post", path: "/v1/orgs/{orgId}/invites", status: 201 },
  tag: "orgs",
  scope: "org:write",
  agent: "deny",
  input: OrgPath.extend({
    role: RoleSchema,
    teamIds: TeamIds.default([]),
    email: z.email().max(254).optional(),
    athleteId: Id.optional(),
    maxUses: z.number().int().min(1).max(100).default(1),
    expiresInDays: z.number().int().min(1).max(90).default(14),
    locale: z.enum(["en", "de"]).default("en").describe("language of the mail"),
  }),
  output: z.object({ invite: Invite, code: z.string(), link: z.string() }),
  run: async (ctx, input) => {
    const { orgId, role, teamIds, athleteId, maxUses, expiresInDays, locale } = input;
    const email = input.email?.trim().toLowerCase();
    const { db, clock, appUrl, mailer } = ctx.ports;
    const result = await db.transaction(async (tx) => {
      const me = await requireMember(tx, ctx, orgId, "coach");
      requireClub(me);
      checkInviteRights(me, role, teamIds);
      await requireTeamsOfOrg(tx, orgId, teamIds);
      if (athleteId) {
        const [athlete] = await tx.select().from(athletes).where(and(eq(athletes.id, athleteId), eq(athletes.orgId, orgId)));
        if (!athlete) throw notFound("Athlete not found.");
        if (athlete.userId) throw conflict("This athlete profile already belongs to a user.");
        if (!seesTeams(me, athlete.teamIds)) throw forbidden("Not your athlete.");
      }
      const now = clock();
      const code = newToken();
      const [invite] = await tx
        .insert(invites)
        .values({
          id: uuidv7(now.getTime()),
          orgId,
          codeHash: hashToken(code),
          email: email ?? null,
          role,
          teamIds,
          athleteId: athleteId ?? null,
          maxUses,
          createdBy: me.userId,
          createdAt: now,
          expiresAt: new Date(now.getTime() + expiresInDays * 86_400_000),
        })
        .returning();
      await recordAudit(tx, ctx, { orgId, action: "invite.created", resourceType: "invite", resourceId: invite!.id, details: { role } });
      const org = await loadOrg(tx, orgId);
      return { invite: invite!, code, orgName: org.name };
    });
    const link = appLink(appUrl, `/invite/${encodeURIComponent(result.code)}`);
    if (email) await mailer.send({ to: email, ...inviteMail(locale, result.orgName, role, link, expiresInDays) });
    return { invite: toInvite(result.invite), code: result.code, link };
  },
});

export const listInvites = defineUseCase({
  name: "list_invites",
  title: "Open invitations",
  description: "Invitations of a club that can still be used. Admins and owners.",
  http: { method: "get", path: "/v1/orgs/{orgId}/invites" },
  tag: "orgs",
  scope: "org:read",
  agent: "deny",
  readOnly: true,
  input: OrgPath,
  output: z.object({ invites: z.array(Invite) }),
  run: async (ctx, { orgId }) => {
    const db = ctx.ports.db;
    await requireMember(db, ctx, orgId, "admin");
    const rows = await db
      .select()
      .from(invites)
      .where(and(eq(invites.orgId, orgId), isNull(invites.revokedAt), gt(invites.expiresAt, ctx.ports.clock()), sql`${invites.uses} < ${invites.maxUses}`))
      .orderBy(invites.createdAt);
    return { invites: rows.map(toInvite) };
  },
});

export const revokeInvite = defineUseCase({
  name: "revoke_invite",
  title: "Revoke an invitation",
  description: "The invitation code stops working. Admins and owners.",
  http: { method: "delete", path: "/v1/orgs/{orgId}/invites/{inviteId}" },
  tag: "orgs",
  scope: "org:write",
  agent: "deny",
  input: OrgPath.extend({ inviteId: Id }),
  output: Ok,
  run: async (ctx, { orgId, inviteId }) =>
    ctx.ports.db.transaction(async (tx) => {
      await requireMember(tx, ctx, orgId, "admin");
      const done = await tx
        .update(invites)
        .set({ revokedAt: ctx.ports.clock() })
        .where(and(eq(invites.id, inviteId), eq(invites.orgId, orgId)))
        .returning({ id: invites.id });
      if (done.length === 0) throw notFound("Invitation not found.");
      await recordAudit(tx, ctx, { orgId, action: "invite.revoked", resourceType: "invite", resourceId: inviteId });
      return ok;
    }),
});

export const acceptInvite = defineUseCase({
  name: "accept_invite",
  title: "Accept an invitation",
  description:
    "Joins the club with the invitation's role and teams (an existing membership is only ever raised). " +
    "An invitation for an e-mail address works only for that address.",
  http: { method: "post", path: "/v1/invites/accept" },
  tag: "orgs",
  scope: "org:write",
  agent: "deny",
  input: z.object({ code: z.string().min(10).max(200) }),
  output: Org,
  run: async (ctx, { code }) => {
    const uid = userId(ctx);
    return ctx.ports.db.transaction(async (tx) => {
      const now = ctx.ports.clock();
      const [invite] = await tx
        .select()
        .from(invites)
        .where(and(eq(invites.codeHash, hashToken(code)), isNull(invites.revokedAt), gt(invites.expiresAt, now)));
      if (!invite || invite.uses >= invite.maxUses) throw notFound("The invitation is invalid or has expired.");
      if (invite.email) {
        const [user] = await tx.select({ email: users.email }).from(users).where(eq(users.id, uid));
        if (user?.email !== invite.email) throw forbidden("This invitation is for another e-mail address.");
      }
      const counted = await tx
        .update(invites)
        .set({ uses: sql`${invites.uses} + 1` })
        .where(and(eq(invites.id, invite.id), sql`${invites.uses} < ${invites.maxUses}`))
        .returning({ id: invites.id });
      if (counted.length === 0) throw notFound("The invitation is invalid or has expired.");

      const [existing] = await tx.select().from(memberships).where(and(eq(memberships.orgId, invite.orgId), eq(memberships.userId, uid)));
      let role = invite.role;
      let teamIds = invite.teamIds;
      if (existing) {
        role = atLeast(existing.role, invite.role) ? existing.role : invite.role;
        teamIds = existing.teamIds.length === 0 || invite.teamIds.length === 0 ? [] : [...new Set([...existing.teamIds, ...invite.teamIds])];
        await tx.update(memberships).set({ role, teamIds }).where(and(eq(memberships.orgId, invite.orgId), eq(memberships.userId, uid)));
      } else {
        await tx.insert(memberships).values({ orgId: invite.orgId, userId: uid, role, teamIds, createdAt: now });
      }
      if (invite.athleteId) {
        const claimed = await tx
          .update(athletes)
          .set({ userId: uid })
          .where(and(eq(athletes.id, invite.athleteId), isNull(athletes.userId)))
          .returning({ id: athletes.id });
        if (claimed.length === 0) throw conflict("This athlete profile already belongs to a user.");
      }
      await recordAudit(tx, ctx, {
        orgId: invite.orgId,
        action: "invite.accepted",
        resourceType: "invite",
        resourceId: invite.id,
        details: { role, athleteId: invite.athleteId },
      });
      return toOrg(await loadOrg(tx, invite.orgId), { role, teamIds });
    });
  },
});

// ---------- athletes ----------

const Athlete = z.object({
  id: Id,
  orgId: Id,
  name: z.string().describe("pseudonym for AI clients unless the club allows real names"),
  birthYear: z.number().int().nullable(),
  teamIds: z.array(Id),
  claimed: z.boolean().describe("a user account owns this profile"),
  consentAt: Timestamp.nullable().describe("when the consent for this profile was confirmed"),
  createdAt: Timestamp,
});
type AthleteRow = typeof athletes.$inferSelect;

/** Stable pseudonym from the id (spec §7.3). */
export const pseudonym = (id: string) => `Athlete ${id.replace(/-/g, "").slice(-4).toUpperCase()}`;

function toAthlete(a: AthleteRow, ctx: Ctx, realNames: boolean) {
  const hide = ctx.via === "mcp" && !realNames;
  return {
    id: a.id,
    orgId: a.orgId,
    name: hide ? pseudonym(a.id) : a.name,
    birthYear: hide ? null : a.birthYear,
    teamIds: a.teamIds,
    claimed: a.userId !== null,
    consentAt: isoOrNull(a.consentAt),
    createdAt: iso(a.createdAt),
  };
}

const AthletePath = OrgPath.extend({ athleteId: Id });

async function loadAthlete(tx: Tx, orgId: string, athleteId: string, me: Member): Promise<AthleteRow> {
  const [a] = await tx.select().from(athletes).where(and(eq(athletes.id, athleteId), eq(athletes.orgId, orgId)));
  if (!a || !seesTeams(me, a.teamIds)) throw notFound("Athlete not found.");
  return a;
}

export const listAthletes = defineUseCase({
  name: "list_athletes",
  title: "Athletes of a club",
  description:
    "Athlete profiles of a club, optionally of one team. Coaches see their teams. AI clients get pseudonyms " +
    "and no birth years unless a club admin allowed real names.",
  http: { method: "get", path: "/v1/orgs/{orgId}/athletes" },
  tag: "athletes",
  scope: "athletes:read",
  agent: "allow",
  readOnly: true,
  input: OrgPath.extend({ teamId: Id.optional() }),
  output: z.object({ athletes: z.array(Athlete) }),
  run: async (ctx, { orgId, teamId }) => {
    const db = ctx.ports.db;
    const me = await requireMember(db, ctx, orgId, "coach");
    const org = await loadOrg(db, orgId);
    const rows = await db
      .select()
      .from(athletes)
      .where(and(eq(athletes.orgId, orgId), teamId ? sql`${teamId}::uuid = any(${athletes.teamIds})` : undefined))
      .orderBy(athletes.name);
    return { athletes: rows.filter((a) => seesTeams(me, a.teamIds)).map((a) => toAthlete(a, ctx, org.agentRealNames)) };
  },
});

export const createAthlete = defineUseCase({
  name: "create_athlete",
  title: "Add an athlete",
  description:
    "Adds an athlete profile (no login needed). Coaches add to their own teams. `consent: true` confirms that the " +
    "athlete (for minors: the parents) agreed to the storage of their results; the platform records when and by whom.",
  http: { method: "post", path: "/v1/orgs/{orgId}/athletes", status: 201 },
  tag: "athletes",
  scope: "athletes:write",
  agent: "deny",
  input: OrgPath.extend({
    name: Name.describe("name or nickname"),
    birthYear: z.number().int().min(1900).max(2100).optional(),
    teamIds: TeamIds.default([]),
    consent: z.literal(true).describe("the athlete (for minors: the parents) agreed"),
  }),
  output: Athlete,
  run: async (ctx, { orgId, name, birthYear, teamIds }) =>
    ctx.ports.db.transaction(async (tx) => {
      const me = await requireMember(tx, ctx, orgId, "coach");
      requireClub(me);
      if (!coversTeams(me, teamIds)) throw forbidden("Add athletes to your own teams.");
      await requireTeamsOfOrg(tx, orgId, teamIds);
      const now = ctx.ports.clock();
      const [a] = await tx
        .insert(athletes)
        .values({ id: uuidv7(now.getTime()), orgId, name, birthYear: birthYear ?? null, teamIds, consentAt: now, consentBy: me.userId, createdAt: now })
        .returning();
      await recordAudit(tx, ctx, { orgId, action: "athlete.created", resourceType: "athlete", resourceId: a!.id });
      return toAthlete(a!, ctx, true);
    }),
});

export const updateAthlete = defineUseCase({
  name: "update_athlete",
  title: "Change an athlete",
  description: "Name, birth year and teams of an athlete profile. Coaches for their teams.",
  http: { method: "patch", path: "/v1/orgs/{orgId}/athletes/{athleteId}" },
  tag: "athletes",
  scope: "athletes:write",
  agent: "deny",
  input: AthletePath.extend({
    name: Name.optional(),
    birthYear: z.number().int().min(1900).max(2100).nullable().optional(),
    teamIds: TeamIds.optional(),
  }),
  output: Athlete,
  run: async (ctx, { orgId, athleteId, ...patch }) =>
    ctx.ports.db.transaction(async (tx) => {
      const me = await requireMember(tx, ctx, orgId, "coach");
      await loadAthlete(tx, orgId, athleteId, me);
      if (patch.teamIds) {
        if (!coversTeams(me, patch.teamIds)) throw forbidden("Assign athletes to your own teams.");
        await requireTeamsOfOrg(tx, orgId, patch.teamIds);
      }
      const [a] = await tx.update(athletes).set(patch).where(eq(athletes.id, athleteId)).returning();
      await recordAudit(tx, ctx, { orgId, action: "athlete.updated", resourceType: "athlete", resourceId: athleteId, details: { fields: Object.keys(patch) } });
      return toAthlete(a!, ctx, true);
    }),
});

/**
 * Removes an athlete profile and everything that names it: its training sessions (with their reports
 * and values, by cascade) and its invitations, so no link survives (P24). Team ids sit on the profile.
 */
async function removeAthlete(tx: Tx, athleteId: string): Promise<void> {
  await tx.delete(trainingSessions).where(eq(trainingSessions.athleteId, athleteId));
  await tx.delete(invites).where(eq(invites.athleteId, athleteId));
  await tx.delete(athletes).where(eq(athletes.id, athleteId));
}

export const deleteAthlete = defineUseCase({
  name: "delete_athlete",
  title: "Delete an athlete",
  description: "Deletes an athlete profile with all its training sessions, results and invitations. Coaches for their teams.",
  http: { method: "delete", path: "/v1/orgs/{orgId}/athletes/{athleteId}" },
  tag: "athletes",
  scope: "athletes:write",
  agent: "deny",
  input: AthletePath,
  output: Ok,
  run: async (ctx, { orgId, athleteId }) =>
    ctx.ports.db.transaction(async (tx) => {
      const me = await requireMember(tx, ctx, orgId, "coach");
      await loadAthlete(tx, orgId, athleteId, me);
      await removeAthlete(tx, athleteId);
      await recordAudit(tx, ctx, { orgId, action: "athlete.deleted", resourceType: "athlete", resourceId: athleteId });
      return ok;
    }),
});

export const deleteMyAthleteProfile = defineUseCase({
  name: "delete_my_athlete_profile",
  title: "Delete my athlete profile",
  description:
    "Deletes the athlete profile the caller claimed in this club, with all its results, invitations and links. " +
    "Only the user who claimed the profile may do this; for anyone else it is 404.",
  http: { method: "delete", path: "/v1/orgs/{orgId}/me/athletes/{athleteId}" },
  tag: "athletes",
  scope: "athletes:write",
  agent: "deny",
  input: AthletePath,
  output: Ok,
  run: async (ctx, { orgId, athleteId }) =>
    ctx.ports.db.transaction(async (tx) => {
      const uid = userId(ctx);
      const [a] = await tx
        .select({ id: athletes.id })
        .from(athletes)
        .where(and(eq(athletes.id, athleteId), eq(athletes.orgId, orgId), eq(athletes.userId, uid)));
      if (!a) throw notFound("Athlete not found.");
      await removeAthlete(tx, athleteId);
      await recordAudit(tx, ctx, { orgId, action: "athlete.self_deleted", resourceType: "athlete", resourceId: athleteId });
      return ok;
    }),
});

export const orgUseCases = [
  listMyOrgs,
  createOrg,
  getOrg,
  updateOrg,
  deleteOrg,
  listMembers,
  updateMember,
  removeMember,
  leaveOrg,
  transferOwnership,
  listTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  createInvite,
  listInvites,
  revokeInvite,
  acceptInvite,
  listAthletes,
  createAthlete,
  updateAthlete,
  deleteAthlete,
  deleteMyAthleteProfile,
];
