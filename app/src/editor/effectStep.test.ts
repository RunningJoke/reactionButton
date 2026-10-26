import { describe, expect, it } from "vitest";
import { countdownKind, hasCountdownTime, setCountdown } from "./countdown";
import { hasEnd, isEndless, setEffectKind, setEffectTarget, setEndless } from "./effectStep";
import { ownBlocks, type ProgramJson } from "./ops";
import { setSwitch } from "./switches";

const doc = (): ProgramJson => ({
  version: 1,
  name: "T",
  peripherals: 2,
  start: "E",
  blocks: [
    { name: "E", type: "effect", effect: "pulse", color: "blue", next: "P" },
    { name: "P", type: "delay", ms: 1000, next: "B" },
    { name: "B", type: "button", pressed: "R" },
    { name: "R", type: "remotePress", pod: 0 },
  ],
});
const get = (d: ProgramJson, name: string) => ownBlocks(d).find((b) => b.name === name)!;

describe("effect step", () => {
  it("an endless periodic effect has no end; a duration or a timed effect has one", () => {
    expect(isEndless(get(doc(), "E"))).toBe(true);
    const fill = setEffectKind(doc(), "E", "fill");
    expect(get(fill, "E")).toMatchObject({ effect: "fill", durationMs: 2000 });
    expect(hasEnd(get(fill, "E"))).toBe(true);
    expect(hasEnd(get(setEndless(doc(), "E", false), "E"))).toBe(true);
  });

  it("solid and off lose duration and wait; an endless effect cannot be waited for", () => {
    const d = setEffectKind({ ...doc(), blocks: [{ name: "E", type: "effect", effect: "fill", durationMs: 500, wait: true }] }, "E", "solid");
    expect(get(d, "E").durationMs).toBeUndefined();
    expect(get(d, "E").wait).toBeUndefined();
    const endless = setEndless({ ...doc(), blocks: [{ name: "E", type: "effect", effect: "blink", durationMs: 500, wait: true }] }, "E", true);
    expect(get(endless, "E")).not.toHaveProperty("wait");
  });

  it("the target central is the default and is not written", () => {
    expect(get(setEffectTarget(doc(), "E", "all"), "E").target).toBe("all");
    expect(get(setEffectTarget(setEffectTarget(doc(), "E", 1), "E", "central"), "E")).not.toHaveProperty("target");
  });
});

describe("countdown", () => {
  it("which steps have one", () => {
    expect(countdownKind(get(doc(), "P"))).toBe("pause");
    expect(countdownKind(get(doc(), "B"))).toBe("limit");
    expect(countdownKind(get(doc(), "E"))).toBeNull();
    expect(hasCountdownTime(get(doc(), "B"))).toBe(false);
    expect(hasCountdownTime(get(setSwitch(doc(), "B", "timeLimit", true), "B"))).toBe(true);
  });

  it("sets and removes the style; the end colour belongs to colorShift", () => {
    let d = setCountdown(doc(), "P", "colorShift");
    d = { ...d, blocks: ownBlocks(d).map((b) => (b.name === "P" ? { ...b, countdownColor: "blue", countdownFrom: "green", countdownTarget: "all" } : b)) };
    expect(get(setCountdown(d, "P", "drain"), "P")).toMatchObject({ countdown: "drain", countdownFrom: "green" });
    expect(get(setCountdown(d, "P", "drain"), "P")).not.toHaveProperty("countdownColor");
    const off = get(setCountdown(d, "P", null), "P");
    for (const f of ["countdown", "countdownColor", "countdownFrom", "countdownTarget"]) expect(off).not.toHaveProperty(f);
  });

  it("switching the time limit off removes the countdown", () => {
    let d = setSwitch(doc(), "B", "timeLimit", true);
    d = setCountdown(d, "B", "dim");
    expect(get(d, "B").countdown).toBe("dim");
    expect(get(setSwitch(d, "B", "timeLimit", false), "B")).not.toHaveProperty("countdown");
  });
});
