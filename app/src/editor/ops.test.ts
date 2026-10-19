import { describe, expect, it } from "vitest";
import { DEFAULT_FILES } from "../defaults";
import { formatProgram } from "@reactpod/program-model";
import { resolveProgram, validateProgram } from "@reactpod/program-model";
import {
  addBlock,
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

describe("variables", () => {
  it("renames a variable everywhere", async () => {
    const { renameVariable } = await import("./ops");
    const doc = renameVariable(duo(), "MISSES", "FAILS");
    expect(doc.variables).toMatchObject({ FAILS: 0 });
    expect(ownBlocks(doc).find((b) => b.name === "CentralMiss")).toMatchObject({ var: "FAILS" });
  });
});
