import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { blockType, buildProgramSchema, fieldLevel, portRole, PROGRAM_FORMAT, programFormatOf, validateProgram, type Issue } from "./index";

const PATH = "/prog/t.json";

function validate(blocks: unknown[], programFormat?: number): Issue[] {
  const files: Record<string, string> = { [PATH]: JSON.stringify({ version: 1, name: "T", blocks }) };
  return validateProgram(PATH, (p) => files[p], { programFormat }).issues;
}
const errors = (issues: Issue[]) => issues.filter((i) => i.severity === "error").map((i) => i.code);
const warnings = (issues: Issue[]) => issues.filter((i) => i.severity === "warning").map((i) => i.code);

const LED = { name: "L", type: "led", color: "off" };
const effect = (fields: Record<string, unknown>, format?: number) =>
  validate([{ name: "E", type: "effect", effect: "pulse", next: "L", ...fields }, LED], format);
const delay = (fields: Record<string, unknown>, format?: number) =>
  validate([{ name: "D", type: "delay", ms: 3000, next: "L", ...fields }, LED], format);
const REQUIRED: Record<string, Record<string, unknown>> = { remotePress: { pod: 0 }, remoteMultiPress: { pods: 1 } };
const timed = (type: string, fields: Record<string, unknown>) =>
  validate([{ name: "B", type, ...REQUIRED[type], next: "L", ...fields }, LED]);

describe("program format 3", () => {
  it("is the app's format", () => {
    expect(PROGRAM_FORMAT).toBe(3);
  });

  it("programFormatOf: effect and countdown fields need 3", () => {
    expect(programFormatOf({ blocks: [{ name: "A", type: "effect", effect: "off" }] })).toBe(3);
    expect(programFormatOf({ blocks: [{ name: "A", type: "delay", ms: 1, countdown: "drain" }] })).toBe(3);
    expect(programFormatOf({ blocks: [{ name: "A", type: "delay", ms: 1, countdownFrom: "blue" }] })).toBe(3);
    expect(programFormatOf({ blocks: [{ name: "A", type: "repeat", count: 2 }] })).toBe(2);
    expect(programFormatOf({ blocks: [{ name: "A", type: "delay", ms: 1 }] })).toBe(1);
  });

  it("field levels and port roles", () => {
    const def = blockType("effect")!;
    const level = (name: string) => fieldLevel(def.fields.find((f) => f.name === name)!);
    expect(level("effect")).toBe("essential");
    expect(level("wait")).toBe("essential");
    expect(level("periodMs")).toBe("more");
    expect(portRole({ type: "effect" }, "next")).toBe("then");
    const press = blockType("remotePress")!.fields.find((f) => f.name === "countdown")!;
    expect(fieldLevel(press)).toBe("switch");
    expect(press.group).toBe("timeLimit");
    expect(fieldLevel(blockType("delay")!.fields.find((f) => f.name === "countdown")!)).toBe("more");
  });

  describe("effect", () => {
    it("accepts a complete block", () => {
      const issues = effect({ target: "all", color: "blue", color2: "off", durationMs: 2000, periodMs: 500, brightness: 200, syncStartMs: 20, wait: true });
      expect(issues).toEqual([{ severity: "warning", code: "noOutgoing", file: PATH, block: "L" }]);
    });

    it("accepts every effect, targets and variables", () => {
      for (const e of ["solid", "fill", "drain", "dim", "colorShift", "trafficLight", "blink", "pulse", "spin", "off"]) {
        expect(errors(effect({ effect: e }))).toEqual([]);
      }
      for (const target of ["central", "all", "peripherals", 2]) expect(errors(effect({ target }))).toEqual([]);
      expect(errors(effect({ target: "who", durationMs: "D" }))).toEqual([]);
      expect(warnings(effect({ target: "who" }))).toContain("unknownVariable");
      expect(errors(effect({ leds: [0, 1, 17] }))).toEqual([]);
    });

    it("needs a valid effect, named colours and valid values", () => {
      expect(errors(validate([{ name: "E", type: "effect" }]))).toEqual(["missingField"]);
      expect(errors(effect({ effect: "level" }))).toEqual(["unknownOption"]);
      expect(errors(effect({ effect: "none" }))).toEqual(["unknownOption"]);
      expect(errors(effect({ color: "#ff0000" }))).toEqual(["notNamedColor"]);
      expect(errors(effect({ color2: [1, 2, 3] }))).toEqual(["notNamedColor"]);
      expect(errors(effect({ target: 1.5 }))).toEqual(["notValue"]);
      expect(errors(effect({ durationMs: true }))).toEqual(["notValue"]);
      expect(errors(effect({ leds: [18] }))).toEqual(["ledOutOfRange"]);
      expect(errors(effect({ wait: "yes" }))).toEqual(["notBool"]);
    });

    it("wait with an endless effect (blink, pulse, spin without a duration > 0) is an error", () => {
      for (const e of ["blink", "pulse", "spin"]) {
        expect(errors(effect({ effect: e, wait: true }))).toEqual(["effectWaitEndless"]);
        expect(errors(effect({ effect: e, wait: true, durationMs: 0 }))).toEqual(["effectWaitEndless"]);
        expect(errors(effect({ effect: e, wait: true, durationMs: -5 }))).toEqual(["effectWaitEndless"]);
        expect(errors(effect({ effect: e, wait: true, durationMs: 1000 }))).toEqual([]);
        expect(errors(effect({ effect: e, wait: true, durationMs: "D" }))).toEqual([]);
        expect(errors(effect({ effect: e, wait: false }))).toEqual([]);
        expect(errors(effect({ effect: e }))).toEqual([]);
      }
      for (const e of ["solid", "fill", "drain", "dim", "colorShift", "trafficLight", "off"]) {
        expect(errors(effect({ effect: e, wait: true }))).toEqual([]);
      }
    });

    it("is rejected by a pod with program format 2, accepted by 3", () => {
      expect(errors(effect({}, 2))).toEqual(["unsupportedType"]);
      expect(errors(effect({}, 3))).toEqual([]);
      expect(errors(effect({}))).toEqual([]);
    });
  });

  describe("countdown", () => {
    it("is valid on delay with every style and target", () => {
      for (const countdown of ["secret", "drain", "fill", "dim", "colorShift", "trafficLight"]) {
        expect(errors(delay({ countdown, countdownColor: "red", countdownFrom: "green", countdownTarget: "all" }))).toEqual([]);
      }
      expect(errors(delay({ countdown: "drain", countdownTarget: 2 }))).toEqual([]);
      expect(errors(delay({ countdown: "blink" }))).toEqual(["unknownOption"]);
      expect(errors(delay({ countdownColor: "#ff0000" }))).toEqual(["notNamedColor"]);
      expect(errors(delay({ countdownFrom: "purple" }))).toEqual(["notNamedColor"]);
    });

    it("needs a time limit on button, remotePress and remoteMultiPress", () => {
      for (const type of ["button", "remotePress", "remoteMultiPress"]) {
        expect(errors(timed(type, { countdown: "drain" }))).toEqual(["countdownNeedsTimeLimit"]);
        expect(errors(timed(type, { countdown: "secret" }))).toEqual([]);
        expect(errors(timed(type, {}))).toEqual([]);
        expect(errors(timed(type, { countdown: "drain", timeoutMs: 1500 }))).toEqual([]);
      }
      expect(errors(timed("button", { countdown: "fill", minTimeoutMs: 1000, maxTimeoutMs: 2000 }))).toEqual([]);
      expect(errors(timed("button", { countdown: "fill", minTimeoutMs: 1000 }))).toContain("countdownNeedsTimeLimit");
    });

    it("countdownFrom belongs to delay and button only", () => {
      expect(warnings(timed("button", { countdown: "drain", timeoutMs: 100, countdownFrom: "blue" }))).not.toContain("unknownField");
      expect(warnings(timed("remotePress", { countdown: "drain", timeoutMs: 100, countdownFrom: "blue" }))).toContain("unknownField");
    });

    it("countdownTarget only on delay", () => {
      const issues = timed("button", { timeoutMs: 100, countdown: "drain", countdownTarget: "all" });
      expect(errors(issues)).toEqual(["countdownTargetNotDelay"]);
      expect(warnings(issues)).not.toContain("unknownField");
    });

    it("pods with an older format reject the fields; old programs stay valid", () => {
      for (const programFormat of [1, 2]) {
        expect(errors(delay({ countdown: "drain" }, programFormat))).toEqual(["fieldFormatTooOld"]);
        expect(errors(delay({}, programFormat))).toEqual([]);
      }
      expect(errors(delay({ countdown: "drain" }, 3))).toEqual([]);
      const loop = [{ name: "R", type: "repeat", count: 2, body: "L", timerStart: "x" }, { ...LED, color: "red", timerStop: "x" }];
      expect(errors(validate(loop, 3))).toEqual([]);
      expect(errors(validate(loop, 2))).toEqual([]);
    });
  });

  it("JSON schema accepts effect and countdown fields and rejects bad ones", () => {
    const check = new Ajv2020({ strict: false }).compile(buildProgramSchema());
    const ok = {
      name: "T",
      blocks: [
        { name: "E", type: "effect", effect: "pulse", target: "all", color: "blue", wait: true, durationMs: 100, leds: [1], next: "D" },
        { name: "D", type: "delay", ms: 1, countdown: "drain", countdownTarget: 2, countdownFrom: "blue" },
      ],
    };
    expect(check(ok)).toBe(true);
    expect(check({ name: "T", blocks: [{ name: "E", type: "effect", effect: "level" }] })).toBe(false);
    expect(check({ name: "T", blocks: [{ name: "E", type: "effect", effect: "off", target: "elsewhere!" }] })).toBe(false);
  });
});
