import { timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { hashToken, newCode, newToken, normalizeEmail, userId } from "../../core/auth";
import { AppError, conflict, invalidInput, notFound, tooManyRequests } from "../../core/errors";
import { uuidv7 } from "../../core/ids";
import { Id, iso, isoOrNull, Locale, Ok, ok, Timestamp } from "../../core/schemas";
import { defineUseCase } from "../../core/useCase";
import { recordAudit } from "../audit/record";
import { auditLog } from "../audit/schema";
import { athletes, memberships, organizations } from "../orgs/schema";
import { createPersonalOrg } from "../orgs/service";
import { appLink, loginMail } from "./mails";
import { accessTokens, loginRequests, users } from "./schema";
import { issueSession } from "./tokens";

const LOGIN_MINUTES = 15;
const MAX_CODE_ATTEMPTS = 5;
const HOUR = 3_600_000;

const invalidLogin = () => new AppError(401, "invalid_login", "The link or code is invalid or has expired.");

export const User = z.object({
  id: Id,
  email: z.email(),
  displayName: z.string(),
  locale: Locale,
  createdAt: Timestamp,
});
type UserRow = typeof users.$inferSelect;
const toUser = (u: UserRow) => ({ ...u, locale: u.locale as "en" | "de", createdAt: iso(u.createdAt) });

const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const requestLogin = defineUseCase({
  name: "request_login",
  title: "Request a sign-in mail",
  description:
    "Sends a sign-in mail with a 6-digit code and a link into the Config App. Creates the account on the " +
    "first sign-in. Always answers 202, also for unknown addresses.",
  http: { method: "post", path: "/v1/auth/login", status: 202 },
  tag: "auth",
  agent: "deny",
  input: z.object({ email: z.email().max(254), locale: Locale.default("en") }),
  output: Ok,
  run: async (ctx, { email, locale }) => {
    const address = normalizeEmail(email);
    const { rateLimit, clock, db, mailer, appUrl } = ctx.ports;
    const byEmail = rateLimit.hit(`login:email:${address}`, 5, HOUR);
    const byIp = ctx.client.ip ? rateLimit.hit(`login:ip:${ctx.client.ip}`, 20, HOUR) : true;
    if (!byEmail || !byIp) throw tooManyRequests();
    const now = clock();
    const token = newToken();
    const code = newCode();
    await db.insert(loginRequests).values({
      id: uuidv7(now.getTime()),
      email: address,
      tokenHash: hashToken(token),
      codeHash: hashToken(code),
      createdAt: now,
      expiresAt: new Date(now.getTime() + LOGIN_MINUTES * 60_000),
      ip: ctx.client.ip ?? null,
    });
    const link = appLink(appUrl, `/login?token=${encodeURIComponent(token)}`);
    await mailer.send({ to: address, ...loginMail(locale, link, code, LOGIN_MINUTES) });
    return ok;
  },
});

export const verifyLogin = defineUseCase({
  name: "verify_login",
  title: "Sign in with link token or code",
  description:
    "Completes a sign-in with the `token` from the link, or with `email` + `code`. Returns a session " +
    "token for the Authorization header (Bearer). A code works for 5 attempts.",
  http: { method: "post", path: "/v1/auth/verify" },
  tag: "auth",
  agent: "deny",
  input: z.object({
    token: z.string().max(200).optional(),
    email: z.email().max(254).optional(),
    code: z.string().regex(/^\d{6}$/).optional(),
    locale: Locale.optional().describe("used for a new account"),
  }),
  output: z.object({ accessToken: z.string(), expiresAt: Timestamp, user: User, created: z.boolean() }),
  run: async (ctx, input) => {
    const { db, clock, sessionDays } = ctx.ports;
    const now = clock();
    // find and check the request outside the transaction, so a wrong code's attempt is counted
    let request: typeof loginRequests.$inferSelect | undefined;
    if (input.token) {
      [request] = await db
        .select()
        .from(loginRequests)
        .where(and(eq(loginRequests.tokenHash, hashToken(input.token)), isNull(loginRequests.usedAt), gt(loginRequests.expiresAt, now)));
      if (!request) throw invalidLogin();
    } else if (input.email && input.code) {
      [request] = await db
        .select()
        .from(loginRequests)
        .where(and(eq(loginRequests.email, normalizeEmail(input.email)), isNull(loginRequests.usedAt), gt(loginRequests.expiresAt, now)))
        .orderBy(desc(loginRequests.createdAt))
        .limit(1);
      if (!request || request.attempts >= MAX_CODE_ATTEMPTS) throw invalidLogin();
      if (!sameHash(request.codeHash, hashToken(input.code))) {
        await db.update(loginRequests).set({ attempts: sql`${loginRequests.attempts} + 1` }).where(eq(loginRequests.id, request.id));
        throw invalidLogin();
      }
    } else {
      throw invalidInput("Pass `token`, or `email` and `code`.");
    }
    const { id: requestId, email } = request;
    return db.transaction(async (tx) => {
      // single use, also when two verifications race
      const used = await tx
        .update(loginRequests)
        .set({ usedAt: now })
        .where(and(eq(loginRequests.id, requestId), isNull(loginRequests.usedAt)))
        .returning({ id: loginRequests.id });
      if (used.length === 0) throw invalidLogin();

      let [user] = await tx.select().from(users).where(eq(users.email, email));
      const created = !user;
      if (!user) {
        [user] = await tx
          .insert(users)
          .values({ id: uuidv7(now.getTime()), email, locale: input.locale ?? "en", createdAt: now })
          .returning();
        const orgId = await createPersonalOrg(tx, user!.id, email.split("@")[0]!, now);
        const actorCtx = { ...ctx, actor: { kind: "user" as const, userId: user!.id, tokenId: "" } };
        await recordAudit(tx, actorCtx, { orgId, action: "user.created", resourceType: "user", resourceId: user!.id });
      }
      const session = await issueSession(tx, user!.id, now, sessionDays, ctx.client.userAgent ?? "");
      return { accessToken: session.token, expiresAt: iso(session.expiresAt), user: toUser(user!), created };
    });
  },
});

export const logout = defineUseCase({
  name: "logout",
  title: "Sign out",
  description: "Revokes the token of this request.",
  http: { method: "post", path: "/v1/auth/logout" },
  tag: "auth",
  agent: "deny",
  input: z.object({}),
  output: Ok,
  run: async (ctx) => {
    userId(ctx);
    if (ctx.actor.kind === "anonymous") return ok;
    await ctx.ports.db.update(accessTokens).set({ revokedAt: ctx.ports.clock() }).where(eq(accessTokens.id, ctx.actor.tokenId));
    return ok;
  },
});

export const getMe = defineUseCase({
  name: "get_me",
  title: "Current user",
  description: "The signed-in user's profile.",
  http: { method: "get", path: "/v1/me" },
  tag: "me",
  scope: "profile",
  agent: "allow",
  readOnly: true,
  input: z.object({}),
  output: User,
  run: async (ctx) => {
    const [user] = await ctx.ports.db.select().from(users).where(eq(users.id, userId(ctx)));
    if (!user) throw notFound();
    return toUser(user);
  },
});

export const updateMe = defineUseCase({
  name: "update_me",
  title: "Update profile",
  description: "Changes display name and language.",
  http: { method: "patch", path: "/v1/me" },
  tag: "me",
  scope: "profile",
  agent: "deny",
  input: z.object({ displayName: z.string().trim().max(60).optional(), locale: Locale.optional() }),
  output: User,
  run: async (ctx, patch) => {
    const uid = userId(ctx);
    return ctx.ports.db.transaction(async (tx) => {
      const [user] = await tx.update(users).set(patch).where(eq(users.id, uid)).returning();
      if (!user) throw notFound();
      await recordAudit(tx, ctx, { action: "user.updated", resourceType: "user", resourceId: uid, details: { fields: Object.keys(patch) } });
      return toUser(user);
    });
  },
});

const Session = z.object({
  id: Id,
  label: z.string().describe("browser / device the session was created from"),
  createdAt: Timestamp,
  lastUsedAt: Timestamp.nullable(),
  expiresAt: Timestamp,
  current: z.boolean(),
});

export const listSessions = defineUseCase({
  name: "list_sessions",
  title: "Signed-in devices",
  description: "Active sessions of the signed-in user.",
  http: { method: "get", path: "/v1/me/sessions" },
  tag: "me",
  scope: "profile",
  agent: "deny",
  readOnly: true,
  input: z.object({}),
  output: z.object({ sessions: z.array(Session) }),
  run: async (ctx) => {
    const now = ctx.ports.clock();
    const rows = await ctx.ports.db
      .select()
      .from(accessTokens)
      .where(and(eq(accessTokens.userId, userId(ctx)), eq(accessTokens.kind, "session"), isNull(accessTokens.revokedAt), gt(accessTokens.expiresAt, now)))
      .orderBy(desc(accessTokens.createdAt));
    const current = ctx.actor.kind === "anonymous" ? "" : ctx.actor.tokenId;
    return {
      sessions: rows.map((r) => ({
        id: r.id,
        label: r.label,
        createdAt: iso(r.createdAt),
        lastUsedAt: isoOrNull(r.lastUsedAt),
        expiresAt: iso(r.expiresAt),
        current: r.id === current,
      })),
    };
  },
});

export const revokeSession = defineUseCase({
  name: "revoke_session",
  title: "Sign out a device",
  description: "Revokes one session of the signed-in user.",
  http: { method: "delete", path: "/v1/me/sessions/{sessionId}" },
  tag: "me",
  scope: "profile",
  agent: "deny",
  input: z.object({ sessionId: Id }),
  output: Ok,
  run: async (ctx, { sessionId }) => {
    const done = await ctx.ports.db
      .update(accessTokens)
      .set({ revokedAt: ctx.ports.clock() })
      .where(and(eq(accessTokens.id, sessionId), eq(accessTokens.userId, userId(ctx)), isNull(accessTokens.revokedAt)))
      .returning({ id: accessTokens.id });
    if (done.length === 0) throw notFound("Session not found.");
    return ok;
  },
});

export const exportMyData = defineUseCase({
  name: "export_my_data",
  title: "Export my data",
  description: "Everything the platform stores about the signed-in user, as JSON (GDPR art. 15 / 20).",
  http: { method: "get", path: "/v1/me/export" },
  tag: "me",
  scope: "profile",
  agent: "deny",
  readOnly: true,
  input: z.object({}),
  output: z.object({
    exportedAt: Timestamp,
    user: User,
    memberships: z.array(z.object({ orgId: Id, orgName: z.string(), kind: z.string(), role: z.string(), teamIds: z.array(Id) })),
    athleteProfiles: z.array(z.object({ id: Id, orgId: Id, name: z.string(), birthYear: z.number().nullable() })),
    sessions: z.array(z.object({ id: Id, label: z.string(), createdAt: Timestamp, expiresAt: Timestamp })),
    activity: z.array(z.object({ at: Timestamp, action: z.string(), resourceType: z.string(), resourceId: z.string().nullable(), via: z.string() })),
  }),
  run: async (ctx) => {
    const uid = userId(ctx);
    const { db, clock } = ctx.ports;
    const [user] = await db.select().from(users).where(eq(users.id, uid));
    if (!user) throw notFound();
    const ms = await db
      .select({ orgId: memberships.orgId, orgName: organizations.name, kind: organizations.kind, role: memberships.role, teamIds: memberships.teamIds })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(eq(memberships.userId, uid));
    const profiles = await db
      .select({ id: athletes.id, orgId: athletes.orgId, name: athletes.name, birthYear: athletes.birthYear })
      .from(athletes)
      .where(eq(athletes.userId, uid));
    const tokens = await db.select().from(accessTokens).where(eq(accessTokens.userId, uid));
    const activity = await db.select().from(auditLog).where(eq(auditLog.actorUserId, uid)).orderBy(auditLog.id);
    return {
      exportedAt: iso(clock()),
      user: toUser(user),
      memberships: ms,
      athleteProfiles: profiles,
      sessions: tokens.map((t) => ({ id: t.id, label: t.label, createdAt: iso(t.createdAt), expiresAt: iso(t.expiresAt) })),
      activity: activity.map((a) => ({ at: iso(a.at), action: a.action, resourceType: a.resourceType, resourceId: a.resourceId, via: a.via })),
    };
  },
});

export const deleteAccount = defineUseCase({
  name: "delete_account",
  title: "Delete my account",
  description:
    "Deletes the account, the personal space and all sessions. Not possible while you are the only owner " +
    "of a club (transfer the ownership or delete the club first). Athlete profiles stay with their clubs.",
  http: { method: "delete", path: "/v1/me" },
  tag: "me",
  scope: "profile",
  agent: "deny",
  input: z.object({}),
  output: Ok,
  run: async (ctx) => {
    const uid = userId(ctx);
    return ctx.ports.db.transaction(async (tx) => {
      const owned = await tx
        .select({ orgId: memberships.orgId, kind: organizations.kind })
        .from(memberships)
        .innerJoin(organizations, eq(organizations.id, memberships.orgId))
        .where(and(eq(memberships.userId, uid), eq(memberships.role, "owner")));
      const clubs = owned.filter((o) => o.kind === "club").map((o) => o.orgId);
      if (clubs.length > 0) {
        const owners = await tx
          .select({ orgId: memberships.orgId })
          .from(memberships)
          .where(and(inArray(memberships.orgId, clubs), eq(memberships.role, "owner")));
        const soleOwner = clubs.find((c) => owners.filter((o) => o.orgId === c).length === 1);
        if (soleOwner) throw conflict("You are the only owner of a club. Transfer the ownership or delete the club first.");
      }
      const personal = owned.filter((o) => o.kind === "personal").map((o) => o.orgId);
      if (personal.length > 0) await tx.delete(organizations).where(inArray(organizations.id, personal));
      await tx.update(auditLog).set({ actorUserId: null }).where(eq(auditLog.actorUserId, uid));
      await tx.delete(users).where(eq(users.id, uid)); // tokens and memberships cascade, athletes are unlinked
      await recordAudit(tx, { ...ctx, actor: { kind: "anonymous" } }, { action: "user.deleted", resourceType: "user" });
      return ok;
    });
  },
});

export const identityUseCases = [
  requestLogin,
  verifyLogin,
  logout,
  getMe,
  updateMe,
  listSessions,
  revokeSession,
  exportMyData,
  deleteAccount,
];
