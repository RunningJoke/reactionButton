import { describe, expect, it } from "vitest";
import { DEFAULT_FILES } from "../defaults";
import { validateProgram } from "@reactpod/program-model";
import { MAX_STEPS_PER_PASS, Simulator } from "./engine";

function load(path: string, seed = 1) {
  return new Simulator(validateProgram(path, (p) => DEFAULT_FILES[p]), { seed });
}

function inline(program: Record<string, unknown>, seed = 1) {
  const text = JSON.stringify({ version: 1, name: "T", ...program });
  return new Simulator(validateProgram("/prog/t.json", (p) => (p === "/prog/t.json" ? text : DEFAULT_FILES[p])), { seed });
}

const entered = (sim: Simulator) => sim.snapshot().log.filter((e) => e.kind === "enter").map((e) => e.text);
const click = (sim: Simulator, pod: number, holdMs = 50) => {
  sim.press(pod);
  sim.advance(holdMs);
  sim.release(pod);
};

describe("simulator engine", () => {
  it("runs solo: false start and hit", () => {
    const sim = load("/prog/solo.json");
    sim.advance(1);
    expect(sim.currentBlock).toBe("Wait");
    expect(sim.snapshot().pods[0]!.leds[0]).toEqual([0, 0, 255]);
    click(sim, 0); // before the random timeout (≥ 800 ms): false start
    sim.advance(1);
    expect(sim.currentBlock).toBe("ShowResult");
    expect(sim.advance(20000, { breakpoints: new Set(["Hit"]) })).toBe("paused");
    sim.advance(300);
    click(sim, 0);
    sim.advance(1);
    const snap = sim.snapshot();
    expect(snap.measurements).toHaveLength(1);
    expect(snap.measurements[0]!.ms).toBe(300);
    expect(snap.variables.LAST_REACTION).toBe(300);
    expect(snap.pods[0]!.leds[0]).toEqual([0, 255, 255]);
  });

  it("only counts presses that start after the block was entered", () => {
    const sim = inline({ blocks: [
      { name: "A", type: "button", pressed: "B" },
      { name: "B", type: "button", pressed: "C" },
      { name: "C", type: "led", color: "red" },
    ] });
    sim.press(0);
    sim.advance(5);
    expect(sim.currentBlock).toBe("B"); // the held button does not count for B
    sim.advance(100);
    expect(sim.currentBlock).toBe("B");
    sim.release(0);
    sim.advance(30);
    sim.press(0);
    sim.advance(1);
    expect(sim.isRunning).toBe(false); // C has no target: the program ends
    expect(entered(sim)).toEqual(["A", "B", "C"]);
  });

  it("classifies short and long on release; exactly shortMs is long; no timeout once pressed", () => {
    const run = (hold: number) => {
      const sim = inline({ blocks: [
        { name: "A", type: "button", shortMs: 500, timeoutMs: 100, short: "S", long: "L", timeout: "T" },
        { name: "S", type: "led", color: "red" },
        { name: "L", type: "led", color: "red" },
        { name: "T", type: "led", color: "red" },
      ] });
      sim.advance(50);
      sim.press(0);
      sim.advance(hold);
      sim.release(0);
      sim.advance(2);
      return entered(sim)[1];
    };
    expect(run(499)).toBe("S");
    expect(run(500)).toBe("L");
    expect(run(2000)).toBe("L"); // the 100 ms timeout no longer applies
  });

  it("falls back to next, and ends when a port has no target", () => {
    const sim = inline({ blocks: [
      { name: "A", type: "button", timeoutMs: 10, next: "B" },
      { name: "B", type: "if", left: 1, right: 2, true: "A" },
    ] });
    sim.advance(20);
    expect(entered(sim)).toEqual(["A", "B"]);
    expect(sim.isRunning).toBe(false);
  });

  it("runs at most 32 steps per pass and continues in the next pass", () => {
    const sim = inline({ variables: { N: 0 }, blocks: [{ name: "Inc", type: "setVariable", var: "N", op: "+", value: 1, next: "Inc" }] });
    sim.advance(0);
    expect(sim.snapshot().variables.N).toBe(MAX_STEPS_PER_PASS);
    sim.advance(3);
    expect(sim.snapshot().variables.N).toBe(4 * MAX_STEPS_PER_PASS);
  });

  it("is repeatable with the same seed (AT-M4) and differs with another", () => {
    const run = (seed: number) => {
      const sim = load("/prog/dreieck.json", seed);
      for (let i = 0; i < 40; i++) {
        sim.advance(3000);
        const lit = sim.snapshot().pods.find((p) => !p.central && p.state === "active");
        if (lit) click(sim, lit.id);
        else click(sim, sim.centralId);
      }
      return entered(sim).join(",");
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(8));
  });

  it("never selects the same pod twice in a row in dreieck (AT-M2)", () => {
    const sim = load("/prog/dreieck.json", 3);
    const selected: number[] = [];
    for (let i = 0; i < 30; i++) {
      expect(sim.advance(60000, { breakpoints: new Set(["IsCentral"]) })).toBe("paused");
      const pod = sim.snapshot().variables.SELECTED_BUZZER!;
      selected.push(pod);
      sim.advance(30); // a human press, beyond the 20 ms debounce
      sim.press(pod); // the central has id REQUIRED_PERIPHERALS, like the program assumes
      sim.release(pod);
    }
    expect(new Set(selected).size).toBe(3);
    for (let i = 1; i < selected.length; i++) expect(selected[i]).not.toBe(selected[i - 1]);
    expect(sim.snapshot().log.some((e) => e.kind === "summary")).toBe(true); // 12 rounds → summary
  });

  it("measures the peripheral's reaction and counts misses in duo (AT-M1)", () => {
    const sim = load("/prog/duo.json", 5);
    expect(sim.peripherals).toBe(1);
    expect(sim.snapshot().variables).toMatchObject({ REQUIRED_PERIPHERALS: 1, NODE_COUNT: 2, MAX_LOOPS: 10 });
    sim.advance(10000, { breakpoints: new Set(["CentralPress"]) });
    sim.advance(5001); // miss
    expect(sim.snapshot().variables.MISSES).toBe(1);
    expect(sim.advance(10000, { breakpoints: new Set(["RemoteTarget"]) })).toBe("paused");
    expect(sim.snapshot().pods[0]!.state).toBe("active");
    sim.advance(250);
    click(sim, 0);
    sim.advance(1);
    const snap = sim.snapshot();
    expect(snap.measurements.at(-1)).toMatchObject({ metric: "reaction", pod: 0, ms: 250 });
    expect(snap.pods[0]!.state).toBe("ready"); // reset after the press
  });

  it("takes avoidHit when a red pod is pressed in run5 (AT-M3)", () => {
    const sim = load("/prog/run5.json", 2);
    expect(sim.advance(10000, { breakpoints: new Set(["ActivateAll"]) })).toBe("paused");
    sim.advance(30);
    const pods = sim.snapshot().pods;
    const red = pods.filter((p) => p.leds[0]![0] === 255 && p.leds[0]![1] === 0);
    expect(red).toHaveLength(2); // AVOID_COUNT, drawn from the 4 peripherals and the central
    expect(pods.filter((p) => p.leds[0]![1] === 255)).toHaveLength(3);
    click(sim, red[0]!.id);
    sim.advance(1);
    expect(entered(sim).slice(-3)).toEqual(["ActivateAll", "Fail", "FailDelay"]);
  });

  it("times out at once for a missing pod, the central's id and a timeout of 0", () => {
    const sim = inline({ peripherals: 1, blocks: [
      { name: "Own", type: "remotePress", pod: "REQUIRED_PERIPHERALS", next: "X", timeout: "Zero" },
      { name: "Zero", type: "remotePress", pod: 0, timeoutMs: 0, next: "X", timeout: "Done" },
      { name: "Done", type: "led", color: "red" },
      { name: "X", type: "led", color: "blue" },
    ] });
    sim.advance(0);
    expect(entered(sim)).toEqual(["Own", "Zero", "Done"]);
    expect(sim.snapshot().pods[0]!.state).toBe("ready");
  });

  it("stores zeros when a summary has no values", () => {
    const sim = inline({ variables: { AVG: 5 }, blocks: [{ name: "S", type: "summary", metric: "reaction", storeAverage: "AVG", storeCount: "C" }] });
    sim.advance(0);
    expect(sim.snapshot().variables).toMatchObject({ AVG: 0, C: 0 });
    expect(sim.snapshot().log.find((e) => e.kind === "summary")!.text).toBe("SUMMARY,reaction,0,0,0,0");
  });

  it("randomOther never repeats, random stays in range, value <= 1 gives 0", () => {
    const sim = inline({ variables: { X: 0, R: 0, Z: 9 }, blocks: [
      { name: "A", type: "setVariable", var: "X", op: "randomOther", value: 3, next: "B" },
      { name: "B", type: "setVariable", var: "R", op: "random", value: 4, next: "C" },
      { name: "C", type: "setVariable", var: "Z", op: "randomOther", value: 1, next: "W" },
      { name: "W", type: "delay", ms: 1, next: "A" },
    ] });
    let last = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      sim.advance(10, { breakpoints: new Set(["W"]) });
      const v = sim.snapshot().variables;
      expect(v.X).not.toBe(last);
      expect(v.R).toBeGreaterThanOrEqual(0);
      expect(v.R).toBeLessThan(4);
      expect(v.Z).toBe(0);
      last = v.X!;
      seen.add(v.R!);
    }
    expect(seen.size).toBe(4);
  });

  it("steps block by block, waits, and skips waits", () => {
    const sim = load("/prog/solo.json");
    expect(sim.step()).toBe("paused"); // Ready → Wait
    expect(sim.currentBlock).toBe("Wait");
    expect(sim.step()).toBe("waiting");
    expect(sim.skipWait()).toBe("paused"); // random timeout → Go
    expect(sim.currentBlock).toBe("Go");
    expect(sim.step()).toBe("paused");
    expect(sim.currentBlock).toBe("Hit");
    expect(sim.skipWait()).toBe("ended"); // no timeout: ends through the unconnected timeout → program ends
  });

  it("lets a step light the pods of a multi press (syncStartMs is no wait for the user)", () => {
    const sim = inline({ peripherals: 2, blocks: [{ name: "M", type: "remoteMultiPress", syncStartMs: 100, next: "E" }, { name: "E", type: "led", color: "red" }] });
    expect(sim.step()).toBe("waiting");
    expect(sim.snapshot().time).toBe(100);
    expect(sim.snapshot().pods.map((p) => p.state)).toEqual(["active", "active", "central"]);
  });

  it("pauses at breakpoints", () => {
    const sim = load("/prog/solo.json");
    expect(sim.advance(100000, { breakpoints: new Set(["Go"]) })).toBe("paused");
    expect(sim.currentBlock).toBe("Go");
    expect(sim.snapshot().time).toBeLessThanOrEqual(5001);
  });

  it("lights peripherals after syncStartMs and the central with them", () => {
    const sim = inline({ peripherals: 2, blocks: [{ name: "M", type: "remoteMultiPress", syncStartMs: 100, next: "E" }, { name: "E", type: "led", color: "red" }] });
    sim.advance(50);
    expect(sim.snapshot().pods.map((p) => p.state)).toEqual(["scheduled", "scheduled", "central"]);
    click(sim, 2, 10); // the central is not lit yet: does not count
    sim.advance(60);
    const snap = sim.snapshot();
    expect(snap.pods.slice(0, 2).map((p) => p.state)).toEqual(["active", "active"]);
    expect(snap.pods[2]!.leds[0]).toEqual([0, 255, 0]);
    click(sim, 0);
    click(sim, 1);
    sim.advance(30);
    click(sim, 2);
    sim.advance(1);
    expect(sim.currentBlock).toBe("E");
  });
});
