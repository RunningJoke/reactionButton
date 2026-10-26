import { describe, expect, it } from "vitest";
import { validateProgram, type Block, type SwitchId } from "@reactpod/program-model";
import { Simulator } from "../simulator/engine";
import { generateProgram } from "../wizard/generate";
import { defaultAnswers, setTimeLimit, normalizeAnswers } from "../wizard/answers";
import { ownBlocks, type ProgramJson } from "./ops";
import { isCatchEarly, stepList } from "./structure";
import { missVariable, setSwitch, switchesFor, switchState, timeoutAction } from "./switches";
import solo from "../../../firmware/data/prog/solo.json";

const PATH = "/prog/test.json";

function check(doc: ProgramJson) {
  return validateProgram(PATH, (p) => (p === PATH ? JSON.stringify(doc) : undefined), { programFormat: 2 });
}

function errors(doc: ProgramJson) {
  return check(doc).issues.filter((i) => i.severity === "error");
}

/** Runs the program a while, pressing every pod now and then: it must not stop or throw. */
function simulates(doc: ProgramJson) {
  const sim = new Simulator(check(doc), { seed: 3, logLimit: 10_000 });
  for (let i = 0; i < 40; i++) {
    expect(sim.advance(i % 3 === 0 ? 3000 : 400)).not.toBe("ended");
    for (const id of [sim.centralId, 0, 1, 2]) sim.press(id);
    sim.advance(30);
    for (const id of [sim.centralId, 0, 1, 2]) sim.release(id);
  }
}

const block = (doc: ProgramJson, name: string) => ownBlocks(doc).find((b) => b.name === name)!;
const freeze = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Fixtures: wizard programs in both loop forms, without the optional parts, plus solo.json. */
function fixtures(): { label: string; doc: ProgramJson }[] {
  const out: { label: string; doc: ProgramJson }[] = [];
  for (const form of ["repeat", "counter"] as const) {
    for (const game of ["solo", "star", "random", "multi", "duo"] as const) {
      let a = defaultAnswers(game, 3);
      a = normalizeAnswers({ ...setTimeLimit(a, false), redPods: 0, measure: { record: false, countMisses: false, results: false, falseStart: false } });
      out.push({ label: `${game}/${form}`, doc: generateProgram(a, form) });
    }
  }
  out.push({ label: "solo.json", doc: freeze(solo) as ProgramJson });
  return out;
}

const SWITCHES: SwitchId[] = ["randomPause", "timeLimit", "record", "longPress", "avoid", "falseStart"];

describe("switchesFor", () => {
  it("lists the switches per block type", () => {
    expect(switchesFor({ name: "a", type: "delay", ms: 1 })).toEqual(["randomPause", "falseStart"]);
    expect(switchesFor({ name: "a", type: "button" })).toEqual(["timeLimit", "record", "longPress"]);
    expect(switchesFor({ name: "a", type: "button", minTimeoutMs: 1, maxTimeoutMs: 2, timeout: "x" })).toEqual(["randomPause", "falseStart"]);
    expect(switchesFor({ name: "a", type: "remotePress", pod: 0 })).toEqual(["avoid", "timeLimit", "record"]);
    expect(switchesFor({ name: "a", type: "remotePress", pod: 0, mode: "avoid" })).toEqual(["avoid", "timeLimit"]);
    expect(switchesFor({ name: "a", type: "remoteMultiPress" })).toEqual(["avoid", "timeLimit", "record"]);
    expect(switchesFor({ name: "a", type: "led", color: "red" })).toEqual([]);
  });
});

describe("every switch on every block it applies to", () => {
  for (const { label, doc } of fixtures()) {
    it(`${label}: on, off and back; validates and simulates`, () => {
      const original = freeze(doc);
      const baseErrors = errors(doc).length;
      expect(baseErrors).toBe(0);
      for (const b of ownBlocks(doc)) {
        for (const id of switchesFor(b)) {
          const was = switchState(b, id);
          const on = setSwitch(doc, b.name, id, !was);
          expect(doc, `${b.name} ${id} is pure`).toEqual(original);
          expect(switchState(block(on, b.name), id), `${label} ${b.name} ${id}`).toBe(!was);
          expect(errors(on), `${label} ${b.name} ${id} → ${!was}`).toEqual([]);
          simulates(on);
          const back = setSwitch(on, b.name, id, was);
          expect(switchState(block(back, b.name), id)).toBe(was);
          expect(errors(back)).toEqual([]);
          // on → off gives the program back (off → on builds a new branch, not the old one)
          if (!was && !(id === "avoid" && b.type === "remotePress")) expect(back, `${label} ${b.name} ${id} round trip`).toEqual(original);
        }
      }
    });
  }

  it("ignores switches that do not apply and unknown blocks", () => {
    const doc = fixtures()[0]!.doc;
    for (const id of SWITCHES) expect(setSwitch(doc, "nope", id, true)).toBe(doc);
    expect(setSwitch(doc, "ResetDelay", "timeLimit", true)).toBe(doc);
    expect(setSwitch(doc, "Ready", "record", true)).toBe(doc);
  });
});

const star = () => generateProgram(normalizeAnswers({ ...setTimeLimit(defaultAnswers("star", 3), false), measure: { record: false, countMisses: false, results: false, falseStart: false } }), "repeat");

describe("time limit", () => {
  it("goes on by default and takes the time limit already used", () => {
    let doc = star();
    doc = setSwitch(doc, "PodTarget", "timeLimit", true);
    expect(block(doc, "PodTarget").timeoutMs).toBe(2000);
    expect(timeoutAction(doc, "PodTarget")).toBe("goOn");
    doc = setSwitch(doc, "PodTarget", "timeoutMs" as never, true); // not a switch: unchanged
    const doc2 = setSwitch({ ...doc, blocks: ownBlocks(doc).map((b) => (b.name === "PodTarget" ? { ...b, timeoutMs: 1500 } : b)) }, "CentralPress", "timeLimit", true);
    expect(block(doc2, "CentralPress").timeoutMs).toBe(1500);
    expect(block(doc2, "CentralPress").timeout).toBe("CentralOff");
  });

  it("uses TIME_LIMIT_MS when the program has it", () => {
    const doc = { ...star(), variables: { ...(star().variables as object), TIME_LIMIT_MS: 3000 } };
    expect(block(setSwitch(doc, "PodTarget", "timeLimit", true), "PodTarget").timeoutMs).toBe("TIME_LIMIT_MS");
  });

  it("counts a miss: adds the counter and MISSES, off removes both", () => {
    const original = star();
    const doc = setSwitch(original, "CentralPress", "timeLimit", true, { onTimeout: "countMiss" });
    expect(timeoutAction(doc, "CentralPress")).toBe("countMiss");
    expect(missVariable(doc, "CentralPress")).toBe("MISSES");
    const miss = block(doc, block(doc, "CentralPress").timeout as string);
    expect(miss).toMatchObject({ type: "setVariable", var: "MISSES", op: "+", value: 1, next: "CentralOff" });
    expect((doc.variables as Record<string, number>).MISSES).toBe(0);
    // the round's step list shows it as a branch of the press
    const step = stepList(doc).find((s) => s.block === "CentralPress")!;
    expect(step.branches.map((b) => b.role)).toEqual(["ifTooSlow"]);
    const off = setSwitch(doc, "CentralPress", "timeLimit", false);
    expect(off).toEqual(original);
  });

  it("counts a miss by default when the program has a miss counter", () => {
    const doc = { ...star(), variables: { ...(star().variables as object), MISSES: 0 } };
    expect(timeoutAction(setSwitch(doc, "PodTarget", "timeLimit", true), "PodTarget")).toBe("countMiss");
  });

  it("ends the round: links to the loop head in both forms", () => {
    const repeat = setSwitch(star(), "CentralPress", "timeLimit", true, { onTimeout: "endRound" });
    expect(block(repeat, "CentralPress").timeout).toBe("Rounds");
    expect(timeoutAction(repeat, "CentralPress")).toBe("endRound");
    // the last step of the round: going on is the same as ending the round
    expect(block(setSwitch(star(), "PodTarget", "timeLimit", true, { onTimeout: "endRound" }), "PodTarget").timeout).toBe("Rounds");
    const counterDoc = generateProgram(normalizeAnswers({ ...setTimeLimit(defaultAnswers("star", 3), false), measure: { record: false, countMisses: false, results: false, falseStart: false } }), "counter");
    const counter = setSwitch(counterDoc, "CentralPress", "timeLimit", true, { onTimeout: "endRound" });
    expect(block(counter, "CentralPress").timeout).toBe("EndLoop");
  });

  it("changes what happens without losing the time", () => {
    let doc = setSwitch(star(), "PodTarget", "timeLimit", true, { onTimeout: "countMiss" });
    doc = setSwitch(doc, "PodTarget", "timeLimit", true, { onTimeout: "goOn" });
    expect(timeoutAction(doc, "PodTarget")).toBe("goOn");
    expect(ownBlocks(doc).some((b) => b.type === "setVariable" && b.var === "MISSES")).toBe(false);
    expect(doc.variables).toEqual(star().variables);
  });

  it("keeps a branch block that something else also uses", () => {
    let doc = setSwitch(star(), "PodTarget", "timeLimit", true, { onTimeout: "countMiss" });
    const miss = block(doc, "PodTarget").timeout as string;
    doc = { ...doc, blocks: ownBlocks(doc).map((b) => (b.name === "CentralPress" ? { ...b, timeoutMs: 1000, timeout: miss } : b)) };
    const off = setSwitch(doc, "PodTarget", "timeLimit", false);
    expect(ownBlocks(off).some((b) => b.name === miss)).toBe(true);
  });
});

describe("other switches", () => {
  it("record uses the program's metric", () => {
    const doc = { ...star(), blocks: [...ownBlocks(star()), { name: "Sum", type: "summary", metric: "speed" } as Block] };
    expect(block(setSwitch(doc, "PodTarget", "record", true), "PodTarget").record).toBe("speed");
    expect(block(setSwitch(star(), "PodTarget", "record", true), "PodTarget").record).toBe("reaction");
  });

  it("long press moves `pressed` to `short` and skips to the next round", () => {
    const doc = setSwitch(star(), "CentralPress", "longPress", true);
    expect(block(doc, "CentralPress")).toMatchObject({ short: "CentralOff", long: "Rounds", shortMs: 1000 });
    expect(block(doc, "CentralPress").pressed).toBeUndefined();
    expect(setSwitch(doc, "CentralPress", "longPress", false)).toEqual(star());
  });

  it("red pods add a red flash branch back to the round", () => {
    const multi = generateProgram(normalizeAnswers({ ...setTimeLimit(defaultAnswers("multi", 3), false), redPods: 0, measure: { record: false, countMisses: false, results: false, falseStart: false } }), "repeat");
    const doc = setSwitch(multi, "AllAtOnce", "avoid", true, { onTimeout: "countMiss" });
    const b = block(doc, "AllAtOnce");
    expect(b.avoid).toBe(1);
    const red = block(doc, b.avoidHit as string);
    expect(red).toMatchObject({ type: "led", color: "red" });
    expect(ownBlocks(doc).some((x) => x.type === "setVariable" && x.var === "MISSES")).toBe(true);
    expect(setSwitch(doc, "AllAtOnce", "avoid", false)).toEqual(multi);
  });

  it("don't touch on a pod: avoid mode with a time limit", () => {
    const doc = setSwitch(star(), "PodTarget", "avoid", true);
    expect(block(doc, "PodTarget")).toMatchObject({ mode: "avoid", timeoutMs: 2000 });
    expect(block(setSwitch(doc, "PodTarget", "avoid", false), "PodTarget").mode).toBeUndefined();
  });

  it("catch early presses turns the pause into the solo.json pattern and back", () => {
    const original = star();
    const doc = setSwitch(original, "Pause", "falseStart", true);
    const b = block(doc, "Pause");
    expect(isCatchEarly(b)).toBe(true);
    expect(b).toMatchObject({ type: "button", minTimeoutMs: "PAUSE_MIN_MS", maxTimeoutMs: "PAUSE_MAX_MS", timeout: "CentralOn" });
    const flash = block(doc, b.pressed as string);
    expect(flash).toMatchObject({ type: "led", color: "red" });
    expect(stepList(doc).find((s) => s.block === "Pause")!.branches.map((x) => x.role)).toEqual(["ifPressedEarly"]);
    expect(setSwitch(doc, "Pause", "falseStart", false)).toEqual(original);
  });

  it("random pause: fixed ↔ random", () => {
    const doc: ProgramJson = { version: 1, name: "x", start: "W", blocks: [{ name: "W", type: "delay", ms: 1500, next: "W" }] };
    const on = setSwitch(doc, "W", "randomPause", true);
    expect(block(on, "W")).toMatchObject({ minMs: 1500, maxMs: 3000 });
    expect(setSwitch(on, "W", "randomPause", false)).toEqual(doc);
    const early = setSwitch(doc, "W", "falseStart", true);
    expect(switchState(block(early, "W"), "randomPause")).toBe(false);
    const randomEarly = setSwitch(early, "W", "randomPause", true);
    expect(block(randomEarly, "W")).toMatchObject({ minTimeoutMs: 1500, maxTimeoutMs: 3000 });
  });
});
