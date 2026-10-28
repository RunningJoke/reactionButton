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
    expect(PROGRAM_FORMAT).toBeGreaterThanOrEqual(3);
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

  describe("charge", () => {
    const charge = (fields: Record<string, unknown>, format?: number) =>
      validate([{ name: "C", type: "charge", maxMs: 2000, next: "L", ...fields }, LED], format);

    it("accepts a complete block, every style, pod values and all ports", () => {
      const issues = charge({
        pod: 2, onsetMs: 200, style: "colorShift", color: "green", color2: "red", mode: "release", timeoutMs: 5000,
        countdown: "drain", countdownColor: "red", record: "charge", storeAs: "CHARGE", storePercent: "PCT",
        released: "L", early: "L", full: "L", timeout: "L",
      });
      expect(issues).toEqual([{ severity: "warning", code: "noOutgoing", file: PATH, block: "L" }]);
      for (const style of ["fill", "brightness", "trafficLight", "colorShift"]) expect(errors(charge({ style }))).toEqual([]);
      for (const pod of ["central", 0, "WHO"]) expect(errors(charge({ pod }))).toEqual([]);
      expect(errors(charge({ mode: "accumulate", decayMs: 1000 }))).toEqual([]);
    });

    it("maxMs is required; style, mode and colour are checked", () => {
      expect(errors(validate([{ name: "C", type: "charge" }]))).toEqual(["missingField"]);
      expect(errors(charge({ style: "rainbow" }))).toEqual(["unknownOption"]);
      expect(errors(charge({ mode: "hold" }))).toEqual(["unknownOption"]);
      expect(errors(charge({ color: "#00ff00" }))).toEqual(["notNamedColor"]);
      expect(errors(charge({ pod: "all" }))).toEqual(["podSingleOnly"]);
      expect(errors(charge({ pod: "peripherals" }))).toEqual(["podSingleOnly"]);
    });

    it("maxMs below 1 is an error; a timeout of 0 or less is no time limit", () => {
      expect(errors(charge({ maxMs: 0 }))).toEqual(["maxMsTooSmall"]);
      expect(errors(charge({ maxMs: -5 }))).toEqual(["maxMsTooSmall"]);
      expect(errors(charge({ maxMs: "M" }))).toEqual([]);
      expect(errors(charge({ countdown: "fill", timeoutMs: 0 }))).toEqual(["countdownNeedsTimeLimit"]);
      expect(errors(charge({ countdown: "fill", timeoutMs: 0, minTimeoutMs: 100, maxTimeoutMs: 200 }))).toEqual([]);
      expect(errors(validate([{ name: "R", type: "release", countdown: "drain", maxHoldMs: 0, next: "L" }, LED]))).toEqual(["countdownNeedsTimeLimit"]);
    });

    it("decayMs only with accumulate", () => {
      expect(errors(charge({ decayMs: 500 }))).toEqual(["fieldWrongMode"]);
      expect(errors(charge({ mode: "release", decayMs: 500 }))).toEqual(["fieldWrongMode"]);
      const issue = charge({ decayMs: 500 }).find((i) => i.code === "fieldWrongMode");
      expect(issue).toMatchObject({ block: "C", field: "decayMs", params: { field: "decayMs", mode: "release", needs: "accumulate" } });
      expect(errors(charge({ mode: "accumulate", decayMs: 500 }))).toEqual([]);
    });

    it("countdown needs timeoutMs or a random pair; a lone min or max is an error", () => {
      expect(errors(charge({ countdown: "fill" }))).toEqual(["countdownNeedsTimeLimit"]);
      expect(errors(charge({ countdown: "secret" }))).toEqual([]);
      expect(errors(charge({ countdown: "fill", timeoutMs: 3000 }))).toEqual([]);
      expect(errors(charge({ countdown: "fill", minTimeoutMs: 1000, maxTimeoutMs: 2000 }))).toEqual([]);
      expect(errors(charge({ minTimeoutMs: 1000 }))).toEqual(["randomTimeoutPair"]);
      expect(warnings(charge({ minTimeoutMs: 3000, maxTimeoutMs: 1000 }))).toContain("rangeReversed");
    });

    it("needs program format 3", () => {
      for (const programFormat of [1, 2]) expect(errors(charge({}, programFormat))).toEqual(["unsupportedType"]);
      expect(errors(charge({}, 3))).toEqual([]);
    });

    it("format, field levels and port roles", () => {
      expect(programFormatOf({ blocks: [{ name: "A", type: "charge", maxMs: 1 }] })).toBe(3);
      const def = blockType("charge")!;
      const level = (name: string) => fieldLevel(def.fields.find((f) => f.name === name)!);
      expect(level("maxMs")).toBe("essential");
      expect(level("style")).toBe("essential");
      expect(level("onsetMs")).toBe("more");
      expect(level("timeoutMs")).toBe("switch");
      expect(level("record")).toBe("switch");
      expect(def.fields.find((f) => f.name === "timeoutMs")!.group).toBe("timeLimit");
      expect(def.ports).toEqual(["next", "released", "early", "full", "timeout"]);
      expect(portRole({ type: "charge" }, "released")).toBe("then");
      expect(portRole({ type: "charge" }, "early")).toBe("ifReleasedEarly");
      expect(portRole({ type: "charge" }, "full")).toBe("ifFull");
      expect(portRole({ type: "charge" }, "timeout")).toBe("ifTooSlow");
    });
  });

  describe("release", () => {
    const release = (fields: Record<string, unknown>, format?: number) =>
      validate([{ name: "R", type: "release", next: "L", ...fields }, LED], format);
    const signal = (fields: Record<string, unknown>) => release({ mode: "signal", goMs: 2000, ...fields });

    it("accepts trigger and signal blocks with all their fields", () => {
      const trigger = release({
        mode: "trigger", pod: 0, holdColor: "yellow", heldColor: "cyan", allowHeld: true, holdTimeoutMs: 5000,
        maxHoldMs: 10000, storeAs: "HOLD", noHold: "L", timeout: "L",
      });
      expect(trigger).toEqual([{ severity: "warning", code: "noOutgoing", file: PATH, block: "L" }]);
      expect(errors(release({}))).toEqual([]);
      const sig = signal({ pod: 1, goColor: "green", heldColor: "cyan", allowHeld: false, holdTimeoutMs: 4000, timeoutMs: 1000, record: "start", storeAs: "RT", noHold: "L", falseStart: "L", timeout: "L" });
      expect(errors(sig)).toEqual([]);
      expect(errors(release({ mode: "signal", minGoMs: 1500, maxGoMs: 3000 }))).toEqual([]);
      expect(errors(release({ mode: "signal", goMs: "GO" }))).toEqual([]);
    });

    it("checks mode and colours", () => {
      expect(errors(release({ mode: "go" }))).toEqual(["unknownOption"]);
      expect(errors(release({ holdColor: "#ffff00" }))).toEqual(["notNamedColor"]);
      expect(errors(signal({ goColor: [0, 255, 0] }))).toEqual(["notNamedColor"]);
      expect(errors(release({ allowHeld: "yes" }))).toEqual(["notBool"]);
      expect(errors(release({ pod: "all" }))).toEqual(["podSingleOnly"]);
    });

    it("trigger-only fields in signal mode and signal-only fields in trigger mode are errors", () => {
      expect(errors(signal({ maxHoldMs: 100 }))).toEqual(["fieldWrongMode"]);
      for (const field of ["goColor", "goMs", "minGoMs", "maxGoMs", "timeoutMs", "record"]) {
        const value = field === "record" ? "start" : field === "goColor" ? "green" : 100;
        const issues = release({ [field]: value });
        expect(errors(issues).filter((c) => c === "fieldWrongMode")).toEqual(["fieldWrongMode"]);
        expect(issues.find((i) => i.code === "fieldWrongMode")).toMatchObject({ field, params: { field, mode: "trigger", needs: "signal" } });
      }
      const wrong = signal({ maxHoldMs: 100 }).find((i) => i.code === "fieldWrongMode");
      expect(wrong).toMatchObject({ field: "maxHoldMs", params: { mode: "signal", needs: "trigger" } });
    });

    it("signal needs goMs or both minGoMs and maxGoMs, not both forms", () => {
      expect(errors(release({ mode: "signal" }))).toEqual(["signalNeedsGoTime"]);
      expect(errors(release({ mode: "signal", minGoMs: 1000 }))).toEqual(["signalNeedsGoTime"]);
      expect(errors(release({ mode: "signal", maxGoMs: 1000 }))).toEqual(["signalNeedsGoTime"]);
      expect(errors(release({ mode: "signal", goMs: 1000, minGoMs: 500, maxGoMs: 900 }))).toEqual(["goTimeBothForms"]);
      expect(errors(release({ mode: "signal", goMs: 1000, minGoMs: 500 }))).toEqual(["goTimeBothForms"]);
      expect(warnings(release({ mode: "signal", minGoMs: 3000, maxGoMs: 1000 }))).toContain("rangeReversed");
    });

    it("the falseStart port only exists in signal mode", () => {
      expect(errors(release({ falseStart: "L" }))).toEqual(["fieldWrongMode"]);
      expect(errors(release({ mode: "trigger", falseStart: "L" }))).toEqual(["fieldWrongMode"]);
      expect(errors(signal({ falseStart: "L" }))).toEqual([]);
      expect(release({ falseStart: "L" }).find((i) => i.code === "fieldWrongMode")).toMatchObject({
        field: "falseStart",
        params: { field: "falseStart", mode: "trigger", needs: "signal" },
      });
    });

    it("countdown needs maxHoldMs in trigger mode and timeoutMs in signal mode", () => {
      expect(errors(release({ countdown: "drain" }))).toEqual(["countdownNeedsTimeLimit"]);
      expect(errors(release({ countdown: "drain", maxHoldMs: 3000 }))).toEqual([]);
      expect(errors(release({ countdown: "secret" }))).toEqual([]);
      expect(errors(signal({ countdown: "drain" }))).toEqual(["countdownNeedsTimeLimit"]);
      expect(errors(signal({ countdown: "drain", timeoutMs: 800 }))).toEqual([]);
      const issue = release({ countdown: "drain" }).find((i) => i.code === "countdownNeedsTimeLimit");
      expect(issue?.params).toMatchObject({ countdown: "drain", limit: "maxHoldMs" });
    });

    it("needs program format 3", () => {
      for (const programFormat of [1, 2]) expect(errors(release({}, programFormat))).toEqual(["unsupportedType"]);
      expect(errors(release({}, 3))).toEqual([]);
    });

    it("format, field levels and port roles", () => {
      expect(programFormatOf({ blocks: [{ name: "A", type: "release" }] })).toBe(3);
      const def = blockType("release")!;
      const field = (name: string) => def.fields.find((f) => f.name === name)!;
      expect(fieldLevel(field("mode"))).toBe("essential");
      expect(fieldLevel(field("holdColor"))).toBe("essential");
      expect(fieldLevel(field("goMs"))).toBe("essential");
      expect(fieldLevel(field("heldColor"))).toBe("more");
      expect(fieldLevel(field("maxHoldMs"))).toBe("switch");
      expect(field("maxHoldMs").group).toBe("timeLimit");
      expect(field("timeoutMs").group).toBe("timeLimit");
      expect(field("maxHoldMs").onlyMode).toBe("trigger");
      expect(field("goColor").onlyMode).toBe("signal");
      expect(def.modes).toEqual({ field: "mode", default: "trigger" });
      expect(def.ports).toEqual(["next", "noHold", "falseStart", "timeout"]);
      expect(portRole({ type: "release" }, "noHold")).toBe("ifNoHold");
      expect(portRole({ type: "release" }, "falseStart")).toBe("ifFalseStart");
      expect(portRole({ type: "release" }, "timeout")).toBe("ifTooSlow");
    });
  });

  it("JSON schema accepts charge and release blocks and rejects bad ones", () => {
    const check = new Ajv2020({ strict: false }).compile(buildProgramSchema());
    const ok = {
      name: "T",
      blocks: [
        { name: "C", type: "charge", maxMs: 2000, style: "colorShift", color: "green", color2: "red", mode: "accumulate", decayMs: 500, released: "R" },
        { name: "R", type: "release", mode: "signal", minGoMs: 1500, maxGoMs: 3000, falseStart: "C" },
      ],
    };
    expect(check(ok)).toBe(true);
    expect(check({ name: "T", blocks: [{ name: "C", type: "charge" }] })).toBe(false);
    expect(check({ name: "T", blocks: [{ name: "C", type: "charge", maxMs: 1, style: "rainbow" }] })).toBe(false);
    expect(check({ name: "T", blocks: [{ name: "R", type: "release", mode: "go" }] })).toBe(false);
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
