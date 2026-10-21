import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { program, testEnv, type TestEnv } from "./helpers";

const DUO = readFileSync(join(import.meta.dirname, "../../firmware/data/prog/duo.json"), "utf8"); // includes /prog/lib/loop.json
const TEXT = JSON.stringify(program, null, 2);
const BROKEN = JSON.stringify({ ...program, blocks: [{ name: "Blink", type: "led", color: "red", next: "Missing" }] });

let env: TestEnv;
let alice: string; // owner of the club
let club: { id: string };
let personal: string; // alice's personal space

beforeEach(async () => {
  env = await testEnv();
  alice = await env.signIn("alice@example.org");
  club = (await env.call("POST", "/v1/orgs", { name: "TV Muster" }, alice)).body;
  personal = (await env.call("GET", "/v1/orgs", undefined, alice)).body.orgs.find((o: { kind: string }) => o.kind === "personal").id;
});
afterEach(() => env.close());

async function joinClub(email: string, role: string, teamIds: string[] = []) {
  const invite = (await env.call("POST", `/v1/orgs/${club.id}/invites`, { role, teamIds }, alice)).body;
  const token = await env.signIn(email);
  await env.call("POST", "/v1/invites/accept", { code: invite.code }, token);
  return token;
}

async function create(body: Record<string, unknown> = {}, token = alice) {
  const res = await env.call("POST", "/v1/programs", { orgId: club.id, path: "/prog/test.json", text: TEXT, ...body }, token);
  if (res.status !== 201) throw new Error(`create ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function publish(programId: string, n = 1, token = alice) {
  const res = await env.call("POST", `/v1/programs/${programId}/revisions/${n}/publish`, {}, token);
  if (res.status !== 200) throw new Error(`publish ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.program;
}

const titles = (res: { body: { programs: { title: string }[] } }) => res.body.programs.map((p) => p.title).sort();

describe("programs", () => {
  it("saves a draft, publishes it, and keeps revisions immutable", async () => {
    const created = await create({ title: "Blink", tags: ["Warmup", "warmup"], description: "Red light" });
    expect(created.program).toMatchObject({ title: "Blink", tags: ["warmup"], latestRevision: 1, publishedRevision: null, canEdit: true, pods: 1 });
    expect(created.revision).toMatchObject({ n: 1, status: "draft", errors: 0, via: "rest" });

    const p = await publish(created.program.id);
    expect(p.publishedRevision).toBe(1);

    const changed = JSON.stringify({ ...program, name: "Blink 2" });
    const saved = await env.call("POST", `/v1/programs/${p.id}/revisions`, { path: "/prog/test.json", text: changed, note: "renamed" }, alice);
    expect(saved.body.revision).toMatchObject({ n: 2, status: "draft", note: "renamed" });
    const got = (await env.call("GET", `/v1/programs/${p.id}`, undefined, alice)).body;
    expect(got.revision.n).toBe(1); // the published one
    expect(got.revision.text).toBe(TEXT);
    expect((await env.call("GET", `/v1/programs/${p.id}?revision=2`, undefined, alice)).body.revision.json.name).toBe("Blink 2");
    expect((await env.call("GET", `/v1/programs/${p.id}/revisions`, undefined, alice)).body.revisions.map((r: { n: number }) => r.n)).toEqual([2, 1]);
  });

  it("stores the program format a revision needs", async () => {
    const created = await create();
    const timed = JSON.stringify({ ...program, blocks: [{ name: "Lap", type: "delay", ms: 100, timerStart: "lap", timerStop: "lap", next: "Lap" }] });
    const saved = await env.call("POST", `/v1/programs/${created.program.id}/revisions`, { path: "/prog/test.json", text: timed }, alice);
    expect(saved.status).toBe(201);
    const format = async (n: number) => (await env.call("GET", `/v1/programs/${created.program.id}?revision=${n}`, undefined, alice)).body.revision.programFormat;
    expect(await format(1)).toBe(1);
    expect(await format(2)).toBe(2);
  });

  it("saves invalid drafts with their issues but does not publish them", async () => {
    const created = await create({ text: BROKEN });
    expect(created.revision.errors).toBe(1);
    expect(created.issues.map((i: { code: string }) => i.code)).toContain("portUnknownTarget");
    const res = await env.call("POST", `/v1/programs/${created.program.id}/revisions/1/publish`, {}, alice);
    expect(res.status).toBe(409);
  });

  it("accepts includes of the shipped library only", async () => {
    const duo = await create({ path: "/prog/duo.json", text: DUO });
    expect(duo.program).toMatchObject({ title: "Duo", pods: 2 });
    expect(duo.revision.errors).toBe(0);
    const own = JSON.stringify({ ...program, include: ["/prog/lib/mine.json"] });
    const res = await env.call("POST", "/v1/programs", { orgId: club.id, path: "/prog/x.json", text: own }, alice);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ title: "include_not_shipped", includes: ["/prog/lib/mine.json"] });
    expect((await env.call("POST", "/v1/programs", { orgId: club.id, path: "/prog/lib/x.json", text: TEXT }, alice)).status).toBe(400);
    expect((await env.call("POST", "/v1/programs", { orgId: club.id, path: "/prog/x.json", text: "[1]" }, alice)).status).toBe(400);
  });

  it("shows programs by visibility: public to everyone, club to members, private to the author", async () => {
    const pub = await create({ title: "Public", visibility: "public" });
    await publish(pub.program.id);
    const draftPub = await create({ title: "PublicDraft", visibility: "public" });
    const org = await create({ title: "Club" , visibility: "org" });
    await publish(org.program.id);
    const orgDraft = await create({ title: "ClubDraft", visibility: "org" });
    await create({ title: "Mine", visibility: "private" });

    expect(titles(await env.call("GET", "/v1/programs"))).toEqual(["Public"]);
    const stranger = await env.signIn("stranger@example.org");
    expect(titles(await env.call("GET", "/v1/programs", undefined, stranger))).toEqual(["Public"]);
    expect((await env.call("GET", `/v1/programs/${org.program.id}`, undefined, stranger)).status).toBe(404);

    const viewer = await joinClub("viewer@example.org", "viewer");
    expect(titles(await env.call("GET", "/v1/programs", undefined, viewer))).toEqual(["Club", "Public"]);
    const coach = await joinClub("coach@example.org", "coach");
    expect(titles(await env.call("GET", "/v1/programs", undefined, coach))).toEqual(["Club", "ClubDraft", "Public", "PublicDraft"]);
    expect(titles(await env.call("GET", "/v1/programs", undefined, alice))).toEqual(["Club", "ClubDraft", "Mine", "Public", "PublicDraft"]);
    expect((await env.call("GET", `/v1/programs/${orgDraft.program.id}`, undefined, viewer)).status).toBe(404);
    expect((await env.call("GET", `/v1/programs/${draftPub.program.id}`)).status).toBe(404);
  });

  it("team visibility reaches only that team's members", async () => {
    const u12 = (await env.call("POST", `/v1/orgs/${club.id}/teams`, { name: "U12" }, alice)).body;
    const u14 = (await env.call("POST", `/v1/orgs/${club.id}/teams`, { name: "U14" }, alice)).body;
    const p = await create({ title: "U12 only", visibility: "team", teamIds: [u12.id] });
    await publish(p.program.id);
    const inTeam = await joinClub("a12@example.org", "athlete", [u12.id]);
    const otherTeam = await joinClub("a14@example.org", "athlete", [u14.id]);
    expect(titles(await env.call("GET", "/v1/programs", undefined, inTeam))).toEqual(["U12 only"]);
    expect(titles(await env.call("GET", "/v1/programs", undefined, otherTeam))).toEqual([]);
    expect((await env.call("POST", "/v1/programs", { orgId: club.id, path: "/prog/t.json", text: TEXT, visibility: "team" }, alice)).status).toBe(400);
  });

  it("only coaches and above write; editors change details and delete", async () => {
    const viewer = await joinClub("viewer@example.org", "viewer");
    expect((await env.call("POST", "/v1/programs", { orgId: club.id, path: "/prog/t.json", text: TEXT }, viewer)).status).toBe(403);
    const p = await create({ visibility: "org" });
    await publish(p.program.id);
    expect((await env.call("PATCH", `/v1/programs/${p.program.id}`, { title: "X" }, viewer)).status).toBe(403);
    const coach = await joinClub("coach@example.org", "coach");
    const patched = await env.call("PATCH", `/v1/programs/${p.program.id}`, { title: "Renamed", visibility: "public", licence: "CC0-1.0" }, coach);
    expect(patched.body).toMatchObject({ title: "Renamed", visibility: "public", licence: "CC0-1.0" });
    expect((await env.call("DELETE", `/v1/programs/${p.program.id}`, undefined, coach)).status).toBe(200);
    expect((await env.call("GET", `/v1/programs/${p.program.id}`, undefined, alice)).status).toBe(404);
    expect(titles(await env.call("GET", "/v1/programs"))).toEqual([]);
  });

  it("searches by text, tags, pods and sorts by rating", async () => {
    const a = await create({ title: "Sprint", tags: ["speed"], visibility: "public" });
    const b = await create({ title: "Duo game", path: "/prog/duo.json", text: DUO, tags: ["team"], visibility: "public", description: "two pods" });
    await publish(a.program.id);
    await publish(b.program.id);
    expect(titles(await env.call("GET", "/v1/programs?q=spr"))).toEqual(["Sprint"]);
    expect(titles(await env.call("GET", "/v1/programs?q=two%20pods"))).toEqual(["Duo game"]);
    expect(titles(await env.call("GET", "/v1/programs?q=100%25"))).toEqual([]);
    expect(titles(await env.call("GET", "/v1/programs?tags=team,other"))).toEqual(["Duo game"]);
    expect(titles(await env.call("GET", "/v1/programs?pods=2"))).toEqual(["Duo game"]);

    const bob = await env.signIn("bob@example.org");
    expect((await env.call("PUT", `/v1/programs/${a.program.id}/rating`, { stars: 5 }, alice)).status).toBe(403); // own
    expect((await env.call("PUT", `/v1/programs/${a.program.id}/rating`, { stars: 2 }, bob)).body).toEqual({ average: 2, count: 1 });
    expect((await env.call("PUT", `/v1/programs/${a.program.id}/rating`, { stars: 3 }, bob)).body).toEqual({ average: 3, count: 1 });
    await env.call("PUT", `/v1/programs/${b.program.id}/rating`, { stars: 5 }, bob);
    const sorted = (await env.call("GET", "/v1/programs?sort=rating")).body.programs.map((p: { title: string }) => p.title);
    expect(sorted).toEqual(["Duo game", "Sprint"]);
    const page = await env.call("GET", "/v1/programs?sort=title&limit=1");
    expect(page.body).toMatchObject({ more: true, programs: [{ title: "Duo game" }] });
  });

  it("forks a readable program into a private draft with attribution", async () => {
    const src = await create({ title: "Original", visibility: "public" });
    await publish(src.program.id);
    const bob = await env.signIn("bob@example.org");
    const bobSpace = (await env.call("GET", "/v1/orgs", undefined, bob)).body.orgs[0].id;
    const fork = await env.call("POST", `/v1/programs/${src.program.id}/fork`, { orgId: bobSpace }, bob);
    expect(fork.status).toBe(201);
    expect(fork.body.program).toMatchObject({
      title: "Original",
      visibility: "private",
      orgId: bobSpace,
      publishedRevision: null,
      forkOf: { programId: src.program.id, revision: 1, title: "Original" },
    });
    expect(fork.body.revision).toMatchObject({ n: 1, status: "draft", note: "copy of Original r1" });
    const priv = await create({ title: "Secret" });
    expect((await env.call("POST", `/v1/programs/${priv.program.id}/fork`, { orgId: bobSpace }, bob)).status).toBe(404);
    expect((await env.call("POST", `/v1/programs/${src.program.id}/fork`, { orgId: club.id }, bob)).status).toBe(404); // not bob's club
  });
});

describe("presets", () => {
  async function duo() {
    const d = await create({ path: "/prog/duo.json", text: DUO, visibility: "org" });
    await publish(d.program.id);
    return d.program.id as string;
  }

  it("overrides declared variables only and renders the program for the pod", async () => {
    const programId = await duo();
    const bad = await env.call("POST", "/v1/presets", { orgId: club.id, programId, name: "X", variables: { NOPE: 1 } }, alice);
    expect(bad.status).toBe(400);
    expect(bad.body.known).toContain("MAX_LOOPS");
    const res = await env.call(
      "POST",
      "/v1/presets",
      { orgId: club.id, programId, name: "Duo kurz", variables: { MAX_LOOPS: 4 }, target: { level: "easy", pods: 2 }, visibility: "org" },
      alice,
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ programId, revision: 1, status: "ready", variables: { MAX_LOOPS: 4 } });
    const rendered = (await env.call("GET", `/v1/presets/${res.body.id}/program`, undefined, alice)).body;
    const json = JSON.parse(rendered.text);
    expect(rendered.path).toBe("/prog/duo.json");
    expect(json).toMatchObject({ name: "Duo kurz", variables: { MAX_LOOPS: 4 }, include: ["/prog/lib/loop.json"] });

    const viewer = await joinClub("viewer@example.org", "viewer");
    expect((await env.call("GET", `/v1/presets?programId=${programId}`, undefined, viewer)).body.presets).toHaveLength(1);
    expect((await env.call("PATCH", `/v1/presets/${res.body.id}`, { name: "Y" }, viewer)).status).toBe(403);
    expect((await env.call("PATCH", `/v1/presets/${res.body.id}`, { variables: { MAX_LOOPS: 6 } }, alice)).body.variables).toEqual({ MAX_LOOPS: 6 });
    expect((await env.call("DELETE", `/v1/presets/${res.body.id}`, undefined, alice)).status).toBe(200);
  });

  it("keep working after their program was deleted", async () => {
    const programId = await duo();
    const preset = (await env.call("POST", "/v1/presets", { orgId: club.id, programId, name: "P", variables: {} }, alice)).body;
    await env.call("DELETE", `/v1/programs/${programId}`, undefined, alice);
    expect((await env.call("GET", `/v1/presets/${preset.id}/program`, undefined, alice)).status).toBe(200);
  });
});

describe("sets", () => {
  it("exports the pod files: menu, programs, presets applied, library parts", async () => {
    const a = await create({ title: "Blink", visibility: "org" });
    await publish(a.program.id);
    const d = await create({ path: "/prog/duo.json", text: DUO, visibility: "org" });
    await publish(d.program.id);
    const preset = (await env.call("POST", "/v1/presets", { orgId: club.id, programId: d.program.id, name: "Duo kurz", variables: { MAX_LOOPS: 4 }, visibility: "org" }, alice)).body;
    const set = await env.call(
      "POST",
      "/v1/sets",
      { orgId: club.id, name: "Halle A", visibility: "org", items: [{ programId: a.program.id }, { programId: d.program.id }, { presetId: preset.id }] },
      alice,
    );
    expect(set.status).toBe(201);
    expect(set.body.items.map((i: { title: string }) => i.title)).toEqual(["Blink", "Duo", "Duo kurz"]);

    const viewer = await joinClub("viewer@example.org", "viewer");
    const out = (await env.call("GET", `/v1/sets/${set.body.id}/files`, undefined, viewer)).body;
    expect(Object.keys(out.files).sort()).toEqual(["/prog/duo.json", "/prog/duo-kurz.json", "/prog/lib/loop.json", "/prog/test.json", "/programs.json"].sort());
    expect(JSON.parse(out.files["/programs.json"])).toEqual({ programs: ["/prog/test.json", "/prog/duo.json", "/prog/duo-kurz.json"] });
    expect(JSON.parse(out.files["/prog/duo-kurz.json"]).variables.MAX_LOOPS).toBe(4);
    expect(out.files["/prog/duo.json"]).toBe(DUO);
    expect(out.skipped).toEqual([]);

    await env.call("PATCH", `/v1/programs/${a.program.id}`, { visibility: "private" }, alice);
    const after = (await env.call("GET", `/v1/sets/${set.body.id}/files`, undefined, viewer)).body;
    expect(after.skipped).toEqual([0]);

    const updated = await env.call("PATCH", `/v1/sets/${set.body.id}`, { items: [{ presetId: preset.id }], name: "Halle B" }, alice);
    expect(updated.body).toMatchObject({ name: "Halle B", items: [{ position: 0, presetId: preset.id }] });
    expect((await env.call("DELETE", `/v1/presets/${preset.id}`, undefined, alice)).status).toBe(409); // used by the set
    expect((await env.call("GET", "/v1/sets", undefined, viewer)).body.sets).toHaveLength(1);
    expect((await env.call("DELETE", `/v1/sets/${set.body.id}`, undefined, alice)).status).toBe(200);
  });

  it("rejects entries the author cannot read", async () => {
    const bob = await env.signIn("bob@example.org");
    const secret = await create({ title: "Secret" });
    const bobSpace = (await env.call("GET", "/v1/orgs", undefined, bob)).body.orgs[0].id;
    const res = await env.call("POST", "/v1/sets", { orgId: bobSpace, name: "S", items: [{ programId: secret.program.id }] }, bob);
    expect(res.status).toBe(404);
  });
});

describe("reports", () => {
  it("signed-in users report content they can see", async () => {
    const p = await create({ visibility: "public" });
    await publish(p.program.id);
    const bob = await env.signIn("bob@example.org");
    expect((await env.call("POST", "/v1/reports", { resourceType: "program", resourceId: p.program.id, reason: "broken" })).status).toBe(401);
    expect((await env.call("POST", "/v1/reports", { resourceType: "program", resourceId: p.program.id, reason: "broken" }, bob)).status).toBe(201);
  });
});

describe("AI clients (MCP)", () => {
  async function mcp(token: string) {
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      fetch: async (url, init) => env.app.request(String(url), init as RequestInit),
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    return client;
  }

  it("write drafts only: programs stay unpublished, presets and sets wait for a person", async () => {
    const client = await mcp(alice);
    try {
      const tools = (await client.listTools()).tools.map((t) => t.name);
      expect(tools).toEqual(expect.arrayContaining(["create_program", "save_revision", "create_preset", "create_set", "fork_program", "export_set"]));
      expect(tools).not.toContain("publish_revision");
      expect(tools).not.toContain("update_program");

      const pub = await client.callTool({ name: "create_program", arguments: { orgId: personal, path: "/prog/ai.json", text: TEXT, visibility: "public" } });
      expect(pub.isError).toBe(true);
      const made = await client.callTool({ name: "create_program", arguments: { orgId: personal, path: "/prog/ai.json", text: TEXT } });
      const created = made.structuredContent as { program: { id: string }; revision: { via: string; status: string } };
      expect(created.revision).toMatchObject({ via: "mcp", status: "draft" });
      await publish(created.program.id); // a person publishes

      const preset = await client.callTool({ name: "create_preset", arguments: { orgId: club.id, programId: created.program.id, name: "AI", variables: {}, visibility: "org" } });
      const p = preset.structuredContent as { id: string; status: string };
      expect(p.status).toBe("draft");
      const coach = await joinClub("coach@example.org", "coach");
      expect((await env.call("GET", `/v1/presets/${p.id}`, undefined, coach)).status).toBe(404); // drafts: creator only
      expect((await env.call("PATCH", `/v1/presets/${p.id}`, { status: "ready" }, alice)).body.status).toBe("ready");
      expect((await env.call("GET", `/v1/presets/${p.id}`, undefined, coach)).status).toBe(200);

      const audit = (await env.call("GET", `/v1/orgs/${personal}/audit`, undefined, alice)).body.entries;
      expect(audit.find((e: { action: string }) => e.action === "program.created")).toMatchObject({ via: "mcp" });

      const resources = (await client.listResources()).resources.map((r) => r.uri);
      expect(resources).toEqual(expect.arrayContaining(["reactpod://spec/program.schema.json", "reactpod://spec/block-types.json"]));
      const schema = await client.readResource({ uri: "reactpod://spec/program.schema.json" });
      expect(JSON.parse(String((schema.contents[0] as { text: string }).text)).title).toBe("ReactPod program");
    } finally {
      await client.close();
    }
  });
});
