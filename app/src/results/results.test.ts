import { beforeEach, describe, expect, it } from "vitest";
import { PodClient } from "../pod/client";
import { SimulatedPod } from "../pod/simulated/SimulatedPod";
import { SimulatedTransport } from "../pod/simulated/SimulatedTransport";
import { CSV_COLUMNS, csvFilename, csvSeparator, resultsCsv } from "./csv";
import { linkResults } from "./podLink";
import { ReportFeed } from "./podReports";
import { parsePodReport, type PodReport } from "./report";
import { MemoryResultStorage } from "./resultStore";
import { sessionUploadStatus, useResults } from "./results";
import { formatMs, reportDuration, summarizeReports } from "./stats";

function reset(durable = true) {
  const storage = new MemoryResultStorage(durable);
  useResults.setState({ loaded: false, athletes: [], sessions: [], reports: [], sets: {}, platformDeletes: [], storage, durable });
  return storage;
}

/** The report event of issue #41. */
function podReport(extra: Partial<PodReport> = {}): PodReport {
  return {
    event: "report",
    id: 17,
    program: "/prog/dreieck.json",
    setId: "1a2b3c4d",
    cycle: 3,
    startMs: 120400,
    endMs: 165210,
    values: [
      { t: 121003, metric: "reaction", pod: 1, ms: 312 },
      { t: 165100, metric: "lap", pod: 3, ms: 44097 },
    ],
    stats: { reaction: { count: 1, average: 312, best: 312, worst: 312 } },
    vars: { RUNS: 12, MAX_LOOPS: 12 },
    ...extra,
  };
}

const settle = async (ms = 20) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  reset();
});

describe("report model", () => {
  it("reads the #41 report event and leaves out values the platform would reject", () => {
    const parsed = parsePodReport({ ...podReport(), setId: "1A2B3C4D", values: [...podReport().values, { t: -1, metric: "x", pod: 1, ms: 3 }, { t: 1, metric: "", pod: 1, ms: 3 }] });
    expect(parsed).toMatchObject({ id: 17, setId: "1a2b3c4d", cycle: 3, startMs: 120400, endMs: 165210, vars: { MAX_LOOPS: 12 } });
    expect(parsed!.values).toHaveLength(2);
    expect(parsed!.athlete).toBeUndefined();
    expect(parsePodReport({ ...podReport(), athlete: "ath_42" })!.athlete).toBe("ath_42");
  });

  it("rejects what is not a report", () => {
    expect(parsePodReport({ event: "state", id: 1 })).toBeNull();
    expect(parsePodReport({ ...podReport(), program: "prog/x.json" })).toBeNull();
    expect(parsePodReport({ ...podReport(), setId: "not hex" })).toBeNull();
    expect(parsePodReport({ ...podReport(), id: "17" })).toBeNull();
    expect(parsePodReport(null)).toBeNull();
  });
});

describe("results store", () => {
  it("groups reports into sessions per athlete, set and program", async () => {
    const store = useResults.getState();
    const mia = await store.addAthlete(" Mia ");
    const cem = await store.addAthlete("Cem");
    expect(mia.name).toBe("Mia");
    await store.assign("1a2b3c4d", mia.id);

    const a = await store.receiveReport(podReport({ id: 1 }));
    const b = await store.receiveReport(podReport({ id: 2, cycle: 4 }));
    expect(a.durable).toBe(true);
    expect(b.report.sessionId).toBe(a.report.sessionId);

    await useResults.getState().assign("1a2b3c4d", cem.id); // another athlete: new session
    const c = await useResults.getState().receiveReport(podReport({ id: 3 }));
    const d = await useResults.getState().receiveReport(podReport({ id: 4, program: "/prog/solo.json" })); // other program
    const sessions = useResults.getState().sessions;
    expect(sessions.map((s) => [s.athleteId, s.programPath])).toEqual([
      [mia.id, "/prog/dreieck.json"],
      [cem.id, "/prog/dreieck.json"],
      [cem.id, "/prog/solo.json"],
    ]);
    expect(new Set([a, b, c, d].map((x) => x.report.id)).size).toBe(4);
    expect(sessions.every((s) => /^[0-9a-f-]{36}$/.test(s.id))).toBe(true);
  });

  it("uses the athlete the pod names (#42) and keeps unassigned reports", async () => {
    const mia = await useResults.getState().addAthlete("Mia");
    const unassigned = await useResults.getState().receiveReport(podReport({ id: 1 }));
    expect(useResults.getState().sessions.find((s) => s.id === unassigned.report.sessionId)!.athleteId).toBeNull();
    const tagged = await useResults.getState().receiveReport(podReport({ id: 2, athlete: mia.id }));
    expect(useResults.getState().sessions.find((s) => s.id === tagged.report.sessionId)!.athleteId).toBe(mia.id);

    // a pod with `session` support sent no athlete: recorded before anybody was chosen
    await useResults.getState().assign("1a2b3c4d", mia.id);
    const early = await useResults.getState().receiveReport(podReport({ id: 3 }), { podTagsAthlete: true });
    expect(useResults.getState().sessions.find((s) => s.id === early.report.sessionId)!.athleteId).toBeNull();
    const old = await useResults.getState().receiveReport(podReport({ id: 4 }));
    expect(useResults.getState().sessions.find((s) => s.id === old.report.sessionId)!.athleteId).toBe(mia.id);
  });

  it("stores a report received twice only once", async () => {
    const first = await useResults.getState().receiveReport(podReport());
    const again = await useResults.getState().receiveReport(podReport());
    expect(again.duplicate).toBe(true);
    expect(again.report.id).toBe(first.report.id);
    expect(useResults.getState().reports).toHaveLength(1);
    // the pod restarted: same pod id, other content → a new report
    expect((await useResults.getState().receiveReport(podReport({ startMs: 10, endMs: 20 }))).duplicate).toBe(false);
  });

  it("survives a reload, discards after repeat, deletes an athlete with their results", async () => {
    const storage = useResults.getState().storage;
    const mia = await useResults.getState().addAthlete("Mia");
    await useResults.getState().assign("1a2b3c4d", mia.id);
    await useResults.getState().receiveReport(podReport({ id: 1 }));
    const second = await useResults.getState().receiveReport(podReport({ id: 2 }));
    expect((await useResults.getState().discardLast("1a2b3c4d"))!.id).toBe(second.report.id);

    useResults.setState({ loaded: false, athletes: [], sessions: [], reports: [], sets: {} });
    await useResults.getState().load();
    const s = useResults.getState();
    expect(s.athletes.map((a) => a.name)).toEqual(["Mia"]);
    expect(s.reports.map((r) => r.discarded)).toEqual([false, true]);
    expect(s.sets["1a2b3c4d"]!.athleteId).toBe(mia.id);
    expect(summarizeReports(s.reports).find((m) => m.metric === "reaction")!.count).toBe(1);

    await s.deleteAthlete(mia.id);
    expect(useResults.getState().sessions).toEqual([]);
    expect(await storage.listReports()).toEqual([]);
    expect(useResults.getState().sets["1a2b3c4d"]!.athleteId).toBeNull();
  });

  it("derives the upload state of a session", async () => {
    const mia = await useResults.getState().addAthlete("Mia");
    const { report } = await useResults.getState().receiveReport(podReport());
    const status = () => {
      const s = useResults.getState();
      return sessionUploadStatus(s.sessions[0]!, s.athletes, s.reports);
    };
    expect(status()).toBe("noAthlete");
    await useResults.getState().setSessionAthlete(report.sessionId, mia.id);
    expect(status()).toBe("notLinked");
    await useResults.getState().updateAthlete(mia.id, { platformId: crypto.randomUUID(), platformOrgId: "org" });
    expect(status()).toBe("pending");
    await useResults.getState().recordUploadError(report.sessionId, "network");
    expect(status()).toBe("failed");
    await useResults.getState().recordUpload(report.sessionId, crypto.randomUUID(), [{ id: report.id, discarded: false }]);
    expect(status()).toBe("uploaded");
    await useResults.getState().setDiscarded(report.id, true);
    expect(status()).toBe("pending");
  });
});

describe("deletions on the platform", () => {
  it("queues a linked athlete and an uploaded session, and keeps the queue across a restart", async () => {
    const storage = reset();
    const mia = await useResults.getState().addAthlete("Mia");
    await useResults.getState().updateAthlete(mia.id, { platformId: "athlete-1", platformOrgId: "org-1" });
    await useResults.getState().assign("1a2b3c4d", mia.id);
    await useResults.getState().receiveReport(podReport({ id: 1 }));
    const sessionId = useResults.getState().sessions[0]!.id;
    await useResults.getState().recordUpload(sessionId, "remote-session", []);

    await useResults.getState().deleteSession(sessionId);
    expect(useResults.getState().platformDeletes).toEqual([expect.objectContaining({ kind: "session", orgId: "org-1", platformId: "remote-session" })]);
    await useResults.getState().deleteAthlete(mia.id);
    expect(useResults.getState().platformDeletes.map((d) => [d.kind, d.platformId])).toEqual([
      ["session", "remote-session"],
      ["athlete", "athlete-1"],
    ]);

    useResults.setState({ loaded: false, platformDeletes: [] });
    await useResults.getState().load();
    expect(useResults.getState().platformDeletes).toHaveLength(2);
    expect(await storage.getMeta("platformDeletes")).toHaveLength(2);
  });

  it("queues nothing for an athlete or session the platform never had", async () => {
    reset();
    const noa = await useResults.getState().addAthlete("Noa");
    await useResults.getState().deleteAthlete(noa.id);
    expect(useResults.getState().platformDeletes).toEqual([]);
  });
});

describe("reports from a pod", () => {
  async function demoPod(programFormat?: number) {
    const pod = new SimulatedPod({ programFormat, files: { "/programs.json": '{"programs":["/prog/solo.json"]}' } });
    const transport = new SimulatedTransport(pod);
    await transport.connect();
    const client = new PodClient(transport, { timeoutMs: 500 });
    return { pod, client };
  }

  it("stores each report before it acknowledges it, also those sent while nobody listened", async () => {
    const { pod, client } = await demoPod();
    pod.emitSampleReport(); // nobody listens yet: stays in the pod's buffer
    expect(pod.pendingReports).toHaveLength(1);
    const errors: unknown[] = [];
    const feed = new ReportFeed(client, (r) => useResults.getState().receiveReport(r), (e) => errors.push(e));
    await feed.start();
    await settle();
    expect(useResults.getState().reports).toHaveLength(1);
    expect(pod.pendingReports).toHaveLength(0);

    pod.emitSampleReport();
    await settle();
    expect(useResults.getState().reports).toHaveLength(2);
    expect(pod.pendingReports).toHaveLength(0);
    await client.status(); // waits for the acks: they must have got their answer
    expect(errors).toEqual([]);
    feed.stop();
  });

  it("does not acknowledge a report kept in memory only", async () => {
    reset(false);
    const { pod, client } = await demoPod();
    const feed = new ReportFeed(client, (r) => useResults.getState().receiveReport(r));
    await feed.start();
    pod.emitSampleReport();
    await settle();
    expect(useResults.getState().reports).toHaveLength(1);
    expect(pod.pendingReports).toHaveLength(1);
    feed.stop();
  });

  it("tells the pod the assigned athlete and leaves pods without the feature alone", async () => {
    const mia = await useResults.getState().addAthlete("Mia");
    const { pod, client } = await demoPod();
    await useResults.getState().assign(pod.setId, mia.id);
    const info = await client.info();
    const { stop, started } = linkResults(client, info, { programText: () => '{"name":"Solo"}', log: () => undefined });
    await started;
    expect(pod.athlete).toBe(mia.id);
    pod.emitSampleReport();
    await settle();
    const session = useResults.getState().sessions[0]!;
    expect(session).toMatchObject({ athleteId: mia.id, programPath: "/prog/solo.json", setId: pod.setId });
    expect(session.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    stop();

    const old = await demoPod(4);
    const oldInfo = await old.client.info();
    expect(oldInfo.features).not.toContain("reports");
    const sent: string[] = [];
    const send = old.client.transport.send.bind(old.client.transport);
    old.client.transport.send = (line: string) => (sent.push(line), send(line));
    linkResults(old.client, oldInfo, { programText: () => undefined, log: () => undefined });
    await settle();
    expect(sent).toEqual([]);
  });
});

describe("csv", () => {
  it("writes one row per measurement with the athlete and session", async () => {
    const mia = await useResults.getState().addAthlete("Mia; \"M\"");
    await useResults.getState().assign("1a2b3c4d", mia.id);
    await useResults.getState().receiveReport(podReport());
    const s = useResults.getState();
    const csv = resultsCsv(s.sessions, s.reports, s.athletes, { separator: csvSeparator("de-DE") });
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(CSV_COLUMNS.join(";"));
    expect(lines).toHaveLength(3);
    expect(lines[1]!.startsWith('"Mia; ""M""";')).toBe(true);
    expect(lines[1]!.endsWith(";121003;reaction;1;312")).toBe(true);
    expect(csvSeparator("en")).toBe(",");
    expect(csvFilename("Mia Müller", Date.UTC(2026, 9, 19))).toBe("mia-müller-2026-10-19.csv");
  });
});

describe("stats", () => {
  it("formats durations and sums up counted values", () => {
    expect(formatMs(312, "en")).toBe("312 ms");
    expect(formatMs(4100, "en")).toBe("4.10 s");
    expect(formatMs(44097, "de")).toBe("44,1 s");
    expect(formatMs(65200, "en")).toBe("1:05.2 min");
    expect(reportDuration({ startMs: 100, endMs: 350 })).toBe(250);
    expect(reportDuration({ startMs: 100 })).toBeUndefined();
  });
});
