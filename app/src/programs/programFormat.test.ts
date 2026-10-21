import { describe, expect, it } from "vitest";
import { validateProgram } from "@reactpod/program-model";
import { DEFAULT_FILES } from "../defaults";
import type { ListResponse } from "../pod/protocol";
import { SimulatedPod } from "../pod/simulated/SimulatedPod";
import { planPush, syncStates } from "../pod/sync";
import { buildCatalog } from "./catalog";
import { podProgramFormat, validateOptionsOf } from "./sources";

/** Timers (format 2 fields) on a format 1 program. */
const lap = {
  version: 1,
  name: "Lap",
  peripherals: 1,
  start: "Go",
  blocks: [
    { name: "Go", type: "remotePress", pod: 0, timerStart: "lap", next: "Back" },
    { name: "Back", type: "button", timerStop: "lap", pressed: "Go" },
  ],
};
/** A repeat block (format 2 type). */
const rounds = {
  version: 1,
  name: "Rounds",
  peripherals: 0,
  start: "Rounds",
  blocks: [
    { name: "Rounds", type: "repeat", count: 3, body: "Press", done: "Rounds" },
    { name: "Press", type: "button", pressed: "Rounds" },
  ],
};

const files: Record<string, string> = { "/prog/lap.json": JSON.stringify(lap), "/prog/rounds.json": JSON.stringify(rounds) };
const read = (p: string) => files[p];
const codes = (path: string, programFormat?: number) =>
  validateProgram(path, read, validateOptionsOf({ programFormat })).issues.map((i) => `${i.severity}:${i.code}`);

describe("program format of the connected pod", () => {
  it("is info.programFormat, 1 when the pod does not report it, none without a pod", () => {
    expect(podProgramFormat({ programFormat: 2 })).toBe(2);
    expect(podProgramFormat({})).toBe(1);
    expect(podProgramFormat(null)).toBeUndefined();
  });

  it("warns about timer fields for a format 1 pod and rejects the repeat block", () => {
    expect(codes("/prog/lap.json", 1)).toEqual(["warning:fieldNeedsFormat", "warning:fieldNeedsFormat"]);
    expect(codes("/prog/lap.json", 2)).toEqual([]);
    expect(codes("/prog/lap.json")).toEqual([]);
    expect(codes("/prog/rounds.json", 1)).toEqual(["error:unsupportedType"]);
    expect(codes("/prog/rounds.json")).toEqual([]);
  });

  it("reaches the catalog", () => {
    const catalog = buildCatalog(Object.keys(files), read, { programFormat: 1 });
    const lapEntry = catalog.programs.find((e) => e.path === "/prog/lap.json")!;
    expect(lapEntry.issues.map((i) => i.code)).toEqual(["fieldNeedsFormat", "fieldNeedsFormat"]);
    expect(buildCatalog(Object.keys(files), read).programs.every((e) => e.issues.length === 0)).toBe(true);
  });

  it("reaches the push plan: timers do not block, a repeat block does", () => {
    const pod = new SimulatedPod({ files: DEFAULT_FILES, programFormat: 1 });
    const list = JSON.parse(pod.handle('{"op":"list"}')) as ListResponse;
    const podFiles = Object.fromEntries(pod.files);
    const programs = Object.entries(files).map(([path, text]) => ({ id: path, path, json: JSON.parse(text) as Record<string, unknown>, origin: "local" as const, updatedAt: 0 }));
    const states = syncStates({ programs, menu: undefined, base: {}, list, podFiles });
    const plan = planPush(states, { list, podFiles, supportedTypes: pod.blockTypes, programFormat: podProgramFormat({}) });
    expect([...plan.errors.keys()]).toEqual(["/prog/rounds.json"]);
    expect(plan.uploads.map((u) => u.path)).toContain("/prog/lap.json");
  });
});
