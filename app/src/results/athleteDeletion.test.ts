import { beforeEach, describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import type { PodClient } from "../pod/client";
import { usePodSessions, type PodSession } from "../pod/session";
import { usePlatformSettings } from "../platform/settings";
import { deleteAthleteEverywhere } from "./athleteDeletion";
import { linkResults } from "./podLink";
import type { InfoResponse } from "../pod/protocol";
import { parsePodReport } from "./report";
import { MemoryResultStorage } from "./resultStore";
import { useResults } from "./results";

const ORG = "org-1";
const SET = "1a2b3c4d";

function reset() {
  const storage = new MemoryResultStorage(true);
  useResults.setState({ loaded: true, athletes: [], sessions: [], reports: [], sets: {}, platformDeletes: [], deletedAthletes: [], storage, durable: true });
  usePodSessions.setState({ entries: [], activeId: null });
  usePlatformSettings.setState({ claimedAthleteIds: [] });
  return storage;
}

/** A pod report as the pod sends it (`report` event, optionally tagged with the athlete id). */
function raw(id: number, athlete?: string) {
  return {
    event: "report",
    id,
    program: "/prog/solo.json",
    setId: SET,
    ...(athlete === undefined ? {} : { athlete }),
    cycle: id,
    startMs: id * 1000,
    endMs: id * 1000 + 500,
    values: [{ t: id * 1000, metric: "reaction", pod: 1, ms: 300 }],
    stats: {},
    vars: {},
  };
}

/** A fake pod client: answers `reports` with the given list, records every request. */
function fakePod(reports: unknown[] = []) {
  const calls: { op: string; args: unknown }[] = [];
  const client = {
    request: async (op: string, args?: unknown) => {
      calls.push({ op, args });
      return op === "reports" ? { reports } : { ok: true };
    },
    onEvent: () => () => undefined,
  } as unknown as PodClient;
  return { client, calls };
}

/** Puts a connected pod with the given features into the session list. */
function connectedPod(client: PodClient, features: string[]) {
  const info = { setId: SET, features } as unknown as InfoResponse;
  const store = createStore<PodSession>(() => ({ state: "connected", info, client }) as unknown as PodSession);
  usePodSessions.setState({ entries: [{ id: "p1", store }], activeId: "p1" });
}

async function linkedAthlete(name: string, platformId: string, claimed = false) {
  const athlete = await useResults.getState().addAthlete(name);
  await useResults.getState().updateAthlete(athlete.id, { platformId, platformOrgId: ORG });
  if (claimed) usePlatformSettings.setState({ claimedAthleteIds: [...(usePlatformSettings.getState().claimedAthleteIds ?? []), platformId] });
  return athlete;
}

beforeEach(reset);

describe("deleting an athlete on the phone", () => {
  it("queues the self-delete for a profile the user claimed, the coach delete otherwise", async () => {
    const mine = await linkedAthlete("Mia", "p-mia", true);
    const coached = await linkedAthlete("Cem", "p-cem");
    await deleteAthleteEverywhere(mine.id);
    await deleteAthleteEverywhere(coached.id);
    expect(useResults.getState().platformDeletes.map((d) => [d.kind, d.platformId])).toEqual([
      ["myAthlete", "p-mia"],
      ["athlete", "p-cem"],
    ]);
  });

  it("removes the sessions and reports and drops the athlete's queued uploads", async () => {
    const mia = await linkedAthlete("Mia", "p-mia");
    await useResults.getState().assign(SET, mia.id);
    await useResults.getState().receiveReport(parsePodReport(raw(1))!);
    expect(useResults.getState().reports).toHaveLength(1);
    await useResults.getState().recordUpload(useResults.getState().sessions[0]!.id, "remote-s", []);

    await deleteAthleteEverywhere(mia.id);
    const s = useResults.getState();
    expect([s.athletes, s.sessions, s.reports, s.sets[SET]?.athleteId]).toEqual([[], [], [], null]);
  });

  it("dismisses reports that arrive later for the deleted athlete, also after a restart, and acks them", async () => {
    const storage = reset();
    const mia = await linkedAthlete("Mia", "p-mia");
    const cem = await linkedAthlete("Cem", "p-cem");
    await deleteAthleteEverywhere(mia.id);

    const { client, calls } = fakePod([raw(5, mia.id), raw(6, cem.id)]);
    const feed = linkResults(client, { setId: SET, features: ["reports", "remote"] } as unknown as InfoResponse, {
      programText: () => undefined,
      log: () => undefined,
    });
    await feed.started;
    expect(calls.filter((c) => c.op === "ack").map((c) => c.args)).toEqual([{ reportId: 5 }, { reportId: 6 }]);
    const stored = useResults.getState().reports;
    expect(stored.map((r) => r.podReportId)).toEqual([6]); // the report of Cem only
    expect(useResults.getState().sessions.every((x) => x.athleteId === cem.id)).toBe(true);

    // the tombstone survives a restart
    useResults.setState({ loaded: false, deletedAthletes: [] });
    await useResults.getState().load();
    expect(useResults.getState().deletedAthletes).toEqual([mia.id]);
    expect(await storage.getMeta("deletedAthletes")).toEqual([mia.id]);
  });

  it("clears the athlete on a connected pod that tags its reports with them", async () => {
    const mia = await linkedAthlete("Mia", "p-mia");
    await useResults.getState().assign(SET, mia.id);
    const pod = fakePod();
    connectedPod(pod.client, ["reports", "remote"]);
    await deleteAthleteEverywhere(mia.id);
    expect(pod.calls).toEqual([{ op: "session", args: { athlete: "" } }]);
  });

  it("leaves a pod alone that does not support the athlete tag or is on another set", async () => {
    const mia = await linkedAthlete("Mia", "p-mia");
    await useResults.getState().assign(SET, mia.id);
    const oldPod = fakePod();
    connectedPod(oldPod.client, ["reports"]);
    await deleteAthleteEverywhere(mia.id);
    expect(oldPod.calls).toEqual([]);
  });
});
