import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { blockType, buildProgramSchema, PROGRAM_FORMAT, portRole, programFormatOf, validateProgram, type Issue } from "./index";

const PATH = "/prog/t.json";

/** A program with the given variables (declared) and blocks; the last LED block is the target of the ports. */
function validate(blocks: unknown[], programFormat?: number, variables?: Record<string, number>): Issue[] {
  const files: Record<string, string> = { [PATH]: JSON.stringify({ version: 1, name: "T", variables, blocks }) };
  return validateProgram(PATH, (p) => files[p], { programFormat }).issues;
}
const errors = (issues: Issue[]) => issues.filter((i) => i.severity === "error").map((i) => i.code);
const warnings = (issues: Issue[]) => issues.filter((i) => i.severity === "warning").map((i) => i.code);
const LED = { name: "L", type: "led", color: "off" };
const VARS = { MAX_LOOPS: 3, RUNS: 0 };
const report = (fields: Record<string, unknown>, variables: Record<string, number> | undefined = VARS, format?: number) =>
  validate([{ name: "C", type: "communicate", next: "L", ...fields }, LED], format, variables);

describe("program format 5 (communicate)", () => {
  it("is at least the format of communicate", () => {
    expect(PROGRAM_FORMAT).toBeGreaterThanOrEqual(5);
  });

  it("programFormatOf: communicate needs 5", () => {
    expect(programFormatOf({ blocks: [{ name: "C", type: "communicate" }] })).toBe(5);
    expect(programFormatOf({ blocks: [{ name: "A", type: "toggle", durationMs: 1 }] })).toBe(4);
  });

  it("accepts a complete block", () => {
    const issues = report({
      timeoutMs: 3000, metrics: ["reaction", "cycle"], vars: ["RUNS", "MAX_LOOPS"], editable: { MAX_LOOPS: { min: 1, max: 50 } },
      color: "magenta", timerStart: "lap", timerStop: "lap", pressed: "L", timeout: "L", repeat: "L", stop: "L",
    });
    expect(errors(issues)).toEqual([]);
    expect(warnings(issues)).not.toContain("unknownField");
  });

  it("is rejected by a pod with program format 4, accepted by 5", () => {
    expect(errors(report({}, VARS, 4))).toEqual(["unsupportedType"]);
    expect(errors(report({}, VARS, 5))).toEqual([]);
    expect(errors(report({}))).toEqual([]);
  });

  it("is rejected when the pod's block types do not list it", () => {
    const files: Record<string, string> = { [PATH]: JSON.stringify({ name: "T", blocks: [{ name: "C", type: "communicate", next: "L" }, LED] }) };
    expect(errors(validateProgram(PATH, (p) => files[p], { supportedTypes: ["led", "communicate"] }).issues)).toEqual([]);
    expect(errors(validateProgram(PATH, (p) => files[p], { supportedTypes: ["led"] }).issues)).toEqual(["unsupportedType"]);
  });

  it("the lists and names: at most 8 entries, 1 to 32 characters", () => {
    expect(errors(report({ metrics: [] }))).toEqual([]);
    expect(errors(report({ metrics: Array.from({ length: 8 }, (_, i) => `m${i}`) }))).toEqual([]);
    expect(errors(report({ metrics: Array.from({ length: 9 }, (_, i) => `m${i}`) }))).toEqual(["namesTooMany"]);
    expect(errors(report({ metrics: ["x".repeat(32)] }))).toEqual([]);
    expect(errors(report({ metrics: ["x".repeat(33)] }))).toEqual(["namesInvalid"]);
    expect(errors(report({ metrics: [""] }))).toEqual(["namesInvalid"]);
    expect(errors(report({ metrics: "reaction" }))).toEqual(["namesInvalid"]);
    expect(errors(report({ metrics: [3] }))).toEqual(["namesInvalid"]);
    expect(errors(report({ vars: ["RUNS", 7] }))).toEqual(["namesInvalid"]);
  });

  it("vars and editable name variables the program declares (includes count, block writes do not)", () => {
    expect(errors(report({ vars: ["NOPE"] }))).toEqual(["variableNotDeclared"]);
    expect(errors(report({ editable: { NOPE: { min: 0, max: 1 } } }))).toEqual(["variableNotDeclared"]);
    expect(errors(report({ vars: ["NOPE"] }, undefined))).toEqual(["variableNotDeclared"]);
    const written = validate([
      { name: "S", type: "setVariable", var: "WRITTEN", op: "=", value: 1, next: "C" },
      { name: "C", type: "communicate", vars: ["WRITTEN"], next: "L" },
      LED,
    ]);
    expect(errors(written)).toEqual(["variableNotDeclared"]);
  });

  it("editable: integers with min <= max, at most 8 entries", () => {
    expect(errors(report({ editable: { MAX_LOOPS: { min: 1, max: 1 } } }))).toEqual([]);
    expect(errors(report({ editable: {} }))).toEqual([]);
    expect(errors(report({ editable: { MAX_LOOPS: { min: 5, max: 1 } } }))).toEqual(["editableInvalid"]);
    expect(errors(report({ editable: { MAX_LOOPS: { min: 1.5, max: 3 } } }))).toEqual(["editableInvalid"]);
    expect(errors(report({ editable: { MAX_LOOPS: { min: 1 } } }))).toEqual(["editableInvalid"]);
    expect(errors(report({ editable: { MAX_LOOPS: 3 } }))).toEqual(["editableInvalid"]);
    expect(errors(report({ editable: ["MAX_LOOPS"] }))).toEqual(["editableInvalid"]);
    const many = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`V${i}`, { min: 0, max: 1 }]));
    expect(errors(report({ editable: many }, { ...VARS, ...Object.fromEntries(Object.keys(many).map((k) => [k, 0])) }))).toEqual(["namesTooMany"]);
  });

  it("timeoutMs: a value, 0 or more", () => {
    expect(errors(report({ timeoutMs: 0 }))).toEqual([]);
    expect(errors(report({ timeoutMs: "T" }, { ...VARS, T: 5 }))).toEqual([]);
    expect(errors(report({ timeoutMs: -1 }))).toEqual(["timeoutNegative"]);
    expect(errors(report({ timeoutMs: 1.5 }))).toEqual(["notValue"]);
  });

  it("color is a colour of the central", () => {
    expect(errors(report({ color: "#ff8800" }))).toEqual([]);
    expect(errors(report({ color: "nope" }))).toEqual(["invalidColor"]);
  });

  it("ports and roles", () => {
    expect(blockType("communicate")!.ports).toEqual(["next", "pressed", "timeout", "repeat", "stop"]);
    expect(portRole({ type: "communicate" }, "next")).toBe("ifContinued");
    expect(portRole({ type: "communicate" }, "pressed")).toBe("ifPressed");
    expect(portRole({ type: "communicate" }, "timeout")).toBe("ifTimedOut");
    expect(portRole({ type: "communicate" }, "repeat")).toBe("ifRepeated");
    expect(portRole({ type: "communicate" }, "stop")).toBe("ifStopped");
    expect(errors(report({ stop: "Nowhere" }))).toEqual(["portUnknownTarget"]);
  });

  it("the JSON schema accepts a communicate block and rejects two bad lists", () => {
    const check = new Ajv2020({ strict: false }).compile(buildProgramSchema());
    const program = (fields: Record<string, unknown>) => ({ name: "C", blocks: [{ name: "C", type: "communicate", ...fields }] });
    expect(check(program({ timeoutMs: 3000, metrics: ["reaction"], vars: ["RUNS"], editable: { RUNS: { min: 0, max: 9 } }, color: "cyan" }))).toBe(true);
    expect(check(program({ editable: { RUNS: { min: 0 } } }))).toBe(false);
    expect(check(program({ metrics: Array.from({ length: 9 }, (_, i) => `m${i}`) }))).toBe(false);
  });
});
