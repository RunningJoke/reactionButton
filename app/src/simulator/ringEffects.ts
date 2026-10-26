/**
 * Ring effects for the simulator's ring preview (programFormat 3: `effect` block and the `countdown`
 * option of the timed blocks, docs/firmware/programs.md §2, §7). A pure function: the ring's static
 * colours + an effect + the time give the 18 LED colours.
 *
 * The animation is the app's reading of the effect names; the timing (start, end) is what the
 * engine takes from programs.md §7, the frames in between are cosmetic.
 */
import { LED_COUNT } from "@reactpod/program-model";

export type Rgb = [number, number, number];

export type EffectKind = "solid" | "fill" | "drain" | "dim" | "colorShift" | "trafficLight" | "blink" | "pulse" | "spin" | "off";

/** Effects that repeat every `periodMs` (the others run once over their duration). */
export const PERIODIC_EFFECTS: readonly EffectKind[] = ["blink", "pulse", "spin"];

export type RingEffect = {
  kind: EffectKind;
  color: Rgb;
  /** second colour: end of `colorShift`, off phase of `blink` / `pulse` / `spin` */
  color2: Rgb;
  /** the effect is shown from this time on (the block's start + syncStartMs) */
  startAt: number;
  /** end of the effect; undefined = endless (periodic effects, `solid`) */
  endAt?: number;
  periodMs: number;
  /** 0 … 255 */
  brightness: number;
  /** only these LEDs (central `leds`); the others keep the static colours */
  leds?: readonly number[];
  /** `trafficLight` of a countdown runs from go to stop (green → yellow → red) */
  reverse?: boolean;
};

const OFF: Rgb = [0, 0, 0];
const YELLOW: Rgb = [255, 255, 0];
const RED: Rgb = [255, 0, 0];
const GREEN: Rgb = [0, 255, 0];

const scale = (c: Rgb, f: number): Rgb => [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f)];
const mix = (a: Rgb, b: Rgb, f: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * f),
  Math.round(a[1] + (b[1] - a[1]) * f),
  Math.round(a[2] + (b[2] - a[2]) * f),
];

/** One frame of the effect itself: LED index → colour (before `leds` and `brightness`). */
function frame(effect: RingEffect, t: number): Rgb[] {
  const { kind, color, color2 } = effect;
  const elapsed = Math.max(0, t - effect.startAt);
  const length = effect.endAt === undefined ? 0 : Math.max(0, effect.endAt - effect.startAt);
  // progress 0 … 1 of a finite effect; a finite effect without length is at its final frame
  const p = length > 0 ? Math.min(1, elapsed / length) : kind === "solid" ? 0 : 1;
  const period = Math.max(1, effect.periodMs);
  const all = (c: Rgb) => Array.from({ length: LED_COUNT }, () => c);
  // a finite periodic effect or a timed `solid` is over when its duration is
  const over = effect.endAt !== undefined && t >= effect.endAt;

  switch (kind) {
    case "solid":
      return over ? all(OFF) : all(color);
    case "off":
      return all(OFF);
    case "fill": {
      const lit = Math.floor(LED_COUNT * p);
      return Array.from({ length: LED_COUNT }, (_, i) => (i < lit ? color : OFF));
    }
    case "drain": {
      const lit = Math.ceil(LED_COUNT * (1 - p));
      return Array.from({ length: LED_COUNT }, (_, i) => (i < lit ? color : OFF));
    }
    case "dim":
      return all(scale(color, 1 - p));
    case "colorShift":
      return all(mix(color, color2, p));
    case "trafficLight": {
      const phase = Math.min(2, Math.floor(p * 3));
      const order = effect.reverse ? [GREEN, YELLOW, RED] : [RED, YELLOW, GREEN];
      return all(order[phase]!);
    }
    case "blink":
      if (over) return all(OFF);
      return all(elapsed % period < period / 2 ? color : color2);
    case "pulse": {
      if (over) return all(OFF);
      const f = 0.5 * (1 - Math.cos((2 * Math.PI * (elapsed % period)) / period));
      return all(mix(color2, color, f));
    }
    case "spin": {
      if (over) return all(OFF);
      const head = Math.floor((LED_COUNT * (elapsed % period)) / period);
      const out = all(color2);
      const tail = [1, 0.5, 0.25];
      tail.forEach((f, k) => {
        out[(head - k + LED_COUNT) % LED_COUNT] = mix(color2, color, f);
      });
      return out;
    }
  }
}

/** The ring at time `t`: `base` (static colours) until the effect starts, then the effect over it. */
export function renderRing(base: readonly Rgb[], effect: RingEffect | null | undefined, t: number): Rgb[] {
  if (!effect || t < effect.startAt) return [...base];
  const f = frame(effect, t);
  const level = Math.min(255, Math.max(0, effect.brightness)) / 255;
  return base.map((b, i) => {
    if (effect.leds && !effect.leds.includes(i)) return b;
    return level === 1 ? f[i]! : scale(f[i]!, level);
  });
}

/* ------------------------------------------------------------------ countdown */

export const COUNTDOWN_STYLES = ["secret", "drain", "fill", "dim", "colorShift", "trafficLight"] as const;
export type CountdownStyle = (typeof COUNTDOWN_STYLES)[number];

/**
 * The effect of a block's countdown (issue #56): runs from `startAt` to `endAt` (the time limit) in
 * the block's lit colour, `endColor` is the end colour of `colorShift`. `secret` has none.
 */
export function countdownEffect(style: unknown, lit: Rgb, endColor: Rgb, startAt: number, endAt: number): RingEffect | null {
  if (typeof style !== "string" || style === "secret" || !(COUNTDOWN_STYLES as readonly string[]).includes(style)) return null;
  return {
    kind: style as EffectKind,
    color: lit,
    color2: endColor,
    startAt,
    endAt,
    periodMs: 500,
    brightness: 255,
    reverse: style === "trafficLight",
  };
}
