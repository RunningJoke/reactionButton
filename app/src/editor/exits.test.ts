import { describe, expect, it } from "vitest";
import { validateProgram, type Block } from "@reactpod/program-model";
import { exitChoices, exitValue, instantLoop, naturalNext, setExit } from "./exits";
import { ownBlocks, type ProgramJson } from "./ops";
import { stepList } from "./structure";

const prog = (blocks: Block[], extra: ProgramJson = {}): ProgramJson => ({ version: 1, name: "t", start: blocks[0]!.name, blocks, ...extra });
const block = (doc: ProgramJson, name: string) => ownBlocks(doc).find((b) => b.name === name)!;
const errors = (doc: ProgramJson) => validateProgram("/prog/t.json", (p) => (p === "/prog/t.json" ? JSON.stringify(doc) : undefined), { programFormat: 6 }).issues.filter((i) => i.severity === "error");

/** A round of three presses with a time-out exit, inside a Repeat. */
const rounds = (): ProgramJson =>
  prog(
    [
      { name: "Rounds", type: "repeat", count: 3, body: "Pause", done: "End" },
      { name: "Pause", type: "delay", ms: 1000, next: "Press" },
      { name: "Press", type: "button", timeoutMs: 2000, pressed: "Good", timeout: "Late" },
      { name: "Good", type: "led", color: "green", next: "Rounds" },
      { name: "Late", type: "led", color: "red", next: "Rounds" },
      { name: "End", type: "led", color: "blue" },
    ],
    { variables: {} },
  );

const value = (doc: ProgramJson, name: string, port: string) => exitValue(new Map(ownBlocks(doc).map((b) => [b.name, b])), stepList(doc), block(doc, name), port);
const set = (doc: ProgramJson, name: string, port: string, choice: Parameters<typeof setExit>[4]) => setExit(doc, stepList(doc), name, port, choice);

describe("exit value", () => {
  it("reads next step, a step and the loop exits", () => {
    const doc = rounds();
    expect(value(doc, "Press", "timeout")).toEqual({ kind: "step", target: "Late" });
    expect(value(doc, "Press", "pressed")).toEqual({ kind: "next" });
    // the last step of the round goes to the loop head: that is "next", not a jump
    expect(value(doc, "Good", "next")).toEqual({ kind: "next" });
    expect(value(set(doc, "Press", "timeout", { kind: "nextRound" }), "Press", "timeout")).toEqual({ kind: "nextRound" });
    expect(value(set(doc, "Press", "timeout", { kind: "leave" }), "Press", "timeout")).toEqual({ kind: "leave" });
  });

  it("an unconnected exit falls back to next only where the engine does", () => {
    const doc = prog([{ name: "R", type: "release", next: "End", noHold: "End" }, { name: "End", type: "led", color: "red" }]);
    expect(value(doc, "R", "noHold")).toEqual({ kind: "next" });
    const open = prog([{ name: "R", type: "release", next: "End" }, { name: "End", type: "led", color: "red" }]);
    expect(value(open, "R", "noHold")).toEqual({ kind: "next" });
    const game = prog([{ name: "G", type: "toggle", durationMs: 1000, next: "End" }, { name: "End", type: "led", color: "red" }]);
    expect(value(game, "G", "allA")).toEqual({ kind: "none" }); // the game goes on
    const decide = prog([{ name: "I", type: "if", left: 1, right: 1 }]);
    expect(value(decide, "I", "true")).toEqual({ kind: "none" });
  });
});

describe("setting an exit", () => {
  it("count a miss adds the counter, next removes it again", () => {
    const original = rounds();
    const counted = set(original, "Press", "timeout", { kind: "countMiss" });
    expect(value(counted, "Press", "timeout")).toEqual({ kind: "countMiss" });
    expect(ownBlocks(counted).some((b) => b.name === "Late")).toBe(false); // only the time-out led there
    expect(errors(counted)).toEqual([]);
    const back = set(counted, "Press", "timeout", { kind: "next" });
    expect(value(back, "Press", "timeout")).toEqual({ kind: "next" });
    expect(ownBlocks(back).some((b) => b.type === "setVariable")).toBe(false);
    expect(block(back, "Press").timeout).toBe("Good"); // no `next` on a button: link to where it goes on
  });

  it("a step: names the target, keeps the others", () => {
    const doc = rounds();
    const to = set(doc, "Press", "timeout", { kind: "step", target: "Good" });
    expect(block(to, "Press").timeout).toBe("Good");
    expect(value(to, "Press", "timeout")).toEqual({ kind: "next" }); // it is where the main exit goes
    expect(ownBlocks(to).some((b) => b.name === "Late")).toBe(false);
  });

  it("next removes the link where the engine falls back", () => {
    const doc = prog([{ name: "R", type: "release", next: "End", noHold: "Other" }, { name: "End", type: "led", color: "red" }, { name: "Other", type: "led", color: "blue" }]);
    const next = set(doc, "R", "noHold", { kind: "next" });
    expect(block(next, "R").noHold).toBeUndefined();
    expect(ownBlocks(next).map((b) => b.name)).toEqual(["R", "End"]);
  });

  it("the main exit: a jump back, then next step again", () => {
    const doc = prog([
      { name: "A", type: "led", color: "red", next: "B" },
      { name: "B", type: "delay", ms: 100, next: "C" },
      { name: "C", type: "led", color: "blue", next: "A" },
    ]);
    expect(value(doc, "C", "next")).toEqual({ kind: "step", target: "A" });
    expect(naturalNext(stepList(doc), "C")).toBeUndefined();
    const inLoop = rounds();
    const jump = set(inLoop, "Good", "next", { kind: "step", target: "Pause" });
    expect(value(jump, "Good", "next")).toEqual({ kind: "step", target: "Pause" });
    expect(value(set(jump, "Good", "next", { kind: "next" }), "Good", "next")).toEqual({ kind: "next" });
  });

  it("the exits of a Decide: next step links to where the list goes on", () => {
    const doc = prog([
      { name: "I", type: "if", left: 1, right: 1, true: "Yes", false: "No" },
      { name: "Yes", type: "led", color: "red", next: "End" },
      { name: "No", type: "led", color: "blue", next: "End" },
      { name: "End", type: "led", color: "green" },
    ]);
    const to = set(doc, "I", "false", { kind: "step", target: "End" });
    expect(block(to, "I").false).toBe("End");
    expect(ownBlocks(to).some((b) => b.name === "No")).toBe(false);
  });

  it("offers a miss only for failure exits and the loop exits only inside a round", () => {
    const doc = rounds();
    const steps = stepList(doc);
    expect(exitChoices(block(doc, "Press"), steps, "timeout")).toEqual({ countMiss: true, loop: true, none: false });
    expect(exitChoices(block(doc, "Press"), steps, "pressed")).toEqual({ countMiss: false, loop: true, none: false });
    const flat = prog([{ name: "A", type: "button", pressed: "B", timeout: "B" }, { name: "B", type: "led", color: "red" }]);
    expect(exitChoices(block(flat, "A"), stepList(flat), "timeout")).toEqual({ countMiss: true, loop: false, none: false });
  });
});

describe("instant loops", () => {
  it("flags a link back through steps that do not wait", () => {
    const doc = prog([
      { name: "I", type: "if", left: 1, right: 1, true: "A", false: "Wait" },
      { name: "A", type: "led", color: "red", next: "I" },
      { name: "Wait", type: "delay", ms: 100 },
    ]);
    expect(instantLoop(doc, "I", "A")).toBe(true);
    expect(instantLoop(doc, "I", "Wait")).toBe(false);
    // a waiting step leaves its exit freely
    const press = prog([{ name: "P", type: "button", pressed: "L" }, { name: "L", type: "led", color: "red", next: "P" }]);
    expect(instantLoop(press, "P", "L")).toBe(false);
    expect(instantLoop(press, "L", "P")).toBe(false);
  });

  it("an effect that does not wait and a summary without a bar do not wait", () => {
    const doc = prog([
      { name: "E", type: "effect", effect: "solid", color: "red", next: "S" },
      { name: "S", type: "summary", metric: "reaction", next: "E" },
    ]);
    expect(instantLoop(doc, "E", "S")).toBe(true);
    const waits = prog([
      { name: "E", type: "effect", effect: "fill", durationMs: 1000, wait: true, color: "red", next: "S" },
      { name: "S", type: "summary", metric: "reaction", next: "E" },
    ]);
    expect(instantLoop(waits, "S", "E")).toBe(false);
  });
});
