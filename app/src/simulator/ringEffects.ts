/**
 * Ring effects for the simulator's ring preview (programFormat 3: `effect` block and the `countdown`
 * option of the timed blocks, docs/firmware/programs.md §2, §7.11, §7.12; frames: link-protocol.md
 * §2.1). A pure function: the ring's static colours + an effect + the time give the 18 LED colours.
 *
 * The timing (start, end, end frame) follows the firmware; the frames in between are the app's
 * reading of the formulas (linear fills, a cosine for `pulse`).
 */
import { LED_COUNT } from "@reactpod/program-model";

export type Rgb = [number, number, number];

export type EffectKind = "solid" | "fill" | "drain" | "dim" | "colorShift" | "trafficLight" | "blink" | "pulse" | "spin" | "off";

/** Effects that repeat every `periodMs`; with a duration they end in a steady `color`. */
const PERIODIC: readonly EffectKind[] = ["blink", "pulse", "spin"];

export type RingEffect = {
  kind: EffectKind;
  color: Rgb;
  /** second colour: background of `fill` / `drain` / `blink` / `spin`, end of `colorShift` */
  color2: Rgb;
  /** the effect is shown from this time on (the block's start + syncStartMs) */
  startAt: number;
  /**
   * End of the effect. A timed effect without end jumps to its end frame; a periodic one is
   * endless.
   */
  endAt?: number;
  periodMs: number;
  /** 0 … 255; `dim` fades from it to dark */
  brightness: number;
  /** only these LEDs (central `leds`); the others keep the static colours */
  leds?: readonly number[];
};

const OFF: Rgb = [0, 0, 0];
const YELLOW: Rgb = [255, 255, 0];
const RED: Rgb = [255, 0, 0];
const GREEN: Rgb = [0, 255, 0];
/** LEDs of the `spin` segment */
const SPIN_LENGTH = 3;

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
  // progress 0 … 1 of a timed effect; without length it is at its end frame
  const p = length > 0 ? Math.min(1, elapsed / length) : 1;
  const period = Math.max(1, effect.periodMs);
  const all = (c: Rgb) => Array.from({ length: LED_COUNT }, () => c);
  // a periodic effect with a duration ends in a steady colour
  if (PERIODIC.includes(kind) && effect.endAt !== undefined && t >= effect.endAt) return all(color);

  switch (kind) {
    case "solid":
      return all(color);
    case "off":
      return all(OFF);
    case "fill": {
      const lit = Math.floor(LED_COUNT * p);
      return Array.from({ length: LED_COUNT }, (_, i) => (i < lit ? color : color2));
    }
    case "drain": {
      const lit = Math.ceil(LED_COUNT * (1 - p));
      return Array.from({ length: LED_COUNT }, (_, i) => (i < lit ? color : color2));
    }
    case "dim":
      return all(scale(color, 1 - p));
    case "colorShift":
      return all(mix(color, color2, p));
    case "trafficLight":
      return all([GREEN, YELLOW, RED][Math.min(2, Math.floor(p * 3))]!);
    case "blink":
      return all(elapsed % period < period / 2 ? color : color2);
    case "pulse":
      // bright, down to dark, up again; starts with a visible frame
      return all(scale(color, 0.5 * (1 + Math.cos((2 * Math.PI * (elapsed % period)) / period))));
    case "spin": {
      const head = Math.floor((LED_COUNT * (elapsed % period)) / period);
      const out = all(color2);
      for (let k = 0; k < SPIN_LENGTH; k++) out[(head - k + LED_COUNT) % LED_COUNT] = color;
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

/**
 * The effect of a block's countdown (programs.md §7.12): a timed effect from `startAt` to `endAt`
 * in the lit colour `lit`, on a dark ring; `colorShift` goes on to `endColor`. `secret` has none.
 */
export function countdownEffect(style: unknown, lit: Rgb, endColor: Rgb, startAt: number, endAt: number): RingEffect | null {
  if (typeof style !== "string" || style === "secret" || !(COUNTDOWN_STYLES as readonly string[]).includes(style)) return null;
  if (endAt <= startAt) return null; // no time limit, no countdown
  return {
    kind: style as EffectKind,
    color: lit,
    color2: style === "colorShift" ? endColor : OFF,
    startAt,
    endAt,
    periodMs: 500,
    brightness: 255,
  };
}
