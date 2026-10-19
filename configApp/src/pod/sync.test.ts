import { describe, expect, it } from "vitest";
import { DEFAULT_FILES } from "../defaults";
import { formatProgram } from "../model/format";
import { INDEX_PATH } from "../model/limits";
import { collectSet, unzipSet, zipSet } from "../programs/setArchive";
import type { ProgramDoc, SyncBase } from "../store/programStore";
import { PodClient } from "./client";
import { crcHex } from "./crc32";
import type { ListResponse } from "./protocol";
import { SimulatedPod } from "./simulated/SimulatedPod";
import { SimulatedTransport } from "./simulated/SimulatedTransport";
import { deepEqual, executePush, formatMenu, parsePodMessage, planPush, planRestore, syncStates, type SyncInput } from "./sync";

function doc(path: string, json: Record<string, unknown>, origin: ProgramDoc["origin"] = "local"): ProgramDoc {
  return { id: path, path, json, origin, updatedAt: 0 };
}

function podState(pod: SimulatedPod) {
  const list = JSON.parse(pod.handle('{"op":"list"}')) as ListResponse;
  return { list, podFiles: Object.fromEntries(pod.files) };
}

function input(pod: SimulatedPod, programs: ProgramDoc[], base: Record<string, SyncBase> = {}, menu?: string[]): SyncInput {
  return { programs, menu, base, ...podState(pod) };
}

/** A small valid program using the shipped `loop` preset. */
function sprint(extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    name: "Sprint",
    peripherals: 1,
    variables: { MAX_LOOPS: 3 },
    include: ["/prog/lib/loop.json"],
    start: "StartLoop",
    blocks: [{ name: "EnterProgram", type: "remotePress", pod: 1, color: "green", next: "EndLoop", timeout: "EndLoop" }],
    ...extra,
  };
}

async function connect(pod: SimulatedPod) {
  const transport = new SimulatedTransport(pod);
  await transport.connect();
  return new PodClient(transport, { timeoutMs: 500 });
}

describe("sync states", () => {
  const solo = JSON.parse(DEFAULT_FILES["/prog/solo.json"]!) as Record<string, unknown>;

  it("treats a reformatted but equal program as in sync", () => {
    const pod = new SimulatedPod({ files: DEFAULT_FILES });
    const [state] = syncStates(input(pod, [doc("/prog/solo.json", solo, "pod")]));
    expect(state).toMatchObject({ path: "/prog/solo.json", status: "inSync" });
  });

  it("tells local newer, pod newer and conflicts apart by the last common CRC", () => {
    const pod = new SimulatedPod({ files: DEFAULT_FILES });
    const podCrc = crcHex(DEFAULT_FILES["/prog/solo.json"]!);
    const edited = doc("/prog/solo.json", { ...solo, description: "mine" }, "pod");
    const status = (base: Record<string, SyncBase>) => syncStates(input(pod, [edited], base))[0]!.status;

    expect(status({})).toBe("conflict"); // never synced
    expect(status({ "/prog/solo.json": { crc: podCrc, size: 1 } })).toBe("localNewer");
    const mine = crcHex(formatProgram(edited.json));
    expect(status({ "/prog/solo.json": { crc: mine, size: 1 } })).toBe("podNewer");
    expect(status({ "/prog/solo.json": { crc: "00000000", size: 1 } })).toBe("conflict");
  });

  it("uses the shipped file as base for an untouched copy of a shipped program", () => {
    const pod = new SimulatedPod({ files: DEFAULT_FILES });
    const [state] = syncStates(input(pod, [doc("/prog/solo.json", { ...solo, description: "mine" }, "default")]));
    expect(state!.status).toBe("localNewer");
  });

  it("marks new programs, pod-only files and the local menu", () => {
    const pod = new SimulatedPod({ files: DEFAULT_FILES });
    const menu = [...pod.fileList().map((f) => f.path).filter((p) => p === "/prog/solo.json"), "/prog/sprint.json"];
    const states = syncStates(input(pod, [doc("/prog/sprint.json", sprint())], {}, menu));
    const by = new Map(states.map((s) => [s.path, s.status]));
    expect(by.get("/prog/sprint.json")).toBe("new");
    expect(by.get(INDEX_PATH)).toBe("localNewer");
    expect(by.get("/prog/duo.json")).toBe("podOnly");
    // a menu equal to the pod's is in sync, also without a base
    const same = syncStates(input(pod, [], {}, podState(pod).list.menu));
    expect(same.find((s) => s.path === INDEX_PATH)!.status).toBe("inSync");
    // the pod's menu changed since the last sync and the local one too
    const base = { [INDEX_PATH]: { crc: "12345678", size: 1 } };
    expect(syncStates(input(pod, [], base, menu)).find((s) => s.path === INDEX_PATH)!.status).toBe("conflict");
  });

  it("compares JSON regardless of key order", () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
  });
});

describe("push plan", () => {
  it("adds missing presets and puts the menu last", () => {
    const files = Object.fromEntries(Object.entries(DEFAULT_FILES).filter(([p]) => !p.startsWith("/prog/lib/")));
    files["/prog/duo.json"] = DEFAULT_FILES["/prog/duo.json"]!;
    const pod = new SimulatedPod({ files: { [INDEX_PATH]: formatMenu(["/prog/solo.json"]), "/prog/solo.json": DEFAULT_FILES["/prog/solo.json"]! } });
    const menu = ["/prog/solo.json", "/prog/sprint.json", "/prog/duo.json"];
    const states = syncStates(input(pod, [doc("/prog/sprint.json", sprint())], {}, menu));
    const plan = planPush(states, podState(pod));
    expect(plan.errors.size).toBe(0);
    const order = plan.uploads.map((u) => `${u.reason}:${u.path}`);
    expect(order[0]).toMatch(/^preset:\/prog\/lib\//);
    expect(order).toContain("program:/prog/sprint.json");
    expect(order).toContain("shipped:/prog/duo.json");
    expect(order.at(-1)).toBe(`menu:${INDEX_PATH}`);
    expect(plan.validate).toEqual(menu);
  });

  it("blocks on local errors and skips conflicts", () => {
    const pod = new SimulatedPod({ files: DEFAULT_FILES });
    const solo = JSON.parse(DEFAULT_FILES["/prog/solo.json"]!) as Record<string, unknown>;
    const broken = doc("/prog/bad.json", { name: "Bad", blocks: [{ name: "A", type: "buton" }] });
    const conflict = doc("/prog/solo.json", { ...solo, description: "x" }, "pod");
    const plan = planPush(syncStates(input(pod, [broken, conflict])), podState(pod));
    expect([...plan.errors.keys()]).toEqual(["/prog/bad.json"]);
    expect(plan.skipped.map((s) => s.path)).toEqual(["/prog/solo.json"]);
    expect(plan.uploads.map((u) => u.path)).toEqual(["/prog/bad.json"]);
  });

  it("restores the shipped files that differ and always writes the menu", () => {
    const pod = new SimulatedPod({ files: { ...DEFAULT_FILES, "/prog/mine.json": formatProgram(sprint()), [INDEX_PATH]: formatMenu(["/prog/mine.json"]) } });
    pod.files.delete("/prog/duo.json");
    const plan = planRestore(podState(pod));
    expect(plan.uploads.map((u) => u.path)).toEqual(["/prog/duo.json", INDEX_PATH]);
    expect(plan.errors.size).toBe(0);
  });
});

describe("push", () => {
  it("uploads the plan, checks on the pod and reports the base of every file", async () => {
    const pod = new SimulatedPod({ files: { [INDEX_PATH]: formatMenu([]) } });
    const client = await connect(pod);
    const states = syncStates(input(pod, [doc("/prog/sprint.json", sprint())], {}, ["/prog/sprint.json"]));
    const plan = planPush(states, podState(pod));
    const bases: Record<string, SyncBase> = {};
    const result = await executePush(client, plan, { dryRun: true, maxRequest: 12288, onUploaded: (p, b) => void (bases[p] = b) });
    expect(result).toMatchObject({ stopped: false, podIssues: [] });
    expect(result.uploaded).toEqual(["/prog/lib/loop.json", "/prog/sprint.json", INDEX_PATH]);
    expect(pod.files.get("/prog/sprint.json")).toBe(formatProgram(sprint()));
    expect(bases["/prog/sprint.json"]!.crc).toBe(crcHex(formatProgram(sprint())));
    // afterwards everything is in sync
    const after = syncStates(input(pod, [doc("/prog/sprint.json", sprint())], bases, ["/prog/sprint.json"]));
    expect(after.filter((s) => s.status !== "inSync" && s.status !== "podOnly")).toEqual([]);
  });

  it("stops before any program is written when the pod's dry run fails", async () => {
    const pod = new SimulatedPod({ files: DEFAULT_FILES, blockTypes: ["led", "delay"] });
    const client = await connect(pod);
    const plan = planPush(syncStates(input(pod, [doc("/prog/sprint.json", sprint())], {}, ["/prog/sprint.json"])), podState(pod));
    expect(plan.errors.size).toBe(0); // the app does not know the pod's block types here
    const result = await executePush(client, plan, { dryRun: true, maxRequest: 12288 });
    expect(result.stopped).toBe(true);
    expect(result.podIssues[0]).toMatchObject({ path: "/prog/sprint.json" });
    expect(pod.files.has("/prog/sprint.json")).toBe(false);
    expect(pod.files.get(INDEX_PATH)).toBe(DEFAULT_FILES[INDEX_PATH]);
  });

  it("checks after the upload without dry run, and stops on auth_required", async () => {
    const pod = new SimulatedPod({ files: DEFAULT_FILES, blockTypes: ["led", "delay"] });
    const client = await connect(pod);
    const plan = planPush(syncStates(input(pod, [doc("/prog/sprint.json", sprint())])), podState(pod));
    const result = await executePush(client, plan, { maxRequest: 12288 });
    expect(result.uploaded).toEqual(["/prog/sprint.json"]);
    expect(result.podIssues.map((i) => i.path)).toContain("/prog/sprint.json");

    pod.pin = "1234";
    await expect(executePush(client, plan, { maxRequest: 12288 })).rejects.toMatchObject({ code: "auth_required" });
  });

  it("parses the loader's messages", () => {
    expect(parsePodMessage("/prog/a.json", "/prog/lib/x.json: block 'Hit' has unknown type 'buton'")).toEqual({
      path: "/prog/a.json",
      file: "/prog/lib/x.json",
      block: "Hit",
      message: "/prog/lib/x.json: block 'Hit' has unknown type 'buton'",
    });
    expect(parsePodMessage("/prog/a.json", "block 'A' port 'next': target 'B' not found").block).toBe("A");
    expect(parsePodMessage("/prog/a.json", "/prog/a.json: duplicate block name 'X'").block).toBe("X");
  });
});

describe("set archive", () => {
  it("exports the menu with programs and includes, and reads it back", () => {
    const read = (p: string) => (p === "/prog/sprint.json" ? formatProgram(sprint()) : DEFAULT_FILES[p]);
    const files = collectSet(["/prog/duo.json"], ["/prog/sprint.json"], read);
    expect(Object.keys(files).sort()).toEqual(["/prog/duo.json", "/prog/lib/loop.json", "/prog/sprint.json", INDEX_PATH]);
    const set = unzipSet(zipSet(files));
    expect(set.menu).toEqual(["/prog/duo.json"]);
    expect(set.programs.map((p) => p.path)).toEqual(["/prog/duo.json", "/prog/sprint.json"]);
    expect(set.programs[1]!.json).toEqual(sprint());
    expect(set.ignored).toEqual(["/prog/lib/loop.json"]);
  });

  it("accepts a top folder and rejects other archives", async () => {
    const { zipSync, strToU8 } = await import("fflate");
    const set = unzipSet(zipSync({ "data/programs.json": strToU8(formatMenu(["/prog/a.json"])), "data/prog/a.json": strToU8('{"name":"A"}') }));
    expect(set.programs.map((p) => p.path)).toEqual(["/prog/a.json"]);
    expect(() => unzipSet(zipSync({ "readme.txt": strToU8("hi") }))).toThrow();
    expect(() => unzipSet(strToU8("not a zip"))).toThrow();
  });
});
