import { describe, expect, it } from "vitest";
import { countdownEffect, renderRing, type RingEffect, type Rgb } from "./ringEffects";

const OFF: Rgb = [0, 0, 0];
const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];
const base = Array.from({ length: 18 }, () => OFF);
const effect = (patch: Partial<RingEffect>): RingEffect => ({
  kind: "solid",
  color: RED,
  color2: OFF,
  startAt: 100,
  periodMs: 400,
  brightness: 255,
  ...patch,
});
const lit = (leds: Rgb[]) => leds.filter((c) => c[0] + c[1] + c[2] > 0).length;

describe("renderRing", () => {
  it("shows the static colours until the effect starts, and without effect", () => {
    const still = Array.from({ length: 18 }, () => BLUE);
    expect(renderRing(still, effect({}), 99)).toEqual(still);
    expect(renderRing(still, null, 500)).toEqual(still);
    expect(renderRing(base, effect({}), 100)[5]).toEqual(RED);
  });

  it("fill and drain light a growing / shrinking part of the ring", () => {
    const fill = effect({ kind: "fill", endAt: 1100 });
    expect(lit(renderRing(base, fill, 100))).toBe(0);
    expect(lit(renderRing(base, fill, 600))).toBe(9);
    expect(lit(renderRing(base, fill, 1100))).toBe(18);
    const drain = effect({ kind: "drain", endAt: 1100 });
    expect(lit(renderRing(base, drain, 100))).toBe(18);
    expect(lit(renderRing(base, drain, 600))).toBe(9);
    expect(lit(renderRing(base, drain, 1100))).toBe(0);
    expect(renderRing(base, drain, 600)[0]).toEqual(RED); // drains from the end of the ring
    expect(renderRing(base, drain, 600)[17]).toEqual(OFF);
  });

  it("dim and colorShift go from colour to dark / colour2", () => {
    expect(renderRing(base, effect({ kind: "dim", endAt: 1100 }), 600)[0]).toEqual([128, 0, 0]);
    expect(renderRing(base, effect({ kind: "colorShift", color2: BLUE, endAt: 1100 }), 600)[0]).toEqual([128, 0, 128]);
    expect(renderRing(base, effect({ kind: "colorShift", color2: BLUE, endAt: 1100 }), 5000)[0]).toEqual(BLUE); // final frame is held
  });

  it("trafficLight runs green, yellow, red", () => {
    const at = (t: number) => renderRing(base, effect({ kind: "trafficLight", endAt: 400 }), t)[0];
    expect([at(100), at(250), at(399), at(5000)]).toEqual([[0, 255, 0], [255, 255, 0], RED, RED]);
  });

  it("blink alternates, pulse starts bright and breathes, spin turns a segment of 3 LEDs", () => {
    const blink = effect({ kind: "blink" }); // period 400
    expect(renderRing(base, blink, 150)[0]).toEqual(RED);
    expect(renderRing(base, blink, 350)[0]).toEqual(OFF);
    expect(renderRing(base, blink, 500)[0]).toEqual(RED);
    const pulse = effect({ kind: "pulse" });
    expect(renderRing(base, pulse, 100)[0]).toEqual(RED);
    expect(renderRing(base, pulse, 300)[0]).toEqual(OFF);
    const spin = effect({ kind: "spin", periodMs: 1800 });
    const at = (t: number) => renderRing(base, spin, t).flatMap((c, i) => (c[0] === 255 ? [i] : []));
    expect(at(100).sort((a, b) => a - b)).toEqual([0, 16, 17]);
    expect(at(600).sort((a, b) => a - b)).toEqual([3, 4, 5]);
  });

  it("a periodic effect with a duration ends in a steady colour", () => {
    for (const kind of ["blink", "pulse", "spin"] as const) {
      expect(renderRing(base, effect({ kind, endAt: 700 }), 800)).toEqual(base.map(() => RED));
    }
  });

  it("the background of fill and drain is color2", () => {
    const ring = renderRing(base, effect({ kind: "fill", color2: BLUE, endAt: 1100 }), 100);
    expect(ring[0]).toEqual(BLUE);
  });

  it("brightness scales, leds limits the effect to some LEDs", () => {
    const ring = renderRing(base, effect({ brightness: 51, leds: [2, 3] }), 100);
    expect(ring[2]).toEqual([51, 0, 0]);
    expect(lit(ring)).toBe(2);
  });
});

describe("countdownEffect", () => {
  it("secret (or an unknown style) has no effect", () => {
    expect(countdownEffect("secret", RED, RED, 0, 1000)).toBeNull();
    expect(countdownEffect(undefined, RED, RED, 0, 1000)).toBeNull();
    expect(countdownEffect("sparkle", RED, RED, 0, 1000)).toBeNull();
  });
  it("runs from start to the time limit", () => {
    const e = countdownEffect("drain", BLUE, RED, 10, 1010)!;
    expect(lit(renderRing(base, e, 10))).toBe(18);
    expect(lit(renderRing(base, e, 1010))).toBe(0);
  });
});
