import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  blockType,
  buildProgramSchema,
  fieldLevel,
  MAX_TIMERS,
  PROGRAM_FORMAT,
  portRole,
  programFormatOf,
  resolveProgram,
  TIMER_FIELDS,
  validateProgram,
  type Issue,
} from "./index";

const PATH = "/prog/t.json";
const LIB = "/prog/lib/part.json";

function check(blocks: unknown[], options: { programFormat?: number; supportedTypes?: string[]; lib?: unknown[] } = {}): Issue[] {
  const files: Record<string, string> = {
    [PATH]: JSON.stringify({ version: 1, name: "T", ...(options.lib ? { include: [LIB] } : {}), blocks }),
    ...(options.lib ? { [LIB]: JSON.stringify({ blocks: options.lib }) } : {}),
  };
  return validateProgram(PATH, (p) => files[p], options).issues;
}
const codes = (issues: Issue[], severity: Issue["severity"]) => issues.filter((i) => i.severity === severity).map((i) => i.code);

const loop = [
  { name: "Rounds", type: "repeat", count: 3, storeIndex: "RUNS", body: "Light", done: "End" },
  { name: "Light", type: "led", color: "green", timerStart: "lap", next: "Press" },
  { name: "Press", type: "button", timerStop: "lap", next: "Rounds" },
  { name: "End", type: "led", color: "off", next: "Rounds" },
];

describe("program format 2", () => {
  it("is the app's format", () => {
    expect(PROGRAM_FORMAT).toBeGreaterThanOrEqual(2);
  });

  it("programFormatOf: 1 without repeat and timers, 2 with either", () => {
    expect(programFormatOf({ blocks: [{ name: "A", type: "led", color: "red" }] })).toBe(1);
    expect(programFormatOf({ blocks: [{ name: "A", type: "repeat", count: 2 }] })).toBe(2);
    expect(programFormatOf({ blocks: [{ name: "A", type: "delay", ms: 1, timerStop: "x" }] })).toBe(2);
    expect(programFormatOf({ blocks: [{ name: "A", type: "unknown", timerStart: "x" }] })).toBe(2);
    expect(programFormatOf({ name: "no blocks" })).toBe(1);
    expect(programFormatOf(null)).toBe(1);
    expect(programFormatOf("text")).toBe(1);
  });

  it("programFormatOf reads the blocks of includes in a resolved program", () => {
    const files: Record<string, string> = {
      [PATH]: JSON.stringify({ name: "T", include: [LIB], blocks: [{ name: "A", type: "led", color: "red", next: "R" }] }),
      [LIB]: JSON.stringify({ blocks: [{ name: "R", type: "repeat", count: 1 }] }),
    };
    const resolved = resolveProgram(PATH, (p) => files[p]);
    expect(programFormatOf(resolved.doc)).toBe(1);
    expect(programFormatOf(resolved)).toBe(2);
  });

  it("every block type carries the timer fields, level more, format 2", () => {
    for (const def of BLOCK_TYPES) {
      for (const timer of TIMER_FIELDS) expect(def.fields, def.type).toContain(timer);
    }
    expect(TIMER_FIELDS.map((f) => [f.name, f.level, f.minFormat])).toEqual([
      ["timerStart", "more", 2],
      ["timerStop", "more", 2],
    ]);
  });

  it("repeat: ports, fields and roles of programs.md §2", () => {
    const def = blockType("repeat")!;
    expect(def.ports).toEqual(["next", "body", "done"]);
    expect(def.minFormat).toBe(2);
    expect(def.waits).toBe(false);
    expect(def.fields.find((f) => f.name === "count")).toMatchObject({ kind: "value", required: true });
    expect(def.fields.find((f) => f.name === "storeIndex")).toMatchObject({ kind: "variable", level: "more" });
    expect(def.portRoles).toMatchObject({ body: "eachRound", done: "afterLast" });
  });

  it("field levels follow editor-ux.md §5", () => {
    const level = (type: string, field: string) => {
      const f = blockType(type)!.fields.find((x) => x.name === field)!;
      return f.group ? `${fieldLevel(f)}:${f.group}` : fieldLevel(f);
    };
    expect(level("led", "color")).toBe("essential");
    expect(level("delay", "minMs")).toBe("essential");
    expect(level("button", "timeoutMs")).toBe("switch:timeLimit");
    expect(level("button", "maxTimeoutMs")).toBe("switch:timeLimit");
    expect(level("button", "record")).toBe("switch:record");
    expect(level("button", "shortMs")).toBe("switch:longPress");
    expect(level("button", "storeAs")).toBe("more");
    expect(level("remotePress", "pod")).toBe("essential");
    expect(level("remotePress", "mode")).toBe("switch:avoid");
    expect(level("remotePress", "colorAfter")).toBe("more");
    expect(level("remoteMultiPress", "avoidColor")).toBe("switch:avoid");
    expect(level("remoteMultiPress", "syncStartMs")).toBe("more");
    expect(level("remoteResetAll", "ledsOff")).toBe("more");
    expect(level("summary", "metric")).toBe("expert");
    expect(level("summary", "storeBest")).toBe("essential");
    expect(level("summary", "reset")).toBe("more");
    expect(level("repeat", "count")).toBe("essential");
    // a switch field always names its switch
    for (const def of BLOCK_TYPES) {
      for (const f of def.fields) expect(f.level === "switch", `${def.type}.${f.name}`).toBe(f.group !== undefined);
    }
  });

  it("every port has a role; avoid mode turns 'too slow' into 'left alone'", () => {
    for (const def of BLOCK_TYPES) for (const port of def.ports) expect(def.portRoles?.[port], `${def.type}.${port}`).toBeDefined();
    expect(portRole({ type: "button" }, "timeout")).toBe("ifTooSlow");
    expect(portRole({ type: "button" }, "long")).toBe("longPress");
    expect(portRole({ type: "remotePress" }, "timeout")).toBe("ifTooSlow");
    expect(portRole({ type: "remotePress", mode: "avoid" }, "timeout")).toBe("ifLeftAlone");
    expect(portRole({ type: "remoteMultiPress" }, "avoidHit")).toBe("ifRedHit");
    expect(portRole({ type: "if" }, "false")).toBe("ifNo");
    expect(portRole({ type: "nope" }, "next")).toBeUndefined();
  });
});

describe("validator, format 2", () => {
  it("accepts repeat and timers without issues", () => {
    expect(check(loop)).toEqual([]);
  });

  it("checks repeat fields", () => {
    expect(codes(check([{ name: "R", type: "repeat", next: "R" }]), "error")).toEqual(["missingField"]);
    expect(codes(check([{ name: "R", type: "repeat", count: 1.5, storeIndex: 3, next: "R" }]), "error")).toEqual(["notValue", "notText"]);
    expect(codes(check([{ name: "R", type: "repeat", count: "N", next: "R" }]), "warning")).toEqual(["unknownVariable"]);
  });

  it("warns when no path from body leads back to the repeat block", () => {
    const issues = check([
      { name: "R", type: "repeat", count: 2, body: "A", done: "B" },
      { name: "A", type: "led", color: "red" },
      { name: "B", type: "led", color: "red" },
    ]);
    expect(issues.filter((i) => i.code === "repeatNoLoop")).toEqual([
      { severity: "warning", code: "repeatNoLoop", file: PATH, block: "R", field: "body" },
    ]);
    // body falls back to next
    expect(codes(check([{ name: "R", type: "repeat", count: 2, next: "R" }]), "warning")).not.toContain("repeatNoLoop");
  });

  it("timer names must be non-empty text", () => {
    expect(codes(check([{ name: "A", type: "led", color: "red", timerStart: "", timerStop: 5 }]), "error")).toEqual(["notText", "notText"]);
  });

  it("warns about timers that are only started or only stopped", () => {
    const issues = check([
      { name: "A", type: "led", color: "red", timerStart: "a", next: "B" },
      { name: "B", type: "led", color: "red", timerStop: "b" },
    ]);
    expect(issues.filter((i) => i.code.startsWith("timer"))).toEqual([
      { severity: "warning", code: "timerNeverStopped", file: PATH, block: "A", field: "timerStart", params: { name: "a" } },
      { severity: "warning", code: "timerNeverStarted", file: PATH, block: "B", field: "timerStop", params: { name: "b" } },
    ]);
  });

  it("counts timer names of includes towards the limit of 16", () => {
    const blocks = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ name: `${prefix}${i}`, type: "led", color: "red", timerStart: `t${prefix}${i}`, timerStop: `t${prefix}${i}`, next: `${prefix}${i}` }));
    expect(codes(check(blocks("A", MAX_TIMERS)), "error")).toEqual([]);
    const issues = check(blocks("A", 10), { lib: blocks("L", 7) });
    expect(issues.filter((i) => i.code === "tooManyTimers")).toEqual([
      { severity: "error", code: "tooManyTimers", file: PATH, params: { count: 17, max: MAX_TIMERS } },
    ]);
  });

  it("a format-1 pod rejects repeat and ignores timer fields", () => {
    const issues = check(loop, { programFormat: 1 });
    expect(codes(issues, "error")).toEqual(["unsupportedType"]);
    expect(issues.filter((i) => i.code === "fieldNeedsFormat").map((i) => [i.block, i.field, i.params])).toEqual([
      ["Light", "timerStart", { field: "timerStart", format: 2 }],
      ["Press", "timerStop", { field: "timerStop", format: 2 }],
    ]);
    expect(check(loop, { programFormat: 2 })).toEqual([]);
    expect(codes(check(loop, { supportedTypes: ["led", "button"] }), "error")).toEqual(["unsupportedType"]);
  });
});

describe("JSON Schema, format 2", () => {
  const schema = buildProgramSchema();
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addKeyword("x-programFormat");
  const validate = ajv.compile(schema);

  it("declares the current format and accepts repeat and timers", () => {
    expect(schema["x-programFormat"]).toBe(4);
    expect(validate({ name: "T", blocks: loop }), ajv.errorsText(validate.errors)).toBe(true);
  });

  it("rejects a repeat without count and an empty timer name", () => {
    expect(validate({ name: "T", blocks: [{ name: "R", type: "repeat", body: "R" }] })).toBe(false);
    expect(validate({ name: "T", blocks: [{ name: "A", type: "led", color: "red", timerStart: "" }] })).toBe(false);
  });
});
