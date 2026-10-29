/** The summary block's bar on the central's ring in the simulator (programs.md §7.7, program format 6). */
import { describe, expect, it } from "vitest";
import { validateProgram } from "@reactpod/program-model";
import { DEFAULT_FILES } from "../defaults";
import { Simulator, type Rgb } from "./engine";
import { renderRing, summaryBar, type RingEffect } from "./ringEffects";

function inline(program: Record<string, unknown>, seed = 1) {
  const text = JSON.stringify({ version: 1, name: "T", ...program });
  return new Simulator(validateProgram("/prog/t.json", (p) => (p === "/prog/t.json" ? text : DEFAULT_FILES[p])), { seed });
}

const entered = (sim: Simulator) => sim.snapshot().log.filter((e) => e.kind === "enter").map((e) => e.text);
const central = (sim: Simulator) => sim.snapshot().pods.find((p) => p.central)!;
const lit = (leds: Rgb[]) => leds.filter((c) => c[0] + c[1] + c[2] > 0).length;
const GREEN: Rgb = [0, 255, 0];
const YELLOW: Rgb = [255, 255, 0];
const RED: Rgb = [255, 0, 0];
const OFF: Rgb = [0, 0, 0];

/**
 * One timed step of `ms` (metric "t"), then the summary with the given fields, optionally a delay
 * `After` of 1 s, then an LED (off) and a long delay, so the program keeps running after the bar.
 */
function barProgram(ms: number, summary: Record<string, unknown>, withAfter = false) {
  return inline({
    blocks: [
      { name: "A", type: "delay", ms: 0, timerStart: "t", next: "B" },
      { name: "B", type: "delay", ms, timerStop: "t", next: "S" },
      { name: "S", type: "summary", metric: "t", ...summary, next: withAfter ? "After" : "L" },
      ...(withAfter ? [{ name: "After", type: "delay", ms: 1000, next: "L" }] : []),
      { name: "L", type: "led", color: "off", next: "Stop" },
      { name: "Stop", type: "delay", ms: 100000 },
    ],
  });
}

describe("summary bar (simulator)", () => {
  it("shows the average as a green bar below the target, and leaves after showMs", () => {
    // 300 ms against 450 ms: 2/3 of the ring, green (programs.md §7.7: 0 % at twice the target)
    const sim = barProgram(300, { show: true, targetMs: 450, showMs: 3000 });
    sim.advance(300);
    expect(sim.currentBlock).toBe("S");
    expect(lit(central(sim).leds)).toBe(12);
    expect(central(sim).leds[0]).toEqual(GREEN);
    expect(central(sim).leds[12]).toEqual(OFF);
    sim.advance(2999);
    expect(sim.currentBlock).toBe("S");
    sim.advance(1);
    expect(sim.currentBlock).toBe("Stop");
    expect(lit(central(sim).leds)).toBe(0); // the ring is switched off when the bar ends
  });

  it("is amber up to 1.5 times the target and red slower", () => {
    const amber = barProgram(600, { show: true, targetMs: 450 });
    amber.advance(600);
    expect(amber.currentBlock).toBe("S");
    expect(central(amber).leds[0]).toEqual(YELLOW);

    const red = barProgram(700, { show: true, targetMs: 450 });
    red.advance(700);
    expect(red.currentBlock).toBe("S");
    expect(central(red).leds[0]).toEqual(RED);
    expect(lit(central(red).leds)).toBe(4); // 22 % of the ring
  });

  it("gives no bar and no wait without values", () => {
    const sim = inline({ blocks: [
      { name: "S", type: "summary", metric: "none", show: true, targetMs: 450, next: "D" },
      { name: "D", type: "delay", ms: 1000 },
    ] });
    sim.advance(0);
    expect(entered(sim)).toEqual(["S", "D"]);
    expect(lit(central(sim).leds)).toBe(0);
  });

  it("with showMs 0 the bar stays until the next LED change and the block does not wait", () => {
    const sim = barProgram(300, { show: true, targetMs: 450, showMs: 0 }, true);
    sim.advance(300);
    expect(sim.currentBlock).toBe("After");
    expect(lit(central(sim).leds)).toBe(12);
    sim.advance(1000);
    expect(sim.currentBlock).toBe("Stop"); // the LED step switched the bar off
    expect(lit(central(sim).leds)).toBe(0);
  });

  it("keeps the bar through a pause", () => {
    const sim = barProgram(300, { show: true, targetMs: 450, showMs: 3000 });
    sim.advance(300);
    sim.restartCurrentBlock();
    expect(sim.currentBlock).toBe("S");
    expect(lit(central(sim).leds)).toBe(12);
    sim.advance(3000);
    expect(sim.currentBlock).toBe("Stop");
  });

  it("a plain summary (no show) does not touch the ring", () => {
    const sim = barProgram(300, {});
    sim.advance(300);
    expect(sim.currentBlock).toBe("Stop");
    expect(lit(central(sim).leds)).toBe(0);
  });
});

describe("summaryBar", () => {
  it("is 100 % at 0 ms, 50 % at the target, 0 % at twice the target (at least 6 %)", () => {
    expect(summaryBar(0, 450).percent).toBe(100);
    expect(summaryBar(450, 450).percent).toBe(50);
    expect(summaryBar(900, 450)).toEqual({ percent: 6, band: "red" });
    expect(summaryBar(5000, 450).percent).toBe(6);
  });

  it("bands: green below the target, amber up to 1.5 times it, red above", () => {
    expect(summaryBar(449, 450).band).toBe("green");
    expect(summaryBar(450, 450).band).toBe("yellow");
    expect(summaryBar(675, 450).band).toBe("yellow");
    expect(summaryBar(676, 450).band).toBe("red");
  });

  it("reads the target as 1 to 60000 ms", () => {
    expect(summaryBar(5, 0).band).toBe("red"); // target read as 1 ms: 5 ms is slower
    expect(summaryBar(10, 1_000_000).band).toBe("green");
  });
});

describe("level effect frame", () => {
  it("lights the first percent of the ring (rounded like the firmware) in the band colour", () => {
    const base = Array.from({ length: 18 }, () => OFF);
    const bar = (percent: number): RingEffect => ({ kind: "level", color: GREEN, color2: OFF, startAt: 0, periodMs: 500, brightness: 255, percent });
    expect(lit(renderRing(base, bar(50), 10))).toBe(9);
    expect(lit(renderRing(base, bar(100), 10))).toBe(18);
    expect(lit(renderRing(base, bar(6), 10))).toBe(1);
    expect(renderRing(base, bar(50), 10)[0]).toEqual(GREEN);
    expect(renderRing(base, bar(50), 10)[17]).toEqual(OFF);
  });
});
