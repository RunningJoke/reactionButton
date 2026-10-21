import { describe, expect, it } from "vitest";
import { DEFAULT_FILES } from "../defaults";
import { resolveProgram } from "@reactpod/program-model";
import { detectLoops, flatProgram, stepFamily, stepList, stepNeighbours, type Step } from "./structure";
import type { ProgramJson } from "./ops";

const PROGRAMS = Object.keys(DEFAULT_FILES).filter((p) => p.startsWith("/prog/") && !p.startsWith("/prog/lib/"));
const LIBRARY = Object.keys(DEFAULT_FILES).filter((p) => p.startsWith("/prog/lib/"));

function flat(path: string): ProgramJson {
  const resolved = resolveProgram(path, (p) => DEFAULT_FILES[p]);
  const doc = resolved.doc!;
  return flatProgram(doc, resolved.blocks.map((b) => b.block), typeof doc.start === "string" ? doc.start : null);
}

const view = (steps: Step[]) => steps.map((s) => `${"  ".repeat(s.depth)}${s.loop ? "[repeat]" : s.number} ${s.block}`);

describe("step list of the shipped programs", () => {
  it("covers every shipped program and library part", () => {
    expect(PROGRAMS.length).toBeGreaterThanOrEqual(9);
    expect(LIBRARY).toEqual(expect.arrayContaining(["/prog/lib/loop.json", "/prog/lib/star.json", "/prog/lib/random.json", "/prog/lib/multi.json"]));
  });

  for (const path of PROGRAMS) {
    it(`lists every block of ${path} once`, () => {
      const program = flat(path);
      const steps = stepList(program);
      const loops = detectLoops(program);
      const hidden = loops.flatMap((l) => l.hidden);
      const listed = steps.filter((s) => !s.loop).map((s) => s.block);
      const names = (program.blocks as { name: string }[]).map((b) => b.name);
      // each block is a step or part of a Repeat bracket, never both, never twice
      expect(new Set(listed).size).toBe(listed.length);
      expect([...listed, ...hidden].sort()).toEqual([...names].sort());
      // numbers are unique and nothing is unreachable in a shipped program
      const numbers = steps.filter((s) => !s.loop).map((s) => s.number);
      expect(new Set(numbers).size).toBe(numbers.length);
      expect(steps.filter((s) => s.unreachable)).toEqual([]);
    });
  }

  it("shows solo as a list with the false start as a branch", () => {
    const steps = stepList(flat("/prog/solo.json"));
    expect(view(steps)).toEqual(["1 Ready", "2 Wait", "  2.1 FalseStart", "3 Go", "4 Hit", "5 HitLED", "6 ShowResult"]);
    expect(steps[1]!.branches).toEqual([{ port: "pressed", role: "ifPressedEarly", target: "FalseStart" }]);
    // the false start rejoins further down, the last step goes back to the start: both jumps are named
    expect(steps[2]!.branches).toEqual([{ port: "next", role: "then", target: "ShowResult" }]);
    expect(steps[6]!.branches).toEqual([{ port: "next", role: "then", target: "Ready" }]);
    expect(detectLoops(flat("/prog/solo.json"))).toEqual([]);
  });

  it("shows stern as one Repeat bracket (lib/loop counter form)", () => {
    const program = flat("/prog/stern.json");
    const steps = stepList(program);
    expect(view(steps)).toEqual([
      "[repeat] EndLoop",
      "  1 EnterProgram",
      "  2 CentralOn",
      "  3 CentralPress",
      "  4 CentralOff",
      "  5 SelectPod",
      "  6 RemoteTarget",
      "7 StartReset",
      "8 Summary",
      "9 ResetDelay",
      "10 ClearLED",
    ]);
    const [loop] = detectLoops(program);
    expect(loop).toMatchObject({
      kind: "counter",
      head: "EndLoop",
      entry: "StartLoop",
      counterVar: "RUNS",
      countValue: "MAX_LOOPS",
      after: "StartReset",
      hidden: ["StartLoop", "EndLoop", "ResetRuns"],
      body: ["EnterProgram", "CentralOn", "CentralPress", "CentralOff", "SelectPod", "RemoteTarget"],
    });
    // inside the round the last step simply goes on with the next round: no jump shown
    expect(steps[6]!.branches).toEqual([]);
    // after the summary the program starts again
    expect(steps[10]!.branches).toEqual([{ port: "next", role: "then", target: "ResetRuns" }]);
  });

  it("shows run5 with the red-pod branch under its step", () => {
    const steps = stepList(flat("/prog/run5.json"));
    expect(view(steps).slice(0, 6)).toEqual(["[repeat] EndLoop", "  1 EnterProgram", "  2 ActivateAll", "    2.1 Fail", "    2.2 FailDelay", "  3 ResetAll"]);
    expect(steps[2]!.branches).toEqual([{ port: "avoidHit", role: "ifRedHit", target: "Fail" }]);
    expect(steps[3]).toMatchObject({ branchOf: { block: "ActivateAll", port: "avoidHit" }, inLoop: "EndLoop", depth: 2 });
    // Fail → FailDelay → ResetAll rejoins right after its fork: no jump
    expect(steps[4]!.branches).toEqual([]);
  });

  it("numbers both answers of a decision on", () => {
    const steps = stepList(flat("/prog/quadrat.json"));
    const decide = steps.find((s) => s.block === "IsCentral")!;
    expect(decide.branches.map((b) => b.role)).toEqual(["ifYes", "ifNo"]);
    expect(steps.filter((s) => s.branchOf?.block === "IsCentral").map((s) => `${s.number} ${s.block}`)).toEqual([
      "3.1 CentralOn",
      "3.2 CentralPress",
      "3.3 CentralOff",
      "3.4 RemoteTarget",
    ]);
  });

  it("shows misses as branches in duo", () => {
    const steps = stepList(flat("/prog/duo.json"));
    expect(steps.find((s) => s.block === "CentralPress")!.branches).toEqual([{ port: "timeout", role: "ifTooSlow", target: "CentralMiss" }]);
    expect(steps.find((s) => s.block === "RemoteMiss")).toMatchObject({ number: "6.1", branches: [] });
  });

  for (const path of LIBRARY) {
    it(`handles the library part ${path} on its own`, () => {
      const fragment = JSON.parse(DEFAULT_FILES[path]!) as ProgramJson;
      const steps = stepList(fragment);
      const names = (fragment.blocks as { name: string }[]).map((b) => b.name);
      const hidden = detectLoops(fragment).flatMap((l) => l.hidden);
      expect([...steps.filter((s) => !s.loop).map((s) => s.block), ...hidden].sort()).toEqual([...names].sort());
    });
  }

  it("finds the round counter of lib/loop.json only together with a round", () => {
    const loop = JSON.parse(DEFAULT_FILES["/prog/lib/loop.json"]!) as ProgramJson;
    // on its own the round (EnterProgram) is in another file, so it is not a loop yet
    expect(detectLoops(loop)).toEqual([]);
    const withRound = { ...loop, blocks: [...(loop.blocks as ProgramJson[]), { name: "EnterProgram", type: "delay", ms: 100, next: "EndLoop" }] };
    expect(detectLoops(withRound)).toEqual([
      expect.objectContaining({ kind: "counter", head: "EndLoop", entry: "StartLoop", countValue: "MAX_LOOPS", after: "StartReset", body: ["EnterProgram"] }),
    ]);
  });
});

describe("repeat block (program format 2)", () => {
  const repeatProgram: ProgramJson = {
    version: 1,
    name: "R",
    start: "Rounds",
    variables: { ROUNDS: 5, MISSES: 0 },
    blocks: [
      { name: "Rounds", type: "repeat", count: "ROUNDS", storeIndex: "RUNS", body: "Pause", done: "Results" },
      { name: "Pause", type: "delay", minMs: 1000, maxMs: 3000, next: "Light" },
      { name: "Light", type: "led", color: "green", next: "Press" },
      { name: "Press", type: "button", pressed: "Off", timeoutMs: 2000, timeout: "Miss", record: "reaction" },
      { name: "Miss", type: "setVariable", var: "MISSES", op: "+", value: 1, next: "Rounds" },
      { name: "Off", type: "led", color: "off", next: "Rounds" },
      { name: "Results", type: "summary", metric: "reaction", storeAverage: "AVG" },
    ],
  };

  it("is one bracket with the round inside", () => {
    const steps = stepList(repeatProgram);
    expect(view(steps)).toEqual(["[repeat] Rounds", "  1 Pause", "  2 Light", "  3 Press", "    3.1 Miss", "  4 Off", "5 Results"]);
    expect(detectLoops(repeatProgram)).toEqual([
      { kind: "repeat", head: "Rounds", entry: "Rounds", counterVar: "RUNS", countValue: "ROUNDS", body: ["Pause", "Light", "Press", "Miss", "Off"], after: "Results", hidden: ["Rounds"] },
    ]);
    // a miss ends the round early: "go on with the next round" is a jump, but going back is the natural end
    expect(steps.find((s) => s.block === "Miss")!.branches).toEqual([{ port: "next", role: "then", target: "Rounds" }]);
    expect(steps.find((s) => s.block === "Off")!.branches).toEqual([]);
  });

  it("shows the same bracket as the counter form", () => {
    const counter: ProgramJson = {
      ...repeatProgram,
      start: "Count",
      blocks: [
        { name: "Count", type: "setVariable", var: "RUNS", op: "+", value: 1, next: "Pause" },
        ...(repeatProgram.blocks as ProgramJson[]).slice(1, 4),
        { name: "Miss", type: "setVariable", var: "MISSES", op: "+", value: 1, next: "End" },
        { name: "Off", type: "led", color: "off", next: "End" },
        { name: "End", type: "if", left: "RUNS", op: ">=", right: "ROUNDS", true: "Results", false: "Count" },
        { name: "Results", type: "summary", metric: "reaction", storeAverage: "AVG" },
      ],
    };
    const a = stepList(repeatProgram).map((s) => [s.depth, s.number, s.loop ? "loop" : s.block]);
    const b = stepList(counter).map((s) => [s.depth, s.number, s.loop ? "loop" : s.block]);
    expect(b).toEqual(a);
    expect(detectLoops(counter)[0]).toMatchObject({ kind: "counter", countValue: "ROUNDS", body: ["Pause", "Light", "Press", "Miss", "Off"], after: "Results" });
  });

  it("nests repeats", () => {
    const nested: ProgramJson = {
      name: "N",
      start: "Outer",
      blocks: [
        { name: "Outer", type: "repeat", count: 2, body: "Inner", done: "End" },
        { name: "Inner", type: "repeat", count: 3, body: "Blink", done: "Outer" },
        { name: "Blink", type: "led", color: "red", next: "Inner" },
        { name: "End", type: "led", color: "off" },
      ],
    };
    expect(view(stepList(nested))).toEqual(["[repeat] Outer", "  [repeat] Inner", "    1 Blink", "2 End"]);
    expect(detectLoops(nested).map((l) => [l.head, l.body])).toEqual([
      ["Outer", ["Inner", "Blink"]],
      ["Inner", ["Blink"]],
    ]);
  });

  it("uses the fallback next when body and done are not connected", () => {
    const steps = stepList({ name: "F", start: "R", blocks: [{ name: "R", type: "repeat", count: 2, next: "A" }, { name: "A", type: "led", color: "red", next: "R" }] });
    expect(view(steps)).toEqual(["[repeat] R", "  1 A"]);
  });
});

describe("unconnected blocks and helpers", () => {
  it("lists blocks the start does not reach at the end", () => {
    const steps = stepList({ name: "U", start: "A", blocks: [{ name: "A", type: "led", color: "red" }, { name: "B", type: "delay", ms: 500, next: "C" }, { name: "C", type: "led", color: "off" }] });
    expect(steps.map((s) => [s.number, s.block, !!s.unreachable])).toEqual([
      ["1", "A", false],
      ["2", "B", true],
      ["3", "C", true],
    ]);
  });

  it("finds the family and the neighbours of a step", () => {
    const steps = stepList(flat("/prog/run5.json"));
    expect(stepFamily(steps, "ActivateAll")).toEqual(["ActivateAll", "Fail", "FailDelay"]);
    const n = stepNeighbours(steps, "ActivateAll");
    expect([n.before?.block, n.after?.block]).toEqual(["EnterProgram", "ResetAll"]);
    expect(stepNeighbours(steps, "Fail").before).toBeUndefined();
  });
});
