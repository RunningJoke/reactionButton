import { describe, expect, it } from "vitest";
import { hasErrors, validateProgram } from "@reactpod/program-model";
import { goIsRandom, holdPod, setChargeMode, setChargeStyle, setGoRandom, setHoldPod, setReleaseMode } from "./holdStep";
import { ownBlocks, type ProgramJson } from "./ops";
import { createStep } from "./stepRecipes";
import { setSwitch, switchState, switchesFor, timeoutAction } from "./switches";
import { countdownKind, hasCountdownTime, setCountdown } from "./countdown";

const doc = (blocks: ProgramJson["blocks"]): ProgramJson => ({ version: 1, name: "T", peripherals: 2, start: blocks![0]!.name, blocks });
const get = (d: ProgramJson, name: string) => ownBlocks(d).find((b) => b.name === name)!;
const valid = (d: ProgramJson) => !hasErrors(validateProgram("/prog/t.json", (p) => (p === "/prog/t.json" ? JSON.stringify(d) : undefined)).issues);

describe("charge step", () => {
  const base = doc([
    { name: "C", type: "charge", maxMs: 2000, next: "End" },
    { name: "End", type: "led", color: "off" },
  ]);

  it("pod: central is the default and leaves no field", () => {
    const withPod = setHoldPod(base, "C", 1);
    expect(get(withPod, "C").pod).toBe(1);
    expect(holdPod(get(withPod, "C"))).toBe(1);
    const back = setHoldPod(withPod, "C", "central");
    expect(get(back, "C").pod).toBeUndefined();
    expect(holdPod(get(back, "C"))).toBe("central");
  });

  it("style: the second colour goes when it is not colour shift", () => {
    let d = setChargeStyle(base, "C", "colorShift");
    d = { ...d, blocks: ownBlocks(d).map((b) => (b.name === "C" ? { ...b, color2: "blue" } : b)) };
    expect(get(setChargeStyle(d, "C", "brightness"), "C")).toMatchObject({ style: "brightness" });
    expect(get(setChargeStyle(d, "C", "brightness"), "C").color2).toBeUndefined();
    expect(get(setChargeStyle(d, "C", "fill"), "C").style).toBeUndefined();
  });

  it("accumulate keeps decayMs, release mode drops it", () => {
    let d = setChargeMode(base, "C", "accumulate");
    d = { ...d, blocks: ownBlocks(d).map((b) => (b.name === "C" ? { ...b, decayMs: 1500 } : b)) };
    expect(get(d, "C")).toMatchObject({ mode: "accumulate", decayMs: 1500 });
    const back = setChargeMode(d, "C", "release");
    expect(get(back, "C").mode).toBeUndefined();
    expect(get(back, "C").decayMs).toBeUndefined();
  });

  it("switches: time limit with a way for too slow, record, countdown over the limit", () => {
    const block = get(base, "C");
    expect(switchesFor(block)).toEqual(["timeLimit", "record"]);
    expect(hasCountdownTime(block)).toBe(false);
    expect(countdownKind(block)).toBe("limit");
    let d = setSwitch(base, "C", "timeLimit", true, { onTimeout: "countMiss" });
    expect(get(d, "C").timeoutMs).toBe(2000);
    expect(timeoutAction(d, "C")).toBe("countMiss");
    d = setCountdown(d, "C", "drain");
    expect(get(d, "C").countdown).toBe("drain");
    expect(valid(d)).toBe(true);
    d = setSwitch(d, "C", "timeLimit", false);
    expect(get(d, "C").timeoutMs).toBeUndefined();
    expect(get(d, "C").countdown).toBeUndefined();
    d = setSwitch(d, "C", "record", true);
    expect(switchState(get(d, "C"), "record")).toBe(true);
  });

  it("the add-step recipe gives a valid step", () => {
    const empty = doc([{ name: "A", type: "led", color: "green" }]);
    const added = createStep("charge", empty, "A");
    expect(get(added.doc, added.focus)).toMatchObject({ type: "charge", maxMs: 2000 });
    expect(get(added.doc, "A").next).toBe(added.focus);
    expect(valid(added.doc)).toBe(true);
  });
});

describe("release step", () => {
  const base = doc([
    { name: "R", type: "release", maxHoldMs: 4000, falseStart: undefined, next: "End" },
    { name: "End", type: "led", color: "off" },
  ]);

  it("trigger → signal moves the limit and adds a random go time; back removes the signal fields", () => {
    const signal = setReleaseMode(base, "R", "signal");
    expect(get(signal, "R")).toMatchObject({ mode: "signal", timeoutMs: 4000, minGoMs: 1500, maxGoMs: 3000 });
    expect(get(signal, "R").maxHoldMs).toBeUndefined();
    expect(valid(signal)).toBe(true);
    let d = setSwitch(signal, "R", "record", true);
    d = { ...d, blocks: ownBlocks(d).map((b) => (b.name === "R" ? { ...b, falseStart: "End" } : b)) };
    const back = setReleaseMode(d, "R", "trigger");
    expect(get(back, "R")).toMatchObject({ maxHoldMs: 4000 });
    for (const f of ["mode", "timeoutMs", "minGoMs", "maxGoMs", "record", "falseStart", "goColor"]) expect(get(back, "R")[f], f).toBeUndefined();
    expect(valid(back)).toBe(true);
  });

  it("switches follow the mode", () => {
    expect(switchesFor(get(base, "R"))).toEqual(["timeLimit"]);
    const signal = setReleaseMode(base, "R", "signal");
    expect(switchesFor(get(signal, "R"))).toEqual(["timeLimit", "record"]);
    expect(switchState(get(signal, "R"), "timeLimit")).toBe(true);
    const off = setSwitch(signal, "R", "timeLimit", false);
    expect(get(off, "R").timeoutMs).toBeUndefined();
    const on = setSwitch(setReleaseMode(setSwitch(base, "R", "timeLimit", false), "R", "trigger"), "R", "timeLimit", true);
    expect(get(on, "R").maxHoldMs).toBe(5000);
  });

  it("fixed or random time until the signal", () => {
    let d = setReleaseMode(base, "R", "signal");
    expect(goIsRandom(get(d, "R"))).toBe(true);
    d = setGoRandom(d, "R", false);
    expect(get(d, "R")).toMatchObject({ goMs: 1500 });
    expect(get(d, "R").minGoMs).toBeUndefined();
    expect(valid(d)).toBe(true);
    d = setGoRandom(d, "R", true);
    expect(get(d, "R")).toMatchObject({ minGoMs: 1500, maxGoMs: 3000 });
    expect(get(d, "R").goMs).toBeUndefined();
  });

  it("the add-step recipe gives a valid trigger step", () => {
    const empty = doc([{ name: "A", type: "led", color: "green" }]);
    const added = createStep("release", empty, "A");
    expect(get(added.doc, added.focus).type).toBe("release");
    expect(valid(added.doc)).toBe(true);
  });
});
