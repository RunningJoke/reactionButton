import { describe, expect, it } from "vitest";
import { blockType, PROGRAM_FORMAT, programFormatOf, validateProgram, type Issue } from "./index";

const PATH = "/prog/t.json";

/** A program with the given variables (declared) and blocks; the last LED block is the target of the ports. */
function validate(blocks: unknown[], programFormat?: number, variables?: Record<string, number>): Issue[] {
  const files: Record<string, string> = { [PATH]: JSON.stringify({ version: 1, name: "T", variables, blocks }) };
  return validateProgram(PATH, (p) => files[p], { programFormat }).issues;
}
const errors = (issues: Issue[]) => issues.filter((i) => i.severity === "error").map((i) => i.code);
const LED = { name: "L", type: "led", color: "off" };
const VARS = { TARGET_MS: 400 };
const summary = (fields: Record<string, unknown>, format?: number, variables: Record<string, number> | undefined = VARS) =>
  validate([{ name: "S", type: "summary", metric: "reaction", next: "L", ...fields }, LED], format, variables);

describe("program format 6 (summary bar)", () => {
  it("is the app's format", () => {
    expect(PROGRAM_FORMAT).toBe(6);
  });

  it("programFormatOf: a summary without the bar stays format 1, with show it needs 6", () => {
    expect(programFormatOf({ blocks: [{ name: "S", type: "summary", metric: "reaction" }] })).toBe(1);
    expect(programFormatOf({ blocks: [{ name: "S", type: "summary", metric: "reaction", show: false }] })).toBe(6);
    expect(programFormatOf({ blocks: [{ name: "S", type: "summary", metric: "reaction", targetMs: 450 }] })).toBe(6);
  });

  it("accepts the bar with a target and a show time, and with a variable target", () => {
    expect(errors(summary({ show: true, targetMs: 450, showMs: 3000 }, 6))).toEqual([]);
    expect(errors(summary({ show: true, targetMs: "TARGET_MS" }, 6))).toEqual([]);
    expect(errors(summary({ show: true, targetMs: 450, showMs: 0 }, 6))).toEqual([]);
  });

  it("a plain summary is accepted by every format", () => {
    expect(errors(summary({}, 1))).toEqual([]);
    expect(errors(summary({}, 5))).toEqual([]);
  });

  it("is rejected by a pod with format 5 (the fields would be ignored there)", () => {
    expect(errors(summary({ show: true, targetMs: 450 }, 5))).toEqual(["fieldFormatTooOld", "fieldFormatTooOld"]);
    expect(errors(summary({ show: true, targetMs: 450 }, 6))).toEqual([]);
  });

  it("show needs a target", () => {
    expect(errors(summary({ show: true }, 6))).toEqual(["summaryNeedsTarget"]);
  });

  it("targetMs is 1 to 60000 ms", () => {
    expect(errors(summary({ show: true, targetMs: 1 }, 6))).toEqual([]);
    expect(errors(summary({ show: true, targetMs: 60000 }, 6))).toEqual([]);
    expect(errors(summary({ show: true, targetMs: 0 }, 6))).toEqual(["summaryTargetRange"]);
    expect(errors(summary({ show: true, targetMs: 60001 }, 6))).toEqual(["summaryTargetRange"]);
    expect(errors(summary({ show: true, targetMs: 450.5 }, 6))).toEqual(["notValue", "summaryTargetRange"]);
  });

  it("showMs is 0 to 60000 ms", () => {
    expect(errors(summary({ show: true, targetMs: 450, showMs: -1 }, 6))).toEqual(["summaryShowRange"]);
    expect(errors(summary({ show: true, targetMs: 450, showMs: 60001 }, 6))).toEqual(["summaryShowRange"]);
  });

  it("show is a boolean", () => {
    expect(errors(summary({ show: "yes" }, 6))).toEqual(["notBool"]);
  });

  it("the summary block can wait (with the bar) and has the fields of programs.md §7.7", () => {
    const def = blockType("summary")!;
    expect(def.waits).toBe(true);
    expect(def.fields.find((f) => f.name === "show")).toMatchObject({ kind: "bool", default: false, minFormat: 6, rejectedByOlder: true });
    expect(def.fields.find((f) => f.name === "targetMs")).toMatchObject({ kind: "value", minFormat: 6 });
    expect(def.fields.find((f) => f.name === "showMs")).toMatchObject({ kind: "value", default: 3000, minFormat: 6 });
  });
});
