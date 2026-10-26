/** `charge` and `release` blocks in the simulator (programs.md §2, §7.13, §7.14, program format 3). */
import { describe, expect, it } from "vitest";
import { validateProgram } from "@reactpod/program-model";
import { Simulator, type Rgb } from "./engine";

function inline(program: Record<string, unknown>, seed = 1) {
  const text = JSON.stringify({ version: 1, name: "T", ...program });
  return new Simulator(validateProgram("/prog/t.json", (p) => (p === "/prog/t.json" ? text : undefined)), { seed });
}

const entered = (sim: Simulator) => sim.snapshot().log.filter((e) => e.kind === "enter").map((e) => e.text);
const last = (sim: Simulator) => entered(sim).at(-1);
const ring = (sim: Simulator, id: number) => sim.snapshot().pods[id]!.leds;
const central = (sim: Simulator) => sim.snapshot().pods.find((p) => p.central)!.leds;
const lit = (leds: Rgb[]) => leds.filter((c) => c[0] + c[1] + c[2] > 0).length;
const vars = (sim: Simulator) => sim.snapshot().variables;
const OFF: Rgb = [0, 0, 0];

/** the hold of `pod` from `from` to `to` (ms since the start of the program), then the time `to` is reached */
function hold(sim: Simulator, pod: number, from: number, to: number) {
  sim.advance(from - sim.snapshot().time);
  sim.press(pod);
  sim.advance(to - from);
  sim.release(pod);
  sim.advance(1);
}

const terminals = (extra: Record<string, unknown>[] = []) => [
  { name: "Rel", type: "delay", ms: 100000 },
  { name: "Early", type: "delay", ms: 100000 },
  { name: "Full", type: "delay", ms: 100000 },
  { name: "Out", type: "delay", ms: 100000 },
  ...extra,
];

const charge = (fields: Record<string, unknown> = {}, program: Record<string, unknown> = {}) =>
  inline({
    peripherals: 1,
    ...program,
    blocks: [
      { name: "C", type: "charge", maxMs: 1000, onsetMs: 100, released: "Rel", early: "Early", full: "Full", timeout: "Out", storeAs: "MS", storePercent: "PCT", record: "charge", ...fields },
      ...terminals(),
    ],
  });

describe("charge, mode release", () => {
  it("released after the onset: charge = hold - onset, stored", () => {
    const sim = charge();
    hold(sim, 1, 50, 450);
    expect(last(sim)).toBe("Rel");
    expect(vars(sim).MS).toBe(300);
    expect(vars(sim).PCT).toBe(30);
    expect(sim.snapshot().measurements[0]).toMatchObject({ metric: "charge", pod: 1, ms: 300 });
  });

  it("released before the onset: early, charge 0", () => {
    const sim = charge();
    hold(sim, 1, 50, 100);
    expect(last(sim)).toBe("Early");
    expect(vars(sim).MS).toBe(0);
  });

  it("early falls back to released when it is not connected", () => {
    const sim = inline({
      blocks: [{ name: "C", type: "charge", maxMs: 1000, onsetMs: 100, released: "Rel" }, { name: "Rel", type: "delay", ms: 100000 }],
    });
    hold(sim, 0, 10, 50);
    expect(last(sim)).toBe("Rel");
  });

  it("full at press + onset + max, without waiting for the release; the ring flashes and is not reset", () => {
    const sim = charge();
    sim.advance(50);
    sim.press(1);
    sim.advance(1099);
    expect(last(sim)).toBe("C");
    sim.advance(1);
    expect(last(sim)).toBe("Full");
    expect(sim.snapshot().time).toBe(1150);
    expect(vars(sim).MS).toBe(1000);
    expect(vars(sim).PCT).toBe(100);
    expect(lit(central(sim))).toBe(18); // flash on
    sim.advance(100);
    expect(lit(central(sim))).toBe(0);
    sim.advance(100);
    expect(lit(central(sim))).toBe(18);
    sim.advance(400);
    expect(lit(central(sim))).toBe(0); // dark afterwards
  });

  it("a release at or after the full time counts as full", () => {
    const sim = charge();
    sim.advance(10);
    sim.press(1);
    sim.advance(1100);
    expect(last(sim)).toBe("Full");
  });

  it("a hold that started before the block was entered does not count", () => {
    const sim = inline({
      peripherals: 0,
      blocks: [
        { name: "D", type: "delay", ms: 200, next: "C" },
        { name: "C", type: "charge", maxMs: 1000, released: "Rel", timeoutMs: 1000, timeout: "Out" },
        ...terminals(),
      ],
    });
    sim.press(0);
    sim.advance(300);
    expect(last(sim)).toBe("C");
    sim.release(0);
    sim.advance(100);
    expect(last(sim)).toBe("C"); // the release of the old hold is nothing
    sim.press(0);
    sim.advance(50);
    sim.release(0);
    sim.advance(1);
    expect(last(sim)).toBe("Rel");
  });

  it("timeout counts from the entry, also during a hold; nothing is stored", () => {
    const sim = charge({ timeoutMs: 500 });
    sim.advance(100);
    sim.press(1);
    sim.advance(399);
    expect(last(sim)).toBe("C");
    sim.advance(1);
    expect(last(sim)).toBe("Out");
    expect(vars(sim).MS).toBeUndefined();
    expect(sim.snapshot().measurements).toHaveLength(0);
  });

  it("no timeout field or 0: no timeout", () => {
    const sim = charge({ timeoutMs: 0 });
    sim.advance(60000);
    expect(last(sim)).toBe("C");
  });

  it("a peripheral that does not exist: timeout in the pass of the entry", () => {
    const sim = charge({ pod: 5 });
    expect(last(sim)).toBe("C");
    sim.advance(1);
    expect(last(sim)).toBe("Out");
  });

  it("a peripheral is measured like the central", () => {
    const sim = charge({ pod: 0 });
    hold(sim, 0, 20, 620);
    expect(last(sim)).toBe("Rel");
    expect(vars(sim).MS).toBe(500);
    expect(sim.snapshot().measurements[0]).toMatchObject({ pod: 0, ms: 500 });
  });

  it("the central's own id means the central", () => {
    const sim = charge({ pod: 1 });
    hold(sim, 1, 20, 620);
    expect(vars(sim).MS).toBe(500);
  });

  it("the ring follows the charge: idle dark, half charged = 9 LEDs (fill)", () => {
    const sim = charge({ onsetMs: 0 });
    expect(lit(central(sim))).toBe(0);
    sim.advance(10);
    sim.press(1);
    sim.advance(500);
    expect(lit(central(sim))).toBe(9);
    sim.release(1);
    sim.advance(1);
    expect(lit(central(sim))).toBe(0); // reset after released
  });

  it("styles on a peripheral: brightness starts dim, trafficLight green", () => {
    const sim = charge({ pod: 0, style: "brightness", color: "blue" });
    expect(ring(sim, 0)[0]).toEqual([0, 0, 40]);
    const tl = charge({ pod: 0, style: "trafficLight" });
    expect(ring(tl, 0)[0]).toEqual([0, 255, 0]);
    tl.advance(10);
    tl.press(0);
    tl.advance(500);
    expect(ring(tl, 0)[0]).toEqual([255, 255, 0]);
  });

  it("the countdown runs on the idle ring and ends with the first hold", () => {
    const sim = charge({ onsetMs: 0, timeoutMs: 1000, countdown: "drain" });
    sim.advance(500);
    expect(lit(central(sim))).toBe(9);
    sim.press(1);
    sim.advance(100);
    expect(lit(central(sim))).toBe(1); // the charge shows now, 100 / 1000 of 18
  });
});

describe("charge, mode accumulate", () => {
  const acc = (fields: Record<string, unknown> = {}) => charge({ mode: "accumulate", onsetMs: 0, decayMs: 0, ...fields });

  it("a release pauses, the next hold goes on; only full ends it", () => {
    const sim = acc();
    hold(sim, 1, 10, 410); // 400
    expect(last(sim)).toBe("C");
    sim.advance(1000);
    expect(lit(central(sim))).toBe(7); // kept: floor(18 * 0.4)
    sim.press(1);
    sim.advance(599);
    expect(last(sim)).toBe("C");
    sim.advance(1);
    expect(last(sim)).toBe("Full");
    expect(vars(sim).MS).toBe(1000);
  });

  it("decays linearly over decayMs while released", () => {
    const sim = acc({ decayMs: 2000 });
    hold(sim, 1, 0, 600); // charge 600, drains 500 per second
    sim.advance(400); // -200
    sim.press(1);
    sim.advance(100); // 400 + 100 = 500
    sim.release(1);
    sim.advance(1);
    sim.advance(5000);
    expect(lit(central(sim))).toBe(0);
  });

  it("the onset applies to every hold", () => {
    const sim = acc({ onsetMs: 100 });
    hold(sim, 1, 0, 300); // 200
    sim.press(1);
    sim.advance(100);
    sim.release(1);
    sim.advance(1); // inside the onset: nothing new, 200
    sim.advance(10);
    expect(lit(central(sim))).toBe(3);
    sim.press(1);
    sim.advance(100 + 800);
    expect(last(sim)).toBe("Full");
  });

  it("released and early are never taken", () => {
    const sim = acc({ onsetMs: 200 });
    hold(sim, 1, 0, 50);
    hold(sim, 1, 100, 600);
    expect(last(sim)).toBe("C");
  });

  it("at timeout the charge is stored", () => {
    const sim = acc({ timeoutMs: 1000, decayMs: 1000 });
    hold(sim, 1, 0, 500); // 500, drains 1 per ms
    sim.advance(500); // t = 1000: 0
    expect(last(sim)).toBe("Out");
    expect(vars(sim).MS).toBe(0);
    const keep = acc({ timeoutMs: 1000 });
    hold(keep, 1, 0, 500);
    keep.advance(500);
    expect(last(keep)).toBe("Out");
    expect(vars(keep).MS).toBe(500);
    expect(vars(keep).PCT).toBe(50);
  });

  it("at timeout during a hold the charge counts up to the timeout", () => {
    const sim = acc({ timeoutMs: 700 });
    sim.advance(100);
    sim.press(1);
    sim.advance(600);
    expect(last(sim)).toBe("Out");
    expect(vars(sim).MS).toBe(600);
  });
});

const release = (fields: Record<string, unknown>, program: Record<string, unknown> = {}) =>
  inline({
    peripherals: 1,
    ...program,
    blocks: [
      { name: "R", type: "release", next: "Next", noHold: "NoHold", falseStart: "False", timeout: "Late", ...fields },
      { name: "Next", type: "delay", ms: 100000 },
      { name: "NoHold", type: "delay", ms: 100000 },
      { name: "False", type: "delay", ms: 100000 },
      { name: "Late", type: "delay", ms: 100000 },
    ],
  });

describe("release, trigger", () => {
  it("the release leaves through next and stores the hold time", () => {
    const sim = release({ pod: 0, storeAs: "H" });
    hold(sim, 0, 100, 740);
    expect(last(sim)).toBe("Next");
    expect(vars(sim).H).toBe(640);
  });

  it("allowHeld (default): a hold that is active on entry starts at the entry", () => {
    const sim = inline({
      blocks: [
        { name: "D", type: "delay", ms: 200, next: "R" },
        { name: "R", type: "release", storeAs: "H", next: "Next" },
        { name: "Next", type: "delay", ms: 100000 },
      ],
    });
    sim.press(0);
    sim.advance(500);
    expect(last(sim)).toBe("R");
    sim.release(0);
    sim.advance(1);
    expect(last(sim)).toBe("Next");
    expect(vars(sim).H).toBe(300);
  });

  it("allowHeld false: the held button is ignored until pressed again", () => {
    const sim = inline({
      blocks: [
        { name: "D", type: "delay", ms: 200, next: "R" },
        { name: "R", type: "release", allowHeld: false, storeAs: "H", next: "Next", timeout: "Late", maxHoldMs: 5000 },
        { name: "Next", type: "delay", ms: 100000 },
        { name: "Late", type: "delay", ms: 100000 },
      ],
    });
    sim.press(0);
    sim.advance(300);
    sim.release(0);
    sim.advance(100);
    expect(last(sim)).toBe("R");
    sim.press(0);
    sim.advance(100);
    sim.release(0);
    sim.advance(1);
    expect(last(sim)).toBe("Next");
    expect(vars(sim).H).toBe(100);
  });

  it("noHold after holdTimeoutMs, maxHoldMs from the start of the hold gives timeout", () => {
    const sim = release({ holdTimeoutMs: 1000, maxHoldMs: 500 });
    sim.advance(999);
    expect(last(sim)).toBe("R");
    sim.advance(1);
    expect(last(sim)).toBe("NoHold");
    const slow = release({ holdTimeoutMs: 1000, maxHoldMs: 500 });
    slow.advance(900);
    slow.press(1);
    slow.advance(499);
    expect(last(slow)).toBe("R");
    slow.advance(1);
    expect(last(slow)).toBe("Late");
    expect(vars(slow).H).toBeUndefined();
  });

  it("unconnected noHold, falseStart and timeout fall back to next", () => {
    const sim = inline({
      blocks: [{ name: "R", type: "release", holdTimeoutMs: 100, next: "Next" }, { name: "Next", type: "delay", ms: 100000 }],
    });
    sim.advance(100);
    expect(last(sim)).toBe("Next");
  });

  it("the ring: holdColor, then heldColor; reset at the end", () => {
    const sim = release({ pod: 0, holdColor: "yellow", heldColor: "blue" });
    expect(ring(sim, 0)[0]).toEqual([255, 255, 0]);
    sim.advance(10);
    sim.press(0);
    sim.advance(10);
    expect(ring(sim, 0)[0]).toEqual([0, 0, 255]);
    sim.release(0);
    sim.advance(1);
    expect(ring(sim, 0)[0]).toEqual(OFF);
  });

  it("a pod that does not exist: timeout at once (next if unconnected)", () => {
    const sim = release({ pod: 7 });
    sim.advance(1);
    expect(last(sim)).toBe("Late");
  });
});

describe("release, signal", () => {
  const signal = (fields: Record<string, unknown> = {}) =>
    release({ mode: "signal", pod: 0, goMs: 1000, timeoutMs: 500, record: "start", storeAs: "R", ...fields });

  it("reaction = release - switch, recorded and stored", () => {
    const sim = signal();
    sim.advance(100);
    sim.press(0); // s = 100, switch at 1100
    sim.advance(999);
    expect(ring(sim, 0)[0]).toEqual([255, 255, 0]);
    sim.advance(1);
    expect(ring(sim, 0)[0]).toEqual([0, 255, 0]);
    sim.advance(180);
    sim.release(0);
    sim.advance(1);
    expect(last(sim)).toBe("Next");
    expect(vars(sim).R).toBe(180);
    expect(sim.snapshot().measurements[0]).toMatchObject({ metric: "start", pod: 0, ms: 180 });
  });

  it("released before the switch: falseStart, nothing stored", () => {
    const sim = signal();
    hold(sim, 0, 100, 1099);
    expect(last(sim)).toBe("False");
    expect(vars(sim).R).toBeUndefined();
    expect(sim.snapshot().measurements).toHaveLength(0);
  });

  it("released exactly at the switch is a reaction of 0", () => {
    const sim = signal();
    hold(sim, 0, 100, 1100);
    expect(last(sim)).toBe("Next");
    expect(vars(sim).R).toBe(0);
  });

  it("timeout timeoutMs after the switch", () => {
    const sim = signal();
    sim.advance(100);
    sim.press(0);
    sim.advance(1000 + 499);
    expect(last(sim)).toBe("R");
    sim.advance(1);
    expect(last(sim)).toBe("Late");
  });

  it("a hold that is active on entry is ignored by default (allowHeld false)", () => {
    const sim = signal({ holdTimeoutMs: 300 });
    sim.advance(1);
    sim.press(0);
    // pressed after the entry at t = 0: counts. A press before the entry would not:
    const held = inline({
      peripherals: 1,
      blocks: [
        { name: "D", type: "delay", ms: 100, next: "R" },
        { name: "R", type: "release", mode: "signal", pod: 0, goMs: 100, holdTimeoutMs: 300, noHold: "NoHold", next: "Next" },
        { name: "Next", type: "delay", ms: 100000 },
        { name: "NoHold", type: "delay", ms: 100000 },
      ],
    });
    held.press(0);
    held.advance(500);
    expect(last(held)).toBe("NoHold");
  });

  it("the switch delay is random in [minGoMs, maxGoMs], drawn on enter, the same for the same seed", () => {
    const switchTime = (seed: number) => {
      const sim = inline(
        {
          peripherals: 1,
          blocks: [{ name: "R", type: "release", mode: "signal", pod: 0, minGoMs: 1500, maxGoMs: 3000, next: "Next", storeAs: "R" }, { name: "Next", type: "delay", ms: 100000 }],
        },
        seed,
      );
      sim.press(0);
      let t = 0;
      while (ring(sim, 0)[0]![1] === 255 && ring(sim, 0)[0]![0] === 255 && t < 4000) {
        sim.advance(1); // yellow / held: both red and green
        t++;
      }
      return t;
    };
    const a = switchTime(5);
    expect(a).toBeGreaterThanOrEqual(1500);
    expect(a).toBeLessThanOrEqual(3000);
    expect(switchTime(5)).toBe(a);
    const others = new Set([1, 2, 3, 4, 6, 7].map(switchTime));
    expect(others.size).toBeGreaterThan(1);
  });
});
