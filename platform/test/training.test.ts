import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pseudonym } from "../src/modules/orgs/useCases";
import { invites } from "../src/modules/orgs/schema";
import { trainingReports, trainingSessions, trainingValues } from "../src/modules/training/schema";
import { testEnv, type TestEnv } from "./helpers";

let env: TestEnv;
let owner: string;
let club: { id: string };
let u12: { id: string };
let u14: { id: string };
let mia: { id: string };
let cem: { id: string };

beforeEach(async () => {
  env = await testEnv();
  owner = await env.signIn("owner@example.org");
  club = (await env.call("POST", "/v1/orgs", { name: "TV Muster" }, owner)).body;
  u12 = (await env.call("POST", `/v1/orgs/${club.id}/teams`, { name: "U12", leaderboard: true }, owner)).body;
  u14 = (await env.call("POST", `/v1/orgs/${club.id}/teams`, { name: "U14" }, owner)).body;
  mia = (await env.call("POST", `/v1/orgs/${club.id}/athletes`, { consent: true, name: "Mia", teamIds: [u12.id] }, owner)).body;
  cem = (await env.call("POST", `/v1/orgs/${club.id}/athletes`, { consent: true, name: "Cem", teamIds: [u14.id] }, owner)).body;
});
afterEach(() => env.close());

async function joinClub(email: string, body: Record<string, unknown>) {
  const invite = await env.call("POST", `/v1/orgs/${club.id}/invites`, body, owner);
  if (invite.status !== 201) throw new Error(`invite ${invite.status} ${JSON.stringify(invite.body)}`);
  const token = await env.signIn(email);
  const res = await env.call("POST", "/v1/invites/accept", { code: invite.body.code }, token);
  if (res.status !== 200) throw new Error(`accept ${res.status} ${JSON.stringify(res.body)}`);
  return token;
}

/** A report as the app stores it from the firmware's `report` event (#41). */
function report(ms: number[], extra: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    podReportId: 1,
    cycle: 1,
    startMs: 120_400,
    endMs: 165_210,
    recordedAt: "2026-10-19T12:01:00Z",
    values: ms.map((x, i) => ({ t: 121_000 + i * 1000, metric: "reaction", pod: 1, ms: x })),
    stats: { reaction: { count: ms.length, average: 0, best: Math.min(...ms), worst: Math.max(...ms) } },
    vars: { MAX_LOOPS: 12 },
    ...extra,
  };
}

function session(athleteId: string, reports: unknown[], extra: Record<string, unknown> = {}) {
  return { id: randomUUID(), athleteId, setId: "1A2B3C4D", programPath: "/prog/dreieck.json", startedAt: "2026-10-19T12:00:00Z", reports, ...extra };
}

const upload = (sessions: unknown[], token = owner) => env.call("POST", `/v1/orgs/${club.id}/training/upload`, { sessions }, token);

describe("upload", () => {
  it("stores sessions and reports once; a retry changes nothing, a reused pod id with a new UUID is new", async () => {
    const r1 = report([300, 320]);
    const s = session(mia.id, [r1]);
    const first = await upload([s]);
    expect(first.status).toBe(200);
    expect(first.body.sessions).toEqual([{ clientId: s.id, id: expect.any(String), created: true }]);
    expect(first.body.reports).toEqual([{ clientId: r1.id, id: expect.any(String), status: "created" }]);

    const again = await upload([s]);
    expect(again.body.sessions[0]).toMatchObject({ id: first.body.sessions[0].id, created: false });
    expect(again.body.reports[0]).toMatchObject({ id: first.body.reports[0].id, status: "unchanged" });

    // after a reboot the pod starts its report ids again: same podReportId, new app UUID
    const r2 = report([280], { podReportId: 1, cycle: 2, recordedAt: "2026-10-19T12:02:00Z" });
    const third = await upload([{ ...s, reports: [r1, r2] }]);
    expect(third.body.reports.map((r: { status: string }) => r.status)).toEqual(["unchanged", "created"]);

    const got = await env.call("GET", `/v1/orgs/${club.id}/training/sessions/${first.body.sessions[0].id}`, undefined, owner);
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ clientId: s.id, setId: "1a2b3c4d", programPath: "/prog/dreieck.json", reports: 2, discardedReports: 0 });
    expect(got.body.reportList.map((r: { values: unknown[] }) => r.values.length)).toEqual([2, 1]);
    expect(got.body.reportList[0]).toMatchObject({ podReportId: 1, cycle: 1, startMs: 120_400, vars: { MAX_LOOPS: 12 } });
    expect(got.body.reportList[0].values[0]).toEqual({ t: 121_000, metric: "reaction", pod: 1, ms: 300 });
  });

  it("re-uploading may only change discarded; ids cannot move to another athlete or session", async () => {
    const r = report([300]);
    const s = session(mia.id, [r]);
    await upload([s]);
    const flagged = await upload([{ ...s, reports: [{ ...r, discarded: true }] }]);
    expect(flagged.body.reports[0].status).toBe("updated");
    expect((await upload([{ ...s, athleteId: cem.id }])).status).toBe(409);
    expect((await upload([session(mia.id, [r])])).status).toBe(409);
    expect((await upload([s, s])).status).toBe(400);
  });

  it("checks revision and preset ids", async () => {
    expect((await upload([session(mia.id, [], { revisionId: randomUUID() })])).status).toBe(400);
    expect((await upload([session(mia.id, [], { presetId: randomUUID() })])).status).toBe(400);
  });

  it("coaches upload for their teams, athletes for their own profile, viewers not at all", async () => {
    const coach = await joinClub("coach@example.org", { role: "coach", teamIds: [u12.id] });
    expect((await upload([session(mia.id, [report([300])])], coach)).status).toBe(200);
    expect((await upload([session(cem.id, [report([300])])], coach)).status).toBe(404);

    const athlete = await joinClub("mia@example.org", { role: "athlete", athleteId: mia.id });
    expect((await upload([session(mia.id, [report([310])])], athlete)).status).toBe(200);
    expect((await upload([session(cem.id, [report([310])])], athlete)).status).toBe(404);

    const viewer = await joinClub("parent@example.org", { role: "viewer" });
    expect((await upload([session(mia.id, [])], viewer)).status).toBe(403);

    const stranger = await env.signIn("stranger@example.org");
    expect((await upload([session(mia.id, [])], stranger)).status).toBe(404);
  });
});

describe("reading", () => {
  it("lists sessions newest first with paging; coaches see their teams, athletes their own", async () => {
    for (let i = 0; i < 3; i++) {
      await upload([session(mia.id, [report([300 + i])], { startedAt: `2026-10-1${i}T10:00:00Z` })]);
    }
    await upload([session(cem.id, [report([400])])]);

    const page1 = await env.call("GET", `/v1/orgs/${club.id}/training/sessions?athleteId=${mia.id}&limit=2`, undefined, owner);
    expect(page1.body.sessions.map((s: { startedAt: string }) => s.startedAt.slice(0, 10))).toEqual(["2026-10-12", "2026-10-11"]);
    const page2 = await env.call("GET", `/v1/orgs/${club.id}/training/sessions?athleteId=${mia.id}&limit=2&cursor=${page1.body.nextCursor}`, undefined, owner);
    expect(page2.body.sessions.map((s: { startedAt: string }) => s.startedAt.slice(0, 10))).toEqual(["2026-10-10"]);
    expect(page2.body.nextCursor).toBeNull();

    const byTeam = await env.call("GET", `/v1/orgs/${club.id}/training/sessions?teamId=${u14.id}`, undefined, owner);
    expect(byTeam.body.sessions.map((s: { athlete: { name: string } }) => s.athlete.name)).toEqual(["Cem"]);

    const coach = await joinClub("coach@example.org", { role: "coach", teamIds: [u14.id] });
    const seen = await env.call("GET", `/v1/orgs/${club.id}/training/sessions`, undefined, coach);
    expect(seen.body.sessions.map((s: { athlete: { name: string } }) => s.athlete.name)).toEqual(["Cem"]);
    const miaSession = page1.body.sessions[0].id;
    expect((await env.call("GET", `/v1/orgs/${club.id}/training/sessions/${miaSession}`, undefined, coach)).status).toBe(404);

    const athlete = await joinClub("mia@example.org", { role: "athlete", athleteId: mia.id });
    const own = await env.call("GET", `/v1/orgs/${club.id}/training/sessions`, undefined, athlete);
    expect(own.body.sessions).toHaveLength(3);

    const viewer = await joinClub("parent@example.org", { role: "viewer" });
    expect((await env.call("GET", `/v1/orgs/${club.id}/training/sessions`, undefined, viewer)).status).toBe(403);
  });

  it("statistics count values of counted reports only, per metric and week", async () => {
    await upload([
      session(mia.id, [
        report([300, 340], { recordedAt: "2026-10-13T10:00:00Z" }),
        report([200], { recordedAt: "2026-10-14T10:00:00Z", discarded: true }),
        report([280, 320], { recordedAt: "2026-10-20T10:00:00Z" }),
      ]),
      session(mia.id, [report([500], { recordedAt: "2026-10-20T11:00:00Z" })], { programPath: "/prog/other.json" }),
    ]);
    const stats = await env.call("GET", `/v1/orgs/${club.id}/athletes/${mia.id}/stats?programPath=/prog/dreieck.json`, undefined, owner);
    expect(stats.status).toBe(200);
    expect(stats.body).toMatchObject({ athlete: { id: mia.id, name: "Mia" }, sessions: 1, reports: 2 });
    expect(stats.body.metrics).toEqual([
      {
        metric: "reaction",
        count: 4,
        best: 280,
        average: 310,
        worst: 340,
        weeks: [
          { week: "2026-10-12", count: 2, best: 300, average: 320 },
          { week: "2026-10-19", count: 2, best: 280, average: 300 },
        ],
      },
    ]);
    const all = await env.call("GET", `/v1/orgs/${club.id}/athletes/${mia.id}/stats?from=2026-10-20T00:00:00Z`, undefined, owner);
    expect(all.body.metrics[0]).toMatchObject({ count: 3, worst: 500 });
  });

  it("leaderboards only for teams that switched them on, best first", async () => {
    const ben = (await env.call("POST", `/v1/orgs/${club.id}/athletes`, { consent: true, name: "Ben", teamIds: [u12.id] }, owner)).body;
    await upload([session(mia.id, [report([300, 290])]), session(ben.id, [report([250])]), session(cem.id, [report([100])])]);
    const board = await env.call("GET", `/v1/orgs/${club.id}/teams/${u12.id}/leaderboard?metric=reaction`, undefined, owner);
    expect(board.status).toBe(200);
    expect(board.body.entries).toEqual([
      { rank: 1, athlete: { id: ben.id, name: "Ben" }, best: 250, count: 1 },
      { rank: 2, athlete: { id: mia.id, name: "Mia" }, best: 290, count: 2 },
    ]);
    expect((await env.call("GET", `/v1/orgs/${club.id}/teams/${u14.id}/leaderboard?metric=reaction`, undefined, owner)).status).toBe(403);
    const athlete = await joinClub("mia@example.org", { role: "athlete", athleteId: mia.id });
    expect((await env.call("GET", `/v1/orgs/${club.id}/teams/${u12.id}/leaderboard?metric=reaction`, undefined, athlete)).status).toBe(200);
  });

  it("AI clients read results with pseudonyms and cannot upload", async () => {
    await upload([session(mia.id, [report([300])])]);
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      fetch: async (url, init) => env.app.request(String(url), init as RequestInit),
      requestInit: { headers: { Authorization: `Bearer ${owner}` } },
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["list_training_sessions", "get_athlete_stats", "get_team_leaderboard"]));
      expect(tools.map((t) => t.name)).not.toContain("upload_training");
      const stats = await client.callTool({ name: "get_athlete_stats", arguments: { orgId: club.id, athleteId: mia.id } });
      expect(stats.structuredContent).toMatchObject({ athlete: { name: pseudonym(mia.id) } });
      const list = await client.callTool({ name: "list_training_sessions", arguments: { orgId: club.id } });
      expect(JSON.stringify(list)).not.toContain("Mia");
    } finally {
      await client.close();
    }
  });
});

describe("corrections and deletion", () => {
  it("coaches discard or delete reports and sessions; athletes cannot", async () => {
    const res = await upload([session(mia.id, [report([300]), report([400])])]);
    const [r1, r2] = res.body.reports.map((r: { id: string }) => r.id);
    const sessionId = res.body.sessions[0].id;
    const athlete = await joinClub("mia@example.org", { role: "athlete", athleteId: mia.id });
    expect((await env.call("PATCH", `/v1/orgs/${club.id}/training/reports/${r1}`, { discarded: true }, athlete)).status).toBe(403);
    expect((await env.call("PATCH", `/v1/orgs/${club.id}/training/reports/${r1}`, { discarded: true }, owner)).status).toBe(200);
    expect((await env.call("DELETE", `/v1/orgs/${club.id}/training/reports/${r2}`, undefined, owner)).status).toBe(200);
    const got = await env.call("GET", `/v1/orgs/${club.id}/training/sessions/${sessionId}`, undefined, owner);
    expect(got.body).toMatchObject({ reports: 1, discardedReports: 1 });
    expect((await env.call("DELETE", `/v1/orgs/${club.id}/training/sessions/${sessionId}`, undefined, athlete)).status).toBe(403);
    expect((await env.call("DELETE", `/v1/orgs/${club.id}/training/sessions/${sessionId}`, undefined, owner)).status).toBe(200);
    expect((await env.call("GET", `/v1/orgs/${club.id}/training/sessions/${sessionId}`, undefined, owner)).status).toBe(404);
    const actions = (await env.call("GET", `/v1/orgs/${club.id}/audit`, undefined, owner)).body.entries.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["training.uploaded", "training.report_updated", "training.report_deleted", "training.session_deleted"]));
  });

  it("deleting an athlete deletes their results; the export contains a claimed profile's results", async () => {
    const athlete = await joinClub("mia@example.org", { role: "athlete", athleteId: mia.id });
    await upload([session(mia.id, [report([300])])]);
    const exported = await env.call("GET", "/v1/me/export", undefined, athlete);
    expect(exported.body.results).toHaveLength(1);
    expect(exported.body.results[0]).toMatchObject({ athleteId: mia.id, reports: [expect.objectContaining({ values: [expect.objectContaining({ ms: 300 })] })] });

    expect((await env.call("DELETE", `/v1/orgs/${club.id}/athletes/${mia.id}`, undefined, owner)).status).toBe(200);
    const rows = async (table: typeof trainingSessions | typeof trainingReports | typeof trainingValues) =>
      (await env.db.db.select({ n: sql<number>`count(*)::int` }).from(table))[0]!.n;
    expect([await rows(trainingSessions), await rows(trainingReports), await rows(trainingValues)]).toEqual([0, 0, 0]);
  });

  it("adding an athlete requires and records consent", async () => {
    expect((await env.call("POST", `/v1/orgs/${club.id}/athletes`, { name: "Noa" }, owner)).status).toBe(400);
    expect(mia).toMatchObject({ consentAt: "2026-10-19T12:00:00.000Z" });
  });
});

describe("athlete profile deletion", () => {
  const count = async (table: typeof trainingSessions | typeof trainingReports | typeof trainingValues | typeof invites) =>
    (await env.db.db.select({ n: sql<number>`count(*)::int` }).from(table))[0]!.n;

  it("an athlete deletes their own claimed profile: results, invitations and listings go with it", async () => {
    const pending = (await env.call("POST", `/v1/orgs/${club.id}/athletes`, { consent: true, name: "Noa" }, owner)).body;
    await env.call("POST", `/v1/orgs/${club.id}/invites`, { role: "athlete", athleteId: pending.id }, owner);
    const athlete = await joinClub("mia@example.org", { role: "athlete", athleteId: mia.id });
    await upload([session(mia.id, [report([300, 310])]), session(cem.id, [report([400])])]);
    expect(await count(invites)).toBe(2);

    expect((await env.call("DELETE", `/v1/orgs/${club.id}/me/athletes/${mia.id}`, undefined, athlete)).status).toBe(200);

    expect([await count(trainingSessions), await count(trainingReports), await count(trainingValues)]).toEqual([1, 1, 1]);
    expect(await count(invites)).toBe(1);
    expect((await env.call("GET", "/v1/me", undefined, athlete)).body.athleteProfiles).toEqual([]);
    expect((await env.call("GET", "/v1/me/export", undefined, athlete)).body.results).toEqual([]);
    const names = (await env.call("GET", `/v1/orgs/${club.id}/athletes`, undefined, owner)).body.athletes.map((a: { name: string }) => a.name);
    expect(names).toEqual(["Cem", "Noa"]);
    const sessions = (await env.call("GET", `/v1/orgs/${club.id}/training/sessions`, undefined, owner)).body.sessions;
    expect(sessions.map((s: { athlete: { id: string } }) => s.athlete.id)).toEqual([cem.id]);
    const actions = (await env.call("GET", `/v1/orgs/${club.id}/audit`, undefined, owner)).body.entries.map((e: { action: string }) => e.action);
    expect(actions).toContain("athlete.self_deleted");
  });

  it("only the claiming user may delete a claimed profile: others get 404, also a coach of the club", async () => {
    const athlete = await joinClub("mia@example.org", { role: "athlete", athleteId: mia.id });
    const coach = await joinClub("coach@example.org", { role: "coach", teamIds: [u12.id] });
    await upload([session(mia.id, [report([300])])]);
    const path = `/v1/orgs/${club.id}/me/athletes/${mia.id}`;

    expect((await env.call("DELETE", path, undefined, owner)).status).toBe(404);
    expect((await env.call("DELETE", path, undefined, coach)).status).toBe(404);
    const stranger = await env.signIn("stranger@example.org");
    expect((await env.call("DELETE", path, undefined, stranger)).status).toBe(404);
    const otherClub = (await env.call("POST", "/v1/orgs", { name: "Anderer Verein" }, stranger)).body;
    expect((await env.call("DELETE", `/v1/orgs/${otherClub.id}/me/athletes/${mia.id}`, undefined, stranger)).status).toBe(404);
    expect(await count(trainingSessions)).toBe(1);
    expect((await env.call("GET", "/v1/me", undefined, athlete)).body.athleteProfiles).toHaveLength(1);
    expect((await env.call("DELETE", `/v1/orgs/${club.id}/athletes/${mia.id}`, undefined, coach)).status).toBe(200);
  });

  it("a coach's deletion also removes the invitations of the athlete", async () => {
    const pending = (await env.call("POST", `/v1/orgs/${club.id}/athletes`, { consent: true, name: "Noa" }, owner)).body;
    await env.call("POST", `/v1/orgs/${club.id}/invites`, { role: "athlete", athleteId: pending.id }, owner);
    expect(await count(invites)).toBe(1);
    expect((await env.call("DELETE", `/v1/orgs/${club.id}/athletes/${pending.id}`, undefined, owner)).status).toBe(200);
    expect(await count(invites)).toBe(0);
  });
});
