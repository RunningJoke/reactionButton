import { beforeEach, describe, expect, it } from "vitest";
import type { PodReport } from "../results/report";
import { MemoryResultStorage } from "../results/resultStore";
import { useResults } from "../results/results";
import { PlatformClient, PlatformError, UPLOAD_LIMITS, type SessionIn } from "./api";
import { planUpload, runUpload } from "./upload";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** A fake platform: records calls, answers with the given responses in order (then the last again). */
function fakeFetch(responses: (Response | Error | ((c: Call) => Response))[]) {
  const calls: Call[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const next = responses.length > 1 ? responses.shift()! : responses[0]!;
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(call) : next.clone();
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const problem = (status: number, code: string) => json({ type: `x/${code}`, title: code, status, detail: `${code} detail` }, status);

/** Answers an upload like the platform: every session and report created. */
const uploadOk = (c: Call) => {
  const body = c.body as { sessions: SessionIn[] };
  return json({
    sessions: body.sessions.map((s) => ({ clientId: s.id, id: `remote-${s.id}`, created: true })),
    reports: body.sessions.flatMap((s) => s.reports.map((r) => ({ clientId: r.id, id: `remote-${r.id}`, status: "created" }))),
  });
};

function report(id: number, values = 2): PodReport {
  return {
    event: "report",
    id,
    program: "/prog/solo.json",
    setId: "5f3a91c2",
    cycle: id,
    startMs: id * 1000,
    endMs: id * 1000 + 500,
    values: Array.from({ length: values }, (_, i) => ({ t: id * 1000 + i, metric: "reaction", pod: 1, ms: 300 + i })),
    stats: {},
    vars: { MAX_LOOPS: 12 },
  };
}

const ORG = "0199f0c4-0000-7000-8000-000000000001";
const ATHLETE = "0199f0c4-0000-7000-8000-0000000000a1";
const noSleep = async () => undefined;

async function linkedAthleteWithReports(n: number, values = 2) {
  const mia = await useResults.getState().addAthlete("Mia");
  await useResults.getState().updateAthlete(mia.id, { platformId: ATHLETE, platformOrgId: ORG });
  await useResults.getState().assign("5f3a91c2", mia.id);
  for (let i = 1; i <= n; i++) await useResults.getState().receiveReport(report(i, values));
  return mia;
}

beforeEach(() => {
  useResults.setState({ loaded: true, athletes: [], sessions: [], reports: [], sets: {}, platformDeletes: [], storage: new MemoryResultStorage(true), durable: true });
});

describe("platform client", () => {
  it("sends the bearer token and JSON, turns problem+json into PlatformError", async () => {
    const { fetch, calls } = fakeFetch([json({ athletes: [] }), problem(404, "not_found")]);
    const client = new PlatformClient({ baseUrl: "https://api.example.org/", token: "tok", fetch });
    await client.listAthletes(ORG);
    expect(calls[0]).toMatchObject({ url: `https://api.example.org/v1/orgs/${ORG}/athletes`, method: "GET" });
    expect(calls[0]!.headers.Authorization).toBe("Bearer tok");
    const error = await client.createAthlete(ORG, { name: "Mia", consent: true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlatformError);
    expect(error).toMatchObject({ status: 404, code: "not_found", retryable: false });
    expect(calls[1]!.body).toEqual({ name: "Mia", consent: true });
  });

  it("reports no answer as a retryable network error", async () => {
    const { fetch } = fakeFetch([new TypeError("Failed to fetch")]);
    const error = await new PlatformClient({ baseUrl: "https://x", fetch }).meta().catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 0, code: "network", retryable: true });
  });
});

describe("upload plan", () => {
  it("sends only linked athletes' sessions and splits long sessions within the limits", async () => {
    await linkedAthleteWithReports(UPLOAD_LIMITS.reportsPerSession + 5);
    await useResults.getState().assign("5f3a91c2", null);
    await useResults.getState().receiveReport(report(999)); // nobody assigned
    const s = useResults.getState();
    const { batches, skipped } = planUpload(s.sessions, s.reports, s.athletes, ORG);
    expect(batches.map((b) => b.sessions.map((x) => x.reports.length))).toEqual([[200], [5]]);
    expect(batches[0]!.sessions[0]).toMatchObject({ athleteId: ATHLETE, setId: "5f3a91c2", programPath: "/prog/solo.json" });
    expect(batches[0]!.sessions[0]!.reports[0]).toMatchObject({ podReportId: 1, cycle: 1, discarded: false, vars: { MAX_LOOPS: 12 } });
    expect(skipped).toEqual([{ sessionId: s.sessions[1]!.id, reason: "noAthlete" }]);
  });

  it("keeps each request under the value limit", async () => {
    await linkedAthleteWithReports(12, 2000);
    const s = useResults.getState();
    const { batches } = planUpload(s.sessions, s.reports, s.athletes, ORG);
    expect(batches.map((b) => b.sessions[0]!.reports.length)).toEqual([10, 2]);
  });
});

describe("upload queue", () => {
  it("uploads, then sends only what changed; a retry after a failure uses the same ids", async () => {
    await linkedAthleteWithReports(2);
    const { fetch, calls } = fakeFetch([problem(503, "unavailable"), new TypeError("offline"), uploadOk]);
    const client = new PlatformClient({ baseUrl: "https://api.example.org", token: "tok", fetch });

    const first = await runUpload({ client, orgId: ORG, sleep: noSleep });
    expect(first).toMatchObject({ sessions: 1, reports: 2, failed: 0 });
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.body)).toEqual([calls[0]!.body, calls[0]!.body, calls[0]!.body]);
    expect(calls.every((c) => !("Idempotency-Key" in c.headers))).toBe(true); // idempotent by the body ids (P22)
    expect(calls[0]!.url).toBe(`https://api.example.org/v1/orgs/${ORG}/training/upload`);
    const session = useResults.getState().sessions[0]!;
    expect(session.upload.remoteId).toBe(`remote-${session.id}`);

    expect(await runUpload({ client, orgId: ORG, sleep: noSleep })).toMatchObject({ sessions: 0, reports: 0 });
    expect(calls).toHaveLength(3); // nothing pending, nothing sent

    const [, second] = useResults.getState().reports;
    await useResults.getState().setDiscarded(second!.id, true);
    await runUpload({ client, orgId: ORG, sleep: noSleep });
    const sent = (calls[3]!.body as { sessions: SessionIn[] }).sessions;
    expect(sent.map((s) => s.id)).toEqual([session.id]);
    expect(sent[0]!.reports.map((r) => [r.id, r.discarded])).toEqual([[second!.id, true]]);
  });

  it("marks the sessions failed on a rejected upload and stops when signed out", async () => {
    await linkedAthleteWithReports(1);
    const conflict = fakeFetch([problem(409, "conflict")]);
    const failed = await runUpload({ client: new PlatformClient({ baseUrl: "https://x", fetch: conflict.fetch }), orgId: ORG, sleep: noSleep });
    expect(failed).toMatchObject({ failed: 1, error: "conflict", unauthorized: false });
    expect(conflict.calls).toHaveLength(1); // not worth a retry
    expect(useResults.getState().sessions[0]!.upload.error).toBe("conflict");

    const signedOut = fakeFetch([problem(401, "unauthorized")]);
    expect(await runUpload({ client: new PlatformClient({ baseUrl: "https://x", fetch: signedOut.fetch }), orgId: ORG, sleep: noSleep })).toMatchObject({ unauthorized: true });
  });
});

describe("platform deletions", () => {
  const queued = () => [
    { id: "d1", kind: "athlete" as const, orgId: ORG, platformId: ATHLETE },
    { id: "d2", kind: "session" as const, orgId: ORG, platformId: "remote-s" },
    { id: "d3", kind: "session" as const, orgId: ORG, platformId: "remote-t" },
  ];

  it("repeats queued deletions; gone (404) counts as done, an unreachable platform keeps the queue", async () => {
    useResults.setState({ platformDeletes: queued() });
    const { fetch, calls } = fakeFetch([json({ ok: true }), problem(404, "not_found"), new TypeError("offline")]);
    const client = new PlatformClient({ baseUrl: "https://api.example.org", token: "tok", fetch });

    const summary = await runUpload({ client, orgId: ORG, sleep: noSleep });
    expect(summary).toMatchObject({ deleted: 2, deleteFailed: 0, unauthorized: false });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["DELETE", `https://api.example.org/v1/orgs/${ORG}/athletes/${ATHLETE}`],
      ["DELETE", `https://api.example.org/v1/orgs/${ORG}/training/sessions/remote-s`],
      ["DELETE", `https://api.example.org/v1/orgs/${ORG}/training/sessions/remote-t`],
    ]);
    expect(useResults.getState().platformDeletes.map((d) => d.id)).toEqual(["d3"]);
  });

  it("drops a deletion the platform refuses for good (not a coach any more) and reports it", async () => {
    useResults.setState({ platformDeletes: queued().slice(1, 2) });
    const { fetch } = fakeFetch([problem(403, "forbidden")]);
    const summary = await runUpload({ client: new PlatformClient({ baseUrl: "https://x", fetch }), orgId: ORG, sleep: noSleep });
    expect(summary).toMatchObject({ deleted: 0, deleteFailed: 1, error: "forbidden" });
    expect(useResults.getState().platformDeletes).toEqual([]);
  });

  it("keeps the queue and stops when signed out", async () => {
    useResults.setState({ platformDeletes: queued() });
    const { fetch, calls } = fakeFetch([problem(401, "unauthorized")]);
    const summary = await runUpload({ client: new PlatformClient({ baseUrl: "https://x", fetch }), orgId: ORG, sleep: noSleep });
    expect(summary).toMatchObject({ unauthorized: true, deleted: 0 });
    expect(calls).toHaveLength(1);
    expect(useResults.getState().platformDeletes).toHaveLength(3);
  });
});
