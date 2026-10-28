/** Program format 4 in the simulator: the `toggle` block (programs.md §7.15, link-protocol.md §2.3). */
import { describe, expect, it } from "vitest";
import { validateProgram } from "@reactpod/program-model";
import { DEFAULT_FILES } from "../defaults";
import { OWNER_A, OWNER_B, OWNER_NONE, Simulator, type Rgb } from "./engine";

function inline(program: Record<string, unknown>, seed = 1) {
  const text = JSON.stringify({ version: 1, name: "T", peripherals: 2, ...program });
  return new Simulator(validateProgram("/prog/t.json", (p) => (p === "/prog/t.json" ? text : undefined)), { seed });
}

const entered = (sim: Simulator) => sim.snapshot().log.filter((e) => e.kind === "enter").map((e) => e.text);
const pod = (sim: Simulator, id: number) => sim.snapshot().pods[id]!;
const vars = (sim: Simulator) => sim.snapshot().variables;
const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];
const OFF: Rgb = [0, 0, 0];
const CENTRAL = 2;

function tap(sim: Simulator, id: number) {
  sim.press(id);
  sim.release(id);
}

const STORES = { storeA: "PA", storeB: "PB", storeTimeA: "TA", storeTimeB: "TB", storeFlips: "F" };
const game = (fields: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  inline({
    blocks: [
      { name: "G", type: "toggle", durationMs: 1000, cooldownMs: 100, ...STORES, next: "End", ...fields },
      { name: "End", type: "delay", ms: 5000 },
    ],
    ...extra,
  });

describe("toggle block", () => {
  it("alternates the start owners (peripherals first, the central last) and lights at the sync start", () => {
    const sim = game();
    sim.advance(19);
    expect(pod(sim, 0).leds[0]).toEqual(OFF);
    expect(pod(sim, CENTRAL).leds[0]).toEqual(OFF);
    sim.advance(1);
    expect(pod(sim, 0).leds[0]).toEqual(RED);
    expect(pod(sim, 1).leds[0]).toEqual(BLUE);
    expect(pod(sim, CENTRAL).leds[0]).toEqual(RED);
    expect(pod(sim, 1).toggle).toEqual({ owner: OWNER_B, flips: 0 });
  });

  it("start a, b and off; off stays dark and the first press makes the pod A", () => {
    const a = game({ start: "a" });
    a.advance(20);
    expect([0, 1, 2].map((i) => pod(a, i).toggle?.owner)).toEqual([OWNER_A, OWNER_A, OWNER_A]);
    const b = game({ start: "b", includeCentral: false });
    b.advance(20);
    expect(pod(b, 0).toggle?.owner).toBe(OWNER_B);
    expect(pod(b, CENTRAL).leds[0]).toEqual(OFF);
    const off = game({ start: "off" });
    off.advance(100);
    expect(pod(off, 0).leds[0]).toEqual(OFF);
    expect(pod(off, 0).toggle?.owner).toBe(OWNER_NONE);
    tap(off, 0);
    expect(pod(off, 0).leds[0]).toEqual(RED);
    off.advance(30);
    tap(off, CENTRAL);
    off.advance(1);
    expect(pod(off, CENTRAL).leds[0]).toEqual(RED);
  });

  it("random draws once per participant from the seeded generator", () => {
    const owners = (seed: number) => {
      const again = inline({ blocks: [{ name: "G", type: "toggle", durationMs: 1000, start: "random", next: "End" }, { name: "End", type: "delay", ms: 1 }] }, seed);
      again.advance(20);
      return [0, 1, 2].map((i) => pod(again, i).toggle?.owner ?? (i === CENTRAL ? undefined : -1));
    };
    expect(owners(7)).toEqual(owners(7));
    const all = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => owners(s).join()));
    expect(all.size).toBeGreaterThan(1);
  });

  it("a press flips a pod at once; the cooldown ignores a quick second press, the first always counts", () => {
    const sim = game({ cooldownMs: 300 });
    sim.advance(50);
    tap(sim, 0);
    expect(pod(sim, 0).leds[0]).toEqual(BLUE);
    sim.advance(100);
    tap(sim, 0); // 100 ms after the last accepted press: ignored
    expect(pod(sim, 0).leds[0]).toEqual(BLUE);
    expect(pod(sim, 0).toggle?.flips).toBe(1);
    sim.advance(200);
    tap(sim, 0); // 300 ms: accepted
    expect(pod(sim, 0).leds[0]).toEqual(RED);
    expect(pod(sim, 0).toggle?.flips).toBe(2);
  });

  it("presses before the game start do nothing", () => {
    const sim = game();
    sim.advance(10);
    tap(sim, 0);
    tap(sim, CENTRAL);
    sim.advance(30);
    expect(pod(sim, 0).toggle?.flips).toBe(0);
    expect(pod(sim, CENTRAL).toggle).toEqual({ owner: OWNER_A, flips: 0 });
  });

  it("the central's own button flips too (cooldown by button time)", () => {
    const sim = game({ cooldownMs: 200 });
    sim.advance(100);
    tap(sim, CENTRAL);
    sim.advance(1);
    expect(pod(sim, CENTRAL).leds[0]).toEqual(BLUE);
    sim.advance(50);
    tap(sim, CENTRAL);
    sim.advance(1);
    expect(pod(sim, CENTRAL).leds[0]).toEqual(BLUE);
    expect(pod(sim, CENTRAL).toggle?.flips).toBe(1);
  });

  it("time over: owned time is summed over all pods and closed at t0 + D; the results are stored", () => {
    const sim = game();
    sim.advance(520);
    tap(sim, 0); // pod 0: A -> B at 520 (t0 = 20)
    sim.advance(499);
    expect(entered(sim)).toEqual(["G"]);
    sim.advance(1);
    expect(entered(sim)).toEqual(["G", "End"]);
    expect(sim.snapshot().time).toBe(1020);
    // A: pod 0 500 + central 1000; B: pod 0 500 + pod 1 1000
    expect(vars(sim)).toMatchObject({ PA: 1, PB: 2, TA: 1500, TB: 1500, F: 1 });
  });

  it("at the end the pods stay lit in their final colour and a press no longer changes it", () => {
    const sim = game();
    sim.advance(520);
    tap(sim, 0);
    sim.advance(500);
    expect(pod(sim, 0).leds[0]).toEqual(BLUE);
    expect(pod(sim, 1).leds[0]).toEqual(BLUE);
    expect(pod(sim, CENTRAL).leds[0]).toEqual(RED);
    sim.advance(400);
    tap(sim, 0);
    tap(sim, 1);
    tap(sim, CENTRAL);
    sim.advance(10);
    expect(pod(sim, 0).leds[0]).toEqual(BLUE);
    expect(pod(sim, 1).leds[0]).toEqual(BLUE);
    expect(pod(sim, CENTRAL).leds[0]).toEqual(RED);
    expect(vars(sim).F).toBe(1);
  });

  it("allA / allB end the game after the flip that makes every pod (central included) one team", () => {
    const sim = inline({
      blocks: [
        { name: "G", type: "toggle", durationMs: 10000, cooldownMs: 0, start: "b", ...STORES, next: "Over", allA: "RedWins", allB: "BlueWins" },
        { name: "Over", type: "delay", ms: 1 },
        { name: "RedWins", type: "delay", ms: 1 },
        { name: "BlueWins", type: "delay", ms: 1 },
      ],
    });
    sim.advance(100);
    // all start in B: nothing ends on entry (checked only after a flip)
    expect(entered(sim)).toEqual(["G"]);
    tap(sim, 0);
    sim.advance(30);
    tap(sim, 1);
    sim.advance(30);
    expect(entered(sim)).toEqual(["G"]);
    tap(sim, CENTRAL);
    sim.advance(1);
    expect(entered(sim).slice(0, 2)).toEqual(["G", "RedWins"]);
    expect(vars(sim)).toMatchObject({ PA: 3, PB: 0, F: 3 });
    expect(vars(sim).TB).toBeGreaterThan(0);
    expect(vars(sim).TA + vars(sim).TB).toBeLessThan(3 * 10000);
  });

  it("an unconnected allA / allB does not fall back to next: the game goes on", () => {
    const sim = game({ start: "b", cooldownMs: 0 });
    sim.advance(100);
    tap(sim, 0);
    sim.advance(30);
    tap(sim, 1);
    sim.advance(30);
    tap(sim, CENTRAL);
    sim.advance(100);
    expect([0, 1, 2].map((i) => pod(sim, i).toggle?.owner)).toEqual([OWNER_A, OWNER_A, OWNER_A]);
    expect(entered(sim)).toEqual(["G"]);
    sim.advance(1000);
    expect(entered(sim)).toEqual(["G", "End"]);
  });

  it("pods and includeCentral choose the participants", () => {
    const sim = game({ pods: 1, includeCentral: false });
    sim.advance(20);
    expect(pod(sim, 0).toggle).toBeDefined();
    expect(pod(sim, 1).toggle).toBeUndefined();
    expect(pod(sim, 1).leds[0]).toEqual(OFF);
    expect(pod(sim, CENTRAL).leds[0]).toEqual(OFF);
    sim.advance(1000);
    expect(vars(sim)).toMatchObject({ PA: 1, PB: 0, TA: 1000, TB: 0, F: 0 });
  });

  it("a random duration is drawn once on entry (min … max)", () => {
    const sim = inline({ blocks: [{ name: "G", type: "toggle", minDurationMs: 500, maxDurationMs: 900, next: "End" }, { name: "End", type: "delay", ms: 50 }] }, 3);
    sim.advance(2000);
    const end = sim.snapshot().log.find((e) => e.block === "End")!.t;
    expect(end).toBeGreaterThanOrEqual(520);
    expect(end).toBeLessThanOrEqual(920);
  });

  it("D <= 0 ends the block at the start", () => {
    const sim = game({ durationMs: 0 });
    sim.advance(19);
    expect(entered(sim)).toEqual(["G"]);
    sim.advance(1);
    expect(entered(sim)).toEqual(["G", "End"]);
    expect(vars(sim)).toMatchObject({ PA: 2, PB: 1, TA: 0, TB: 0, F: 0 });
  });

  it("the countdown runs over the whole game in the colour of the owner and survives a flip", () => {
    const sim = game({ countdown: "drain", durationMs: 1800, cooldownMs: 0 });
    sim.advance(920); // half
    const lit = (id: number) => pod(sim, id).leds.filter((c) => c[0] + c[1] + c[2] > 0).length;
    expect(lit(0)).toBe(9);
    expect(lit(CENTRAL)).toBe(9);
    tap(sim, 0);
    expect(lit(0)).toBe(9); // the animation goes on
    expect(pod(sim, 0).leds[0]).toEqual(BLUE);
    tap(sim, CENTRAL);
    sim.advance(1);
    expect(lit(CENTRAL)).toBe(9);
    expect(pod(sim, CENTRAL).leds[0]).toEqual(BLUE);
  });

  it("skip wait jumps to the end of the game", () => {
    const sim = game();
    sim.advance(100);
    expect(sim.deadline()).toBe(1020);
    sim.skipWait();
    expect(entered(sim)).toEqual(["G", "End"]);
  });

  it("a pause (restartCurrentBlock) starts the game again with new owners and times", () => {
    const sim = game();
    sim.advance(300);
    tap(sim, 0);
    sim.restartCurrentBlock();
    expect(pod(sim, 0).toggle).toEqual({ owner: OWNER_A, flips: 0 });
    sim.advance(1100); // t0 = 320, over at 1320
    expect(entered(sim).slice(-1)).toEqual(["End"]);
    expect(vars(sim)).toMatchObject({ F: 0, TA: 2000, TB: 1000 });
  });

  it("the shipped domination program runs", () => {
    const text = DEFAULT_FILES["/prog/domination.json"];
    expect(text).toBeDefined();
    const sim = new Simulator(validateProgram("/prog/domination.json", (p) => DEFAULT_FILES[p]), { seed: 1 });
    sim.advance(700); // EnterProgram 500 ms + sync start
    expect(entered(sim)).toContain("Game");
    tap(sim, 0);
    expect(pod(sim, 0).toggle?.flips).toBe(1);
    sim.advance(21000);
    expect(entered(sim)).toContain("Show");
    expect(vars(sim).FLIPS).toBe(1);
  });
});
