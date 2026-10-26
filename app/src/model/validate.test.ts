import { describe, expect, it } from "vitest";
import { DEFAULT_FILES } from "../defaults";
import { formatProgram } from "@reactpod/program-model";
import { MAX_FILE_SIZE } from "@reactpod/program-model";
import { hasErrors, resolveProgram, validateProgram, validateStore, type Issue } from "@reactpod/program-model";

const PATH = "/prog/test.json";

/** Validates one program (plus the shipped library) and returns its issues. */
function check(doc: Record<string, unknown>, extra: Record<string, string> = {}, supportedTypes?: string[]): Issue[] {
  const files: Record<string, string> = { ...DEFAULT_FILES, [PATH]: JSON.stringify(doc), ...extra };
  return validateProgram(PATH, (p) => files[p], { supportedTypes }).issues;
}

const codes = (issues: Issue[], severity: Issue["severity"] = "error") =>
  issues.filter((i) => i.severity === severity).map((i) => i.code);

const program = (blocks: unknown[], more: Record<string, unknown> = {}) => ({ version: 1, name: "Test", blocks, ...more });

describe("shipped programs", () => {
  const results = validateStore((p) => DEFAULT_FILES[p]);

  it("all programs in the menu are valid", () => {
    for (const [path, issues] of results) {
      expect(issues.filter((i) => i.severity === "error"), path).toEqual([]);
    }
    expect(results.size).toBe(13); // index + 12 programs
  });

  it("finds the same block counts as tools/validate_programs.py", () => {
    const expected: Record<string, number> = {
      "/prog/solo.json": 7,
      "/prog/weiche.json": 13,
      "/prog/dreieck.json": 14,
      "/prog/quadrat.json": 14,
      "/prog/stern.json": 13,
      "/prog/dreizack.json": 13,
      "/prog/run.json": 12,
      "/prog/run5.json": 12,
      "/prog/duo.json": 15,
    };
    for (const [path, count] of Object.entries(expected)) {
      expect(resolveProgram(path, (p) => DEFAULT_FILES[p]).blocks.length, path).toBe(count);
    }
  });

  it("loads includes before the program's own blocks and lets the program override variables", () => {
    const duo = resolveProgram("/prog/duo.json", (p) => DEFAULT_FILES[p]);
    expect(duo.blocks[0]!.file).toBe("/prog/lib/loop.json");
    expect(duo.blocks.at(-1)!.file).toBe("/prog/duo.json");
    expect(duo.variables.MAX_LOOPS).toBe(10); // loop.json says 12
    expect(duo.variables.RUNS).toBe(0);
  });
});

describe("validation errors", () => {
  it("unknown and unsupported block types", () => {
    expect(codes(check(program([{ name: "A", type: "buton" }])))).toContain("unknownType");
    expect(codes(check(program([{ name: "A", type: "led", color: "red" }]), {}, ["delay"]))).toContain("unsupportedType");
  });

  it("missing and malformed fields", () => {
    expect(codes(check(program([{ name: "A", type: "led" }])))).toContain("missingField");
    expect(codes(check(program([{ name: "A", type: "delay", ms: 1.5 }])))).toContain("notValue");
    expect(codes(check(program([{ name: "A", type: "delay" }])))).toContain("delayNeedsMs");
    expect(codes(check(program([{ name: "A", type: "delay", minMs: 1, maxMs: 2 }])))).toEqual([]);
    expect(codes(check(program([{ name: "A", type: "button", minTimeoutMs: 1 }])))).toContain("randomTimeoutPair");
    expect(codes(check(program([{ name: "A", type: "if", left: 1, right: 2, op: "=>" }])))).toContain("unknownOption");
    expect(codes(check(program([{ name: "A", type: "if", left: 1, right: 2, op: "=" }])))).toEqual([]); // alias
    expect(codes(check(program([{ name: "A", type: "summary", metric: "" }])))).toContain("notText");
    expect(codes(check(program([{ name: "A", type: "remoteResetAll", ledsOff: "yes" }])))).toContain("notBool");
  });

  it("colours", () => {
    expect(codes(check(program([{ name: "A", type: "led", color: "orange" }])))).toContain("invalidColor");
    expect(codes(check(program([{ name: "A", type: "led", color: "#FF8800" }])))).toEqual([]);
    expect(codes(check(program([{ name: "A", type: "remotePress", pod: 0, color: "#00FF00" }])))).toContain("notNamedColor");
  });

  it("LED indices", () => {
    expect(codes(check(program([{ name: "A", type: "led", color: "red", leds: [0, 18] }])))).toContain("ledOutOfRange");
    expect(codes(check(program([{ name: "A", type: "led", color: "red", leds: 3 }])))).toContain("ledsNotList");
    expect(codes(check(program([{ name: "A", type: "led", color: "red" }], { menu: [{ leds: [20], color: "blue" }] })))).toContain("menuInvalidLed");
    expect(codes(check(program([{ name: "A", type: "led", color: "red" }], { menu: [{ leds: [1], color: "pink" }] })))).toContain("menuInvalidColor");
  });

  it("ports, names and start", () => {
    expect(codes(check(program([{ name: "A", type: "delay", ms: 1, next: "Nope" }])))).toContain("portUnknownTarget");
    expect(codes(check(program([{ name: "A", type: "delay", ms: 1, next: 5 }])))).toContain("portNotText");
    expect(codes(check(program([{ name: "A", type: "delay", ms: 1 }, { name: "A", type: "delay", ms: 2 }])))).toContain("duplicateBlock");
    expect(codes(check(program([{ name: "A", type: "delay", ms: 1 }], { start: "B" })))).toContain("startNotFound");
    expect(codes(check(program([])))).toContain("noBlocks");
    expect(codes(check(program([{ type: "delay", ms: 1 }])))).toContain("blockNoNameOrType");
  });

  it("names clash with included blocks", () => {
    const issues = check(program([{ name: "EndLoop", type: "delay", ms: 1 }], { include: ["/prog/lib/loop.json"] }));
    expect(codes(issues)).toContain("duplicateBlock");
  });

  it("links to blocks of included files", () => {
    const issues = check(
      program([{ name: "EnterProgram", type: "delay", ms: 1, next: "EndLoop" }], { include: ["/prog/lib/loop.json"], start: "StartLoop" }),
    );
    expect(codes(issues)).toEqual([]);
  });

  it("program header", () => {
    expect(codes(check({ blocks: [{ name: "A", type: "delay", ms: 1 }] }))).toContain("nameMissing");
    expect(codes(check(program([{ name: "A", type: "delay", ms: 1 }], { peripherals: 8 })))).toContain("peripheralsRange");
    expect(codes(check(program([{ name: "A", type: "delay", ms: 1 }], { variables: { X: 1.5 } })))).toContain("variableNotInteger");
  });

  it("includes", () => {
    expect(codes(check(program([{ name: "A", type: "delay", ms: 1 }], { include: ["/prog/missing.json"] })))).toContain("fileNotFound");
    expect(codes(check(program([{ name: "A", type: "delay", ms: 1 }], { include: "/prog/lib/loop.json" })))).toContain("includeInvalid");
    const chain: Record<string, string> = {};
    for (let i = 1; i <= 4; i++) chain[`/prog/c${i}.json`] = JSON.stringify({ include: [`/prog/c${i + 1}.json`] });
    chain["/prog/c5.json"] = JSON.stringify({ blocks: [] });
    expect(codes(check(program([{ name: "A", type: "delay", ms: 1 }], { include: ["/prog/c1.json"] }), chain))).toContain("includeTooDeep");
    expect(codes(check(program([{ name: "A", type: "delay", ms: 1 }], { include: ["/prog/bad.json"] }), { "/prog/bad.json": "{ nope" }))).toContain("invalidJson");
  });

  it("file size and path", () => {
    const blocks = Array.from({ length: 400 }, (_, i) => ({ name: `Block${i}`, type: "delay", ms: 1000, next: `Block${i + 1}` }));
    blocks.at(-1)!.next = "Block0";
    const text = formatProgram(program(blocks));
    expect(text.length).toBeGreaterThan(MAX_FILE_SIZE);
    const issues = validateProgram(PATH, (p) => (p === PATH ? text : undefined)).issues;
    expect(codes(issues)).toContain("fileTooLarge");
    expect(codes(validateProgram("/prog/" + "x".repeat(30) + ".json", () => text).issues)).toContain("pathTooLong");
  });
});

describe("validation warnings", () => {
  it("block without outgoing connection (program ends)", () => {
    const issues = check(program([{ name: "A", type: "delay", ms: 1 }]));
    expect(codes(issues, "warning")).toContain("noOutgoing");
    expect(hasErrors(issues)).toBe(false);
  });

  it("unreachable blocks", () => {
    const issues = check(program([{ name: "A", type: "delay", ms: 1, next: "A" }, { name: "B", type: "delay", ms: 1, next: "A" }]));
    expect(issues.find((i) => i.code === "unreachable")?.block).toBe("B");
  });

  it("variables that are read but never declared or written", () => {
    const issues = check(program([{ name: "A", type: "delay", ms: "DELAY", next: "A" }]));
    expect(codes(issues, "warning")).toContain("unknownVariable");
    const declared = check(program([{ name: "A", type: "delay", ms: "DELAY", next: "A" }], { variables: { DELAY: 5 } }));
    expect(codes(declared, "warning")).toEqual([]);
    const builtin = check(program([{ name: "A", type: "remotePress", pod: "REQUIRED_PERIPHERALS", next: "A" }]));
    expect(codes(builtin, "warning")).toEqual([]);
  });

  it("unknown fields (typos the firmware would ignore)", () => {
    const issues = check(program([{ name: "A", type: "button", tiemout: "A", next: "A" }]));
    expect(issues.find((i) => i.code === "unknownField")?.field).toBe("tiemout");
  });
});

describe("store index", () => {
  it("reports menu entries that are missing or not programs", () => {
    const files: Record<string, string> = {
      "/programs.json": JSON.stringify({ programs: ["/prog/lib/loop.json", "/prog/gone.json", "/prog/lib/loop.json"] }),
      "/prog/lib/loop.json": DEFAULT_FILES["/prog/lib/loop.json"]!,
    };
    const results = validateStore((p) => files[p]);
    expect(codes(results.get("/programs.json")!)).toContain("indexNotProgram");
    expect(codes(results.get("/programs.json")!, "warning")).toContain("indexDuplicate");
    expect(codes(results.get("/prog/gone.json")!)).toContain("fileNotFound");
  });
});
