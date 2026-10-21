import { describe, expect, it } from "vitest";
import { DEFAULT_FILES } from "../defaults";
import { formatProgram } from "@reactpod/program-model";
import { resolveProgram, validateProgram } from "@reactpod/program-model";
import { Simulator } from "../simulator/engine";
import { stepList } from "./structure";
import {
  addBlock,
  addStep,
  deleteStep,
  moveStep,
  changeBlockType,
  deleteBlock,
  duplicateBlock,
  flattenIncludes,
  insertTemplate,
  namesUsedByIncludes,
  newProgram,
  ownBlocks,
  renameBlock,
  type ProgramJson,
} from "./ops";

const names = (doc: ProgramJson) => new Set(ownBlocks(doc).map((b) => b.name));
const duo = () => JSON.parse(DEFAULT_FILES["/prog/duo.json"]!) as ProgramJson;
const read = (files: Record<string, string>) => (p: string) => files[p] ?? DEFAULT_FILES[p];

describe("editing operations", () => {
  it("builds a valid program from scratch", () => {
    let doc = newProgram("Test");
    const first = addBlock(doc, "led", names(doc));
    doc = first.doc;
    expect(doc.start).toBe("Led1");
    const second = addBlock(doc, "delay", names(doc), "Led1");
    doc = second.doc;
    expect(ownBlocks(doc)[0]).toMatchObject({ name: "Led1", next: "Delay1" });
    // inserting between keeps the chain: Led1 → Button1 → Delay1
    doc = addBlock(doc, "button", names(doc), "Led1").doc;
    expect(ownBlocks(doc).map((b) => [b.name, b.next])).toEqual([
      ["Led1", "Button1"],
      ["Button1", "Delay1"],
      ["Delay1", undefined],
    ]);
    const issues = validateProgram("/prog/test.json", read({ "/prog/test.json": formatProgram(doc) })).issues;
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("does not wire into an if (no next port)", () => {
    let doc = addBlock(newProgram("T"), "if", new Set()).doc;
    doc = addBlock(doc, "led", names(doc), "If1").doc;
    expect(ownBlocks(doc)[0]!.true).toBeUndefined();
    expect(ownBlocks(doc)[1]!.name).toBe("Led1");
  });

  it("renames a block and every reference to it", () => {
    const doc = renameBlock(duo(), "CentralOff", "LightsOut");
    const blocks = ownBlocks(doc);
    expect(blocks.find((b) => b.name === "CentralPress")).toMatchObject({ pressed: "LightsOut" });
    expect(blocks.find((b) => b.name === "CentralMiss")).toMatchObject({ next: "LightsOut" });
    expect(names(doc).has("CentralOff")).toBe(false);
  });

  it("deletes a block and clears the ports pointing to it", () => {
    const doc = deleteBlock(duo(), "CentralMiss");
    expect(ownBlocks(doc).find((b) => b.name === "CentralPress")!.timeout).toBeUndefined();
    expect(names(doc).has("CentralMiss")).toBe(false);
  });

  it("duplicates without connections", () => {
    const { doc, name } = duplicateBlock(duo(), "CentralOn", names(duo()));
    expect(name).toBe("CentralOnCopy");
    expect(ownBlocks(doc).find((b) => b.name === name)!.next).toBeUndefined();
  });

  it("changes the type and keeps shared fields", () => {
    const doc = changeBlockType(duo(), "RemoteTarget", "button");
    expect(ownBlocks(doc).find((b) => b.name === "RemoteTarget")).toMatchObject({ type: "button", timeoutMs: 5000, record: "reaction", next: "EndLoop", timeout: "RemoteMiss" });
    expect(ownBlocks(doc).find((b) => b.name === "RemoteTarget")!.pod).toBeUndefined();
  });

  it("flattens presets into an equivalent self-contained program", () => {
    const resolved = resolveProgram("/prog/duo.json", read({}));
    const flat = flattenIncludes(duo(), resolved);
    expect(flat.include).toBeUndefined();
    expect(flat.variables).toMatchObject({ RUNS: 0, MAX_LOOPS: 10, MISSES: 0 });
    expect(ownBlocks(flat).length).toBe(resolved.blocks.length);
    const issues = validateProgram("/prog/duo.json", read({ "/prog/duo.json": formatProgram(flat) })).issues;
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("inserts a template with renamed clashes", () => {
    const loop = JSON.parse(DEFAULT_FILES["/prog/lib/loop.json"]!) as ProgramJson;
    const doc = insertTemplate(duo(), loop, new Set(["StartLoop", "EndLoop", ...names(duo())]));
    const added = doc.names;
    expect(added).toContain("StartLoop2");
    const copied = ownBlocks(doc.doc).filter((b) => added.includes(b.name));
    // references inside the template follow the new names
    for (const b of copied) for (const v of Object.values(b)) if (typeof v === "string" && v.startsWith("StartLoop")) expect(v).toBe("StartLoop2");
  });

  it("finds own blocks the presets point to", () => {
    const used = namesUsedByIncludes(resolveProgram("/prog/duo.json", read({})));
    expect(used.get("EnterProgram")).toBe("/prog/lib/loop.json");
  });
});

describe("step list operations", () => {
  const PATH = "/prog/duo.json";
  /** duo as one self-contained program (no includes), like the wizard writes it */
  const flatDuo = () => flattenIncludes(duo(), resolveProgram(PATH, read({})));
  const check = (doc: ProgramJson) => validateProgram(PATH, read({ [PATH]: formatProgram(doc) }));
  const errors = (doc: ProgramJson) => check(doc).issues.filter((i) => i.severity === "error");
  const order = (doc: ProgramJson) => stepList(doc).map((s) => (s.loop ? "[repeat]" : `${s.number} ${s.block}`));
  /** runs the program without any press for a while: every timeout path is taken */
  const run = (doc: ProgramJson, ms = 40000) => {
    const sim = new Simulator(check(doc), { seed: 3 });
    sim.advance(ms);
    return sim.snapshot().log.filter((e) => e.kind === "enter").map((e) => e.text);
  };

  it("moves a step up and rewires the links", () => {
    const before = flatDuo();
    const doc = moveStep(before, "RemotePause", "up");
    const blocks = ownBlocks(doc);
    const get = (n: string) => blocks.find((b) => b.name === n)!;
    expect(get("CentralPress")).toMatchObject({ pressed: "RemotePause", timeout: "CentralMiss" });
    expect(get("CentralMiss").next).toBe("RemotePause");
    expect(get("RemotePause").next).toBe("CentralOff");
    expect(get("CentralOff").next).toBe("RemoteTarget");
    expect(order(doc).slice(0, 8)).toEqual(["[repeat]", "1 EnterProgram", "2 CentralOn", "3 CentralPress", "3.1 CentralMiss", "4 RemotePause", "5 CentralOff", "6 RemoteTarget"]);
    expect(errors(doc)).toEqual([]);
    const entered = run(doc);
    // the new order is what runs: miss → pause → central off → remote target
    const i = entered.indexOf("CentralMiss");
    expect(entered.slice(i, i + 4)).toEqual(["CentralMiss", "RemotePause", "CentralOff", "RemoteTarget"]);
    // moving it back down restores the original program
    expect(moveStep(doc, "RemotePause", "down")).toEqual(before);
  });

  it("moves a step down together with its branch", () => {
    const doc = moveStep(flatDuo(), "CentralPress", "down");
    const get = (n: string) => ownBlocks(doc).find((b) => b.name === n)!;
    expect(get("CentralOn").next).toBe("CentralOff");
    expect(get("CentralOff").next).toBe("CentralPress");
    // the press and its miss branch both continue with what now follows them
    expect(get("CentralPress")).toMatchObject({ pressed: "RemotePause", timeout: "CentralMiss" });
    expect(get("CentralMiss").next).toBe("RemotePause");
    expect(order(doc).slice(0, 6)).toEqual(["[repeat]", "1 EnterProgram", "2 CentralOn", "3 CentralOff", "4 CentralPress", "4.1 CentralMiss"]);
    expect(errors(doc)).toEqual([]);
    expect(run(doc).length).toBeGreaterThan(20);
  });

  it("moves the last step of a round up, keeping the way to the next round", () => {
    const doc = moveStep(flatDuo(), "RemoteTarget", "up");
    const get = (n: string) => ownBlocks(doc).find((b) => b.name === n)!;
    expect(get("CentralOff").next).toBe("RemoteTarget");
    expect(get("RemoteTarget")).toMatchObject({ next: "RemotePause", timeout: "RemoteMiss" });
    // the miss branch went on with the next round; now it goes on with the step after it
    expect(get("RemoteMiss").next).toBe("RemotePause");
    expect(get("RemotePause").next).toBe("EndLoop");
    expect(errors(doc)).toEqual([]);
  });

  it("does not move past the ends of a list, out of a branch or over library blocks", () => {
    const doc = flatDuo();
    expect(moveStep(doc, "EnterProgram", "up")).toBe(doc);
    expect(moveStep(doc, "RemoteTarget", "down")).toBe(doc);
    expect(moveStep(doc, "CentralMiss", "up")).toBe(doc);
    expect(moveStep(doc, "StartReset", "up")).toBe(doc); // the Repeat bracket is above
    // with includes: loop.json's StartLoop points to EnterProgram, so that cannot change
    const flatWithIncludes = { ...duo(), blocks: resolveProgram(PATH, read({})).blocks.map((b) => b.block) };
    const original = duo();
    expect(moveStep(original, "EnterProgram", "down", flatWithIncludes)).toBe(original);
    const moved = moveStep(duo(), "CentralOn", "down", flatWithIncludes);
    expect(ownBlocks(moved).find((b) => b.name === "EnterProgram")!.next).toBe("CentralPress");
    expect(errors(moved)).toEqual([]);
  });

  it("moves steps inside a repeat block", () => {
    const doc: ProgramJson = {
      version: 1,
      name: "R",
      start: "Rounds",
      blocks: [
        { name: "Rounds", type: "repeat", count: 3, body: "A", done: "End" },
        { name: "A", type: "led", color: "red", next: "B" },
        { name: "B", type: "delay", ms: 100, next: "Rounds" },
        { name: "End", type: "led", color: "off" },
      ],
    };
    const moved = moveStep(doc, "B", "up");
    expect(ownBlocks(moved).map((b) => [b.name, b.body ?? b.next])).toEqual([
      ["Rounds", "B"],
      ["A", "Rounds"],
      ["B", "A"],
      ["End", undefined],
    ]);
    // the program model knows repeat (format 2): still valid, and the simulator runs B, A three times
    const path = "/prog/r.json";
    const resolved = validateProgram(path, read({ [path]: formatProgram(moved) }));
    expect(resolved.issues.filter((i) => i.severity === "error")).toEqual([]);
    const sim = new Simulator(resolved, { seed: 1 });
    sim.advance(1000);
    const entered = sim.snapshot().log.filter((e) => e.kind === "enter").map((e) => e.text);
    expect(entered.filter((n) => n !== "Rounds").slice(0, 7)).toEqual(["B", "A", "B", "A", "B", "A", "End"]);
  });

  it("deletes a step with its branch and keeps the flow connected", () => {
    const doc = deleteStep(flatDuo(), "CentralPress");
    expect(names(doc).has("CentralPress")).toBe(false);
    expect(names(doc).has("CentralMiss")).toBe(false);
    expect(ownBlocks(doc).find((b) => b.name === "CentralOn")!.next).toBe("CentralOff");
    expect(errors(doc)).toEqual([]);
    expect(run(doc)).not.toContain("CentralPress");
    // the start moves on when the first step is deleted
    const solo = JSON.parse(DEFAULT_FILES["/prog/solo.json"]!) as ProgramJson;
    expect(deleteStep(solo, "Ready").start).toBe("Wait");
    // a block a library part points to stays
    expect(deleteStep(duo(), "EnterProgram", { ...duo(), blocks: resolveProgram(PATH, read({})).blocks.map((b) => b.block) })).toEqual(duo());
  });

  it("adds a step on the way a press continues", () => {
    const solo = JSON.parse(DEFAULT_FILES["/prog/solo.json"]!) as ProgramJson;
    const { doc, name } = addStep(solo, "led", names(solo), "Hit");
    expect(ownBlocks(doc).find((b) => b.name === "Hit")!.pressed).toBe(name);
    expect(ownBlocks(doc).find((b) => b.name === name)!.next).toBe("HitLED");
    const early = addStep(solo, "delay", names(solo), "Wait").doc;
    expect(ownBlocks(early).find((b) => b.name === "Wait")).toMatchObject({ timeout: "Delay1", pressed: "FalseStart" });
    // after a plain block it behaves like addBlock
    expect(addStep(solo, "delay", names(solo), "Ready").doc).toEqual(addBlock(solo, "delay", names(solo), "Ready").doc);
  });
});

describe("variables", () => {
  it("renames a variable everywhere", async () => {
    const { renameVariable } = await import("./ops");
    const doc = renameVariable(duo(), "MISSES", "FAILS");
    expect(doc.variables).toMatchObject({ FAILS: 0 });
    expect(ownBlocks(doc).find((b) => b.name === "CentralMiss")).toMatchObject({ var: "FAILS" });
  });
});
