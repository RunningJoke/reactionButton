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

  it("trafficLight runs red, yellow, green (reverse: the other way)", () => {
    const at = (reverse: boolean, t: number) => renderRing(base, effect({ kind: "trafficLight", endAt: 400, reverse }), t)[0];
    expect([at(false, 100), at(false, 250), at(false, 399)]).toEqual([RED, [255, 255, 0], [0, 255, 0]]);
    expect([at(true, 100), at(true, 250), at(true, 399)]).toEqual([[0, 255, 0], [255, 255, 0], RED]);
  });

  it("blink alternates, pulse breathes, spin moves a head around the ring", () => {
    const blink = effect({ kind: "blink" }); // period 400
    expect(renderRing(base, blink, 150)[0]).toEqual(RED);
    expect(renderRing(base, blink, 350)[0]).toEqual(OFF);
    expect(renderRing(base, blink, 500)[0]).toEqual(RED);
    const pulse = effect({ kind: "pulse" });
    expect(renderRing(base, pulse, 100)[0]).toEqual(OFF);
    expect(renderRing(base, pulse, 300)[0]).toEqual(RED);
    const spin = effect({ kind: "spin", periodMs: 1800 });
    expect(renderRing(base, spin, 100).findIndex((c) => c[0] === 255)).toBe(0);
    expect(renderRing(base, spin, 100 + 5 * 100).findIndex((c) => c[0] === 255)).toBe(5);
  });

  it("a finite blink is dark when its duration is over", () => {
    expect(renderRing(base, effect({ kind: "blink", endAt: 700 }), 800)[0]).toEqual(OFF);
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
