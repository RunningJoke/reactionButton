import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { testEnv, type TestEnv } from "./helpers";

let env: TestEnv;
let owner: string;
let club: { id: string };

beforeEach(async () => {
  env = await testEnv();
  owner = await env.signIn("owner@example.org");
  club = (await env.call("POST", "/v1/orgs", { name: "TV Muster", country: "DE" }, owner)).body;
});
afterEach(() => env.close());

const meId = async (token: string) => (await env.call("GET", "/v1/me", undefined, token)).body.id as string;

/** Invites `email` with `body`, signs them in and accepts; returns their token. */
async function join(email: string, body: Record<string, unknown>, by = owner) {
  const invite = await env.call("POST", `/v1/orgs/${club.id}/invites`, body, by);
  if (invite.status !== 201) throw new Error(`invite ${invite.status} ${JSON.stringify(invite.body)}`);
  const token = await env.signIn(email);
  const res = await env.call("POST", "/v1/invites/accept", { code: invite.body.code }, token);
  if (res.status !== 200) throw new Error(`accept ${res.status} ${JSON.stringify(res.body)}`);
  return token;
}

describe("clubs", () => {
  it("every user has a personal space; a new club makes the creator owner", async () => {
    const orgs = (await env.call("GET", "/v1/orgs", undefined, owner)).body.orgs;
    expect(orgs.map((o: { kind: string; role: string }) => [o.kind, o.role])).toEqual([
      ["club", "owner"],
      ["personal", "owner"],
    ]);
    expect((await env.call("GET", `/v1/orgs/${club.id}`, undefined, owner)).body).toMatchObject({ name: "TV Muster", country: "DE" });
  });

  it("hides clubs from non-members (404)", async () => {
    const stranger = await env.signIn("stranger@example.org");
    expect((await env.call("GET", `/v1/orgs/${club.id}`, undefined, stranger)).status).toBe(404);
    expect((await env.call("GET", `/v1/orgs/${club.id}/members`, undefined, stranger)).status).toBe(404);
  });

  it("only owners delete clubs; the personal space cannot be deleted", async () => {
    const admin = await join("admin@example.org", { role: "admin" });
    expect((await env.call("DELETE", `/v1/orgs/${club.id}`, undefined, admin)).status).toBe(403);
    const personal = (await env.call("GET", "/v1/orgs", undefined, owner)).body.orgs.find((o: { kind: string }) => o.kind === "personal");
    expect((await env.call("DELETE", `/v1/orgs/${personal.id}`, undefined, owner)).status).toBe(403);
    expect((await env.call("DELETE", `/v1/orgs/${club.id}`, undefined, owner)).status).toBe(200);
    expect((await env.call("GET", `/v1/orgs/${club.id}`, undefined, owner)).status).toBe(404);
  });
});

describe("invitations", () => {
  it("mails an invitation; only that address can accept it, once", async () => {
    const res = await env.call("POST", `/v1/orgs/${club.id}/invites`, { role: "coach", email: "Coach@Example.org" }, owner);
    expect(res.status).toBe(201);
    expect(res.body.link).toBe(`https://app.test/#/invite/${res.body.code}`);
    const mail = env.mailer.sent.at(-1)!;
    expect(mail).toMatchObject({ to: "coach@example.org", subject: "Invitation to TV Muster on ReactPod" });
    expect(mail.text).toContain(res.body.link);

    const wrong = await env.signIn("someone@example.org");
    expect((await env.call("POST", "/v1/invites/accept", { code: res.body.code }, wrong)).status).toBe(403);
    const coach = await env.signIn("coach@example.org");
    const accepted = await env.call("POST", "/v1/invites/accept", { code: res.body.code }, coach);
    expect(accepted.body).toMatchObject({ id: club.id, role: "coach" });
    expect((await env.call("POST", "/v1/invites/accept", { code: res.body.code }, coach)).status).toBe(404);
  });

  it("expires, can be revoked, counts uses", async () => {
    const a = (await env.call("POST", `/v1/orgs/${club.id}/invites`, { role: "viewer", expiresInDays: 1 }, owner)).body;
    const b = (await env.call("POST", `/v1/orgs/${club.id}/invites`, { role: "viewer", maxUses: 2 }, owner)).body;
    expect((await env.call("GET", `/v1/orgs/${club.id}/invites`, undefined, owner)).body.invites).toHaveLength(2);
    await env.call("DELETE", `/v1/orgs/${club.id}/invites/${b.invite.id}`, undefined, owner);
    env.clock.advance(2 * 86_400_000);
    const user = await env.signIn("v@example.org");
    expect((await env.call("POST", "/v1/invites/accept", { code: a.code }, user)).status).toBe(404);
    expect((await env.call("POST", "/v1/invites/accept", { code: b.code }, user)).status).toBe(404);
    expect((await env.call("GET", `/v1/orgs/${club.id}/invites`, undefined, owner)).body.invites).toHaveLength(0);
  });

  it("never lowers an existing role", async () => {
    const admin = await join("admin@example.org", { role: "admin" });
    const invite = (await env.call("POST", `/v1/orgs/${club.id}/invites`, { role: "viewer" }, owner)).body;
    expect((await env.call("POST", "/v1/invites/accept", { code: invite.code }, admin)).body.role).toBe("admin");
  });

  it("owners are not invited; coaches invite athletes and viewers to their teams only", async () => {
    expect((await env.call("POST", `/v1/orgs/${club.id}/invites`, { role: "owner" }, owner)).status).toBe(400);
    const u12 = (await env.call("POST", `/v1/orgs/${club.id}/teams`, { name: "U12" }, owner)).body;
    const u14 = (await env.call("POST", `/v1/orgs/${club.id}/teams`, { name: "U14" }, owner)).body;
    const coach = await join("coach@example.org", { role: "coach", teamIds: [u12.id] });
    const invite = (body: object) => env.call("POST", `/v1/orgs/${club.id}/invites`, body, coach);
    expect((await invite({ role: "athlete", teamIds: [u12.id] })).status).toBe(201);
    expect((await invite({ role: "athlete", teamIds: [u14.id] })).status).toBe(403);
    expect((await invite({ role: "athlete" })).status).toBe(403);
    expect((await invite({ role: "coach", teamIds: [u12.id] })).status).toBe(403);
  });

  it("an athlete takes over their profile through an invitation", async () => {
    const athlete = (await env.call("POST", `/v1/orgs/${club.id}/athletes`, { consent: true, name: "Mia" }, owner)).body;
    const token = await join("mia@example.org", { role: "athlete", athleteId: athlete.id });
    const list = (await env.call("GET", `/v1/orgs/${club.id}/athletes`, undefined, owner)).body.athletes;
    expect(list[0]).toMatchObject({ id: athlete.id, claimed: true });
    const exported = (await env.call("GET", "/v1/me/export", undefined, token)).body;
    expect(exported.athleteProfiles).toEqual([expect.objectContaining({ id: athlete.id, name: "Mia" })]);
    expect((await env.call("POST", `/v1/orgs/${club.id}/invites`, { role: "athlete", athleteId: athlete.id }, owner)).status).toBe(409);
  });

  it("the athlete sees their claimed profile in /v1/me; other users do not see it", async () => {
    const athlete = (await env.call("POST", `/v1/orgs/${club.id}/athletes`, { consent: true, name: "Mia", birthYear: 2014 }, owner)).body;
    const token = await join("mia@example.org", { role: "athlete", athleteId: athlete.id });
    const me = (await env.call("GET", "/v1/me", undefined, token)).body;
    expect(me.athleteProfiles).toEqual([{ athleteId: athlete.id, orgId: club.id, orgName: "TV Muster", name: "Mia", birthYear: 2014 }]);
    expect((await env.call("GET", "/v1/me", undefined, owner)).body.athleteProfiles).toEqual([]);

    // a user who is not a club member, and a claimed profile of a user who left the club
    const stranger = await env.signIn("stranger@example.org");
    expect((await env.call("GET", "/v1/me", undefined, stranger)).body.athleteProfiles).toEqual([]);
    const members = (await env.call("GET", `/v1/orgs/${club.id}/members`, undefined, owner)).body.members as { userId: string; role: string }[];
    const mia = members.find((m) => m.role === "athlete")!;
    await env.call("DELETE", `/v1/orgs/${club.id}/members/${mia.userId}`, undefined, owner);
    expect((await env.call("GET", "/v1/me", undefined, token)).body.athleteProfiles).toEqual([]);
  });
});

describe("members and ownership", () => {
  it("admins manage members but not owners; the last owner stays", async () => {
    const admin = await join("admin@example.org", { role: "admin" });
    const coach = await join("coach@example.org", { role: "coach" });
    const coachId = await meId(coach);
    const ownerId = await meId(owner);
    expect((await env.call("PATCH", `/v1/orgs/${club.id}/members/${coachId}`, { role: "viewer" }, admin)).status).toBe(200);
    expect((await env.call("PATCH", `/v1/orgs/${club.id}/members/${coachId}`, { role: "owner" }, admin)).status).toBe(403);
    expect((await env.call("DELETE", `/v1/orgs/${club.id}/members/${ownerId}`, undefined, admin)).status).toBe(403);
    expect((await env.call("PATCH", `/v1/orgs/${club.id}/members/${ownerId}`, { role: "admin" }, owner)).status).toBe(409);
    expect((await env.call("POST", `/v1/orgs/${club.id}/leave`, {}, owner)).status).toBe(409);
    expect((await env.call("PATCH", `/v1/orgs/${club.id}/members/${coachId}`, { role: "coach" }, coach)).status).toBe(403);

    const members = (await env.call("GET", `/v1/orgs/${club.id}/members`, undefined, admin)).body.members;
    expect(members.find((m: { userId: string }) => m.userId === coachId)).toMatchObject({ role: "viewer", email: "coach@example.org" });
    const asViewer = (await env.call("GET", `/v1/orgs/${club.id}/members`, undefined, coach)).body.members;
    expect(asViewer.every((m: { email: unknown }) => m.email === null)).toBe(true);

    expect((await env.call("DELETE", `/v1/orgs/${club.id}/members/${coachId}`, undefined, admin)).status).toBe(200);
    expect((await env.call("GET", `/v1/orgs/${club.id}`, undefined, coach)).status).toBe(404);
  });

  it("transfers ownership; the old owner becomes admin and may leave", async () => {
    const admin = await join("admin@example.org", { role: "admin" });
    const adminId = await meId(admin);
    expect((await env.call("POST", `/v1/orgs/${club.id}/transfer`, { userId: adminId }, admin)).status).toBe(403);
    expect((await env.call("POST", `/v1/orgs/${club.id}/transfer`, { userId: adminId }, owner)).status).toBe(200);
    expect((await env.call("GET", `/v1/orgs/${club.id}`, undefined, owner)).body.role).toBe("admin");
    expect((await env.call("GET", `/v1/orgs/${club.id}`, undefined, admin)).body.role).toBe("owner");
    expect((await env.call("POST", `/v1/orgs/${club.id}/leave`, {}, owner)).status).toBe(200);
  });
});

describe("teams and athletes", () => {
  it("team-limited coaches see and manage only their teams' athletes", async () => {
    const u12 = (await env.call("POST", `/v1/orgs/${club.id}/teams`, { name: "U12" }, owner)).body;
    const u14 = (await env.call("POST", `/v1/orgs/${club.id}/teams`, { name: "U14" }, owner)).body;
    const coach = await join("coach@example.org", { role: "coach", teamIds: [u12.id] });

    expect((await env.call("GET", `/v1/orgs/${club.id}/teams`, undefined, coach)).body.teams.map((t: { name: string }) => t.name)).toEqual(["U12"]);
    expect((await env.call("POST", `/v1/orgs/${club.id}/teams`, { name: "X" }, coach)).status).toBe(403);

    const mine = await env.call("POST", `/v1/orgs/${club.id}/athletes`, { consent: true, name: "Ben", birthYear: 2014, teamIds: [u12.id] }, coach);
    expect(mine.status).toBe(201);
    expect((await env.call("POST", `/v1/orgs/${club.id}/athletes`, { consent: true, name: "Cem", teamIds: [u14.id] }, coach)).status).toBe(403);
    const other = (await env.call("POST", `/v1/orgs/${club.id}/athletes`, { consent: true, name: "Cem", teamIds: [u14.id] }, owner)).body;

    const seen = (await env.call("GET", `/v1/orgs/${club.id}/athletes`, undefined, coach)).body.athletes;
    expect(seen.map((a: { name: string }) => a.name)).toEqual(["Ben"]);
    expect((await env.call("PATCH", `/v1/orgs/${club.id}/athletes/${other.id}`, { name: "X" }, coach)).status).toBe(404);
    expect((await env.call("PATCH", `/v1/orgs/${club.id}/athletes/${mine.body.id}`, { teamIds: [u14.id] }, coach)).status).toBe(403);
    const renamed = await env.call("PATCH", `/v1/orgs/${club.id}/athletes/${mine.body.id}`, { name: "Benjamin", birthYear: null }, coach);
    expect(renamed.body).toMatchObject({ name: "Benjamin", birthYear: null });

    const byTeam = (await env.call("GET", `/v1/orgs/${club.id}/athletes?teamId=${u14.id}`, undefined, owner)).body.athletes;
    expect(byTeam.map((a: { name: string }) => a.name)).toEqual(["Cem"]);

    // athletes and viewers do not see the athlete list
    const viewer = await join("parent@example.org", { role: "viewer" });
    expect((await env.call("GET", `/v1/orgs/${club.id}/athletes`, undefined, viewer)).status).toBe(403);

    expect((await env.call("DELETE", `/v1/orgs/${club.id}/athletes/${mine.body.id}`, undefined, coach)).status).toBe(200);
  });

  it("deleting a team removes it from members and athletes", async () => {
    const u12 = (await env.call("POST", `/v1/orgs/${club.id}/teams`, { name: "U12" }, owner)).body;
    const coach = await join("coach@example.org", { role: "coach", teamIds: [u12.id] });
    const a = (await env.call("POST", `/v1/orgs/${club.id}/athletes`, { consent: true, name: "Ben", teamIds: [u12.id] }, owner)).body;
    expect((await env.call("PATCH", `/v1/orgs/${club.id}/teams/${u12.id}`, { name: "U13", leaderboard: true }, owner)).body).toMatchObject({
      name: "U13",
      leaderboard: true,
    });
    expect((await env.call("DELETE", `/v1/orgs/${club.id}/teams/${u12.id}`, undefined, owner)).status).toBe(200);
    expect((await env.call("GET", `/v1/orgs/${club.id}`, undefined, coach)).body.teamIds).toEqual([]);
    const list = (await env.call("GET", `/v1/orgs/${club.id}/athletes`, undefined, owner)).body.athletes;
    expect(list.find((x: { id: string }) => x.id === a.id).teamIds).toEqual([]);
  });

  it("rejects teams of another club", async () => {
    const otherClub = (await env.call("POST", "/v1/orgs", { name: "Other" }, owner)).body;
    const foreign = (await env.call("POST", `/v1/orgs/${otherClub.id}/teams`, { name: "T" }, owner)).body;
    expect((await env.call("POST", `/v1/orgs/${club.id}/athletes`, { consent: true, name: "X", teamIds: [foreign.id] }, owner)).status).toBe(400);
  });
});

describe("audit log", () => {
  it("records writes, newest first, paged; admins only", async () => {
    await env.call("POST", `/v1/orgs/${club.id}/teams`, { name: "A" }, owner);
    await env.call("POST", `/v1/orgs/${club.id}/teams`, { name: "B" }, owner);
    await env.call("POST", `/v1/orgs/${club.id}/athletes`, { consent: true, name: "Mia" }, owner);
    const first = (await env.call("GET", `/v1/orgs/${club.id}/audit?limit=2`, undefined, owner)).body;
    expect(first.entries.map((e: { action: string }) => e.action)).toEqual(["athlete.created", "team.created"]);
    expect(first.entries[0]).toMatchObject({ via: "rest", actorKind: "user" });
    expect(JSON.stringify(first)).not.toContain("Mia");
    const second = (await env.call("GET", `/v1/orgs/${club.id}/audit?limit=2&cursor=${first.nextCursor}`, undefined, owner)).body;
    expect(second.entries.map((e: { action: string }) => e.action)).toEqual(["team.created", "org.created"]);
    expect(second.nextCursor).toBeNull();

    const coach = await join("coach@example.org", { role: "coach" });
    expect((await env.call("GET", `/v1/orgs/${club.id}/audit`, undefined, coach)).status).toBe(403);
  });
});
