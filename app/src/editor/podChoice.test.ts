import { describe, expect, it } from "vitest";
import { validateProgram } from "@reactpod/program-model";
import { duplicateStep, ownBlocks, type ProgramJson } from "./ops";
import { podChoice, setPodChoice } from "./podChoice";
import { stepList } from "./structure";

const doc = (): ProgramJson => ({
  version: 1,
  name: "T",
  peripherals: 3,
  start: "Pause",
  blocks: [
    { name: "Pause", type: "delay", ms: 1000, next: "Pod" },
    { name: "Pod", type: "remotePress", pod: 1, next: "Pause" },
  ],
});

const issues = (d: ProgramJson) =>
  validateProgram("/prog/t.json", (p) => (p === "/prog/t.json" ? JSON.stringify(d) : undefined)).issues.filter((i) => i.severity === "error");

describe("which pod", () => {
  it("reads a fixed pod", () => {
    expect(podChoice(doc(), "Pod")).toEqual({ kind: "pod", pod: 1 });
  });

  it("random adds a pick step in front, a fixed pod removes it again", () => {
    const random = setPodChoice(doc(), "Pod", { kind: "random" });
    expect(podChoice(random, "Pod")).toMatchObject({ kind: "random", variable: "SELECTED_POD" });
    expect(ownBlocks(random).map((b) => b.name)).toEqual(["Pause", "SelectPod", "Pod"]);
    expect(ownBlocks(random)[0]!.next).toBe("SelectPod");
    expect(issues(random)).toEqual([]);
    const other = setPodChoice(random, "Pod", { kind: "randomOther" });
    expect(podChoice(other, "Pod").kind).toBe("randomOther");
    expect(ownBlocks(other).filter((b) => b.type === "setVariable")).toHaveLength(1);
    const back = setPodChoice(other, "Pod", { kind: "pod", pod: 1 });
    expect(back).toEqual(doc());
  });

  it("keeps the pick's variable when something else reads it", () => {
    let d = setPodChoice(doc(), "Pod", { kind: "random" });
    d = { ...d, blocks: [...ownBlocks(d), { name: "Check", type: "if", left: "SELECTED_POD", op: "==", right: 0 }] };
    const fixed = setPodChoice(d, "Pod", { kind: "pod", pod: 0 });
    expect((fixed.variables as Record<string, number>).SELECTED_POD).toBe(0);
  });
});

describe("duplicate a step", () => {
  it("puts the copy right after the original in the flow", () => {
    const { doc: d, name } = duplicateStep(doc(), "Pause", new Set(["Pause", "Pod"]));
    expect(name).toBe("PauseCopy");
    expect(stepList(d).map((s) => s.block)).toEqual(["Pause", "PauseCopy", "Pod"]);
    expect(issues(d)).toEqual([]);
  });
});
