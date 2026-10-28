import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { blockType, buildProgramSchema, PROGRAM_FORMAT, portRole, programFormatOf, validateProgram, type Issue } from "./index";

const PATH = "/prog/t.json";

function validate(blocks: unknown[], programFormat?: number): Issue[] {
  const files: Record<string, string> = { [PATH]: JSON.stringify({ version: 1, name: "T", blocks }) };
  return validateProgram(PATH, (p) => files[p], { programFormat }).issues;
}
const errors = (issues: Issue[]) => issues.filter((i) => i.severity === "error").map((i) => i.code);
const warnings = (issues: Issue[]) => issues.filter((i) => i.severity === "warning").map((i) => i.code);

const LED = { name: "L", type: "led", color: "off" };
const toggle = (fields: Record<string, unknown>, format?: number) =>
  validate([{ name: "T", type: "toggle", durationMs: 20000, next: "L", ...fields }, LED], format);

describe("program format 4 (toggle)", () => {
  it("is the app's format", () => {
    expect(PROGRAM_FORMAT).toBeGreaterThanOrEqual(4);
  });

  it("programFormatOf: toggle needs 4", () => {
    expect(programFormatOf({ blocks: [{ name: "A", type: "toggle", durationMs: 1 }] })).toBe(4);
    expect(programFormatOf({ blocks: [{ name: "A", type: "effect", effect: "off" }] })).toBe(3);
  });

  it("accepts a complete block", () => {
    const issues = toggle({
      pods: "NODE_COUNT", includeCentral: true, colors: ["red", "blue"], start: "random", cooldownMs: 500, syncStartMs: 20,
      countdown: "drain", countdownColor: "white", storeA: "A", storeB: "B", storeTimeA: "TA", storeTimeB: "TB", storeFlips: "F",
      allA: "L", allB: "L",
    });
    expect(errors(issues)).toEqual([]);
    expect(warnings(issues)).not.toContain("unknownField");
  });

  it("colors: exactly two named colours", () => {
    expect(errors(toggle({ colors: ["red", "green"] }))).toEqual([]);
    expect(errors(toggle({ colors: ["red", "BLACK"] }))).toEqual([]);
    for (const colors of [["red"], ["red", "blue", "green"], [], "red", ["red", "#00ff00"], ["red", 5]]) {
      expect(errors(toggle({ colors })), JSON.stringify(colors)).toEqual(["colorsNotTwo"]);
    }
  });

  it("start: the five known values", () => {
    for (const start of ["a", "b", "alternate", "random", "off"]) expect(errors(toggle({ start }))).toEqual([]);
    expect(errors(toggle({ start: "both" }))).toEqual(["unknownOption"]);
  });

  it("the duration is required, in one of two forms", () => {
    expect(errors(validate([{ name: "T", type: "toggle", next: "L" }, LED]))).toEqual(["toggleNeedsDuration"]);
    expect(errors(validate([{ name: "T", type: "toggle", minDurationMs: 1000, next: "L" }, LED]))).toEqual(["toggleNeedsDuration"]);
    expect(errors(validate([{ name: "T", type: "toggle", minDurationMs: 1000, maxDurationMs: 2000, next: "L" }, LED]))).toEqual([]);
    expect(errors(toggle({ minDurationMs: 1000, maxDurationMs: 2000 }))).toEqual(["toggleDurationBothForms"]);
    expect(errors(toggle({ durationMs: "D" }))).toEqual([]);
    expect(warnings(validate([{ name: "T", type: "toggle", minDurationMs: 3000, maxDurationMs: 1000, next: "L" }, LED]))).toContain("rangeReversed");
  });

  it("store names, flags and values are checked", () => {
    expect(errors(toggle({ storeA: "" }))).toEqual(["notText"]);
    expect(errors(toggle({ storeFlips: 3 }))).toEqual(["notText"]);
    expect(errors(toggle({ includeCentral: "yes" }))).toEqual(["notBool"]);
    expect(errors(toggle({ cooldownMs: 1.5 }))).toEqual(["notValue"]);
  });

  it("countdown needs no time limit (the game length is the limit)", () => {
    expect(errors(toggle({ countdown: "fill" }))).toEqual([]);
    expect(errors(toggle({ countdownTarget: "all" }))).toEqual(["countdownTargetNotDelay"]);
  });

  it("is rejected by a pod with program format 3, accepted by 4", () => {
    expect(errors(toggle({}, 3))).toEqual(["unsupportedType"]);
    expect(errors(toggle({}, 4))).toEqual([]);
    expect(errors(toggle({}))).toEqual([]);
  });

  it("is rejected when the pod's block types do not list it", () => {
    const files: Record<string, string> = { [PATH]: JSON.stringify({ name: "T", blocks: [{ name: "T", type: "toggle", durationMs: 5 }] }) };
    expect(errors(validateProgram(PATH, (p) => files[p], { supportedTypes: ["led", "toggle"] }).issues)).toEqual([]);
    expect(errors(validateProgram(PATH, (p) => files[p], { supportedTypes: ["led"] }).issues)).toEqual(["unsupportedType"]);
  });

  it("ports and roles", () => {
    expect(blockType("toggle")!.ports).toEqual(["next", "allA", "allB"]);
    expect(portRole({ type: "toggle" }, "allA")).toBe("ifAllA");
    expect(portRole({ type: "toggle" }, "next")).toBe("whenTimeOver");
    expect(errors(toggle({ allA: "Nope" }))).toEqual(["portUnknownTarget"]);
  });

  it("the JSON schema accepts a toggle block and rejects one colour", () => {
    const check = new Ajv2020({ strict: false }).compile(buildProgramSchema());
    const program = (colors: unknown) => ({ name: "T", blocks: [{ name: "T", type: "toggle", durationMs: 100, colors }] });
    expect(check(program(["red", "blue"]))).toBe(true);
    expect(check(program(["red"]))).toBe(false);
  });
});
