/**
 * The block engine, ported from the firmware (src/BlockManager, src/Block/*) for the simulator
 * (docs/app/spec.md §8). Semantics: docs/firmware/programs.md §7, program format 2 (timers §7.9,
 * `repeat` §7.10). Deterministic: simulated time in whole ms, random
 * numbers from a seeded generator, one engine pass per simulated ms.
 *
 * Pod ids as on the pod (programs.md §1.3): peripherals 0 … n−1, the central n.
 * Radio timing is not modelled: commands and presses arrive at once.
 */
import { blockType } from "@reactpod/program-model";
import { colorToRgb } from "@reactpod/program-model";
import { LED_COUNT } from "@reactpod/program-model";
import { isObject } from "@reactpod/program-model";
import type { ResolvedProgram } from "@reactpod/program-model";
import { createRandom, type Random } from "./random";
import { EFFECTS } from "@reactpod/program-model";
import { chargeRing, countdownEffect, fullColor, fullFlashRing, releaseRing, renderRing, type EffectKind, type RingEffect, type Rgb } from "./ringEffects";

export const MAX_STEPS_PER_PASS = 32;
const DEBOUNCE_MS = 20;
const MAX_MULTI_PODS = 31;

export type { Rgb };
const OFF: Rgb = [0, 0, 0];

export type LogKind = "enter" | "result" | "summary" | "end" | "info";
export type LogEntry = { t: number; kind: LogKind; text: string; block?: string };

export type Measurement = { t: number; metric: string; pod: number; ms: number };

type Value = number | string | undefined;
type PortResult = string | "running";

/* ------------------------------------------------------------------ context */

class Variables {
  readonly values = new Map<string, number>();
  get(name: string): number {
    if (!this.values.has(name)) this.values.set(name, 0); // like VariableManager::resolve
    return this.values.get(name)!;
  }
  set(name: string, value: number) {
    this.values.set(name, Math.trunc(value));
  }
  /** a value field: number, variable name, or undefined (not set) */
  read(value: Value): number {
    if (typeof value === "number") return Math.trunc(value);
    if (typeof value === "string") return this.get(value);
    return 0;
  }
}

class Button {
  pressCount = 0;
  down = false;
  lastPressTime = 0;
  lastHeldMs = 0;
  releaseCount = 0;
  lastReleaseTime = 0;
  /** `releaseCount` when the last press happened: a release after it ends that hold */
  releaseCountAtPress = 0;
  private lastEdge = -Infinity;

  press(now: number) {
    if (this.down || now - this.lastEdge < DEBOUNCE_MS) return false;
    this.down = true;
    this.pressCount++;
    this.lastPressTime = now;
    this.releaseCountAtPress = this.releaseCount;
    this.lastEdge = now;
    return true;
  }
  release(now: number) {
    if (!this.down) return;
    this.down = false;
    this.lastHeldMs = now - this.lastPressTime;
    this.releaseCount++;
    this.lastReleaseTime = now;
    this.lastEdge = now;
  }
}

export type PeripheralState = "ready" | "scheduled" | "active" | "done";

type Peripheral = {
  state: PeripheralState;
  color: Rgb;
  mode: "hit" | "avoid";
  cmdSeq: number;
  colorActive: Rgb;
  colorAfter: Rgb;
  startAt: number;
  activatedAt: number;
  button: Button;
  /** ring effect (effect block, countdown) over `color`; ARM, RESET and a press replace it */
  effect: RingEffect | null;
};

type PodEvent = { podId: number; cmdSeq: number; avoidHit: boolean; reactionMs: number };

type ArmCommand = {
  mode: "hit" | "avoid";
  colorActive: Rgb;
  colorAfter?: Rgb;
  startAt?: number;
  /** countdown over the time limit, builds the effect from the time the pod lights */
  countdown?: (litAt: number) => RingEffect | null;
};

/** The peripherals as the central's IPodNetwork sees them. */
class Network {
  readonly pods: Peripheral[];
  private seq = 0;
  private readonly events: PodEvent[] = [];

  constructor(count: number) {
    this.pods = Array.from({ length: count }, () => ({
      state: "ready",
      color: OFF,
      mode: "hit",
      cmdSeq: 0,
      colorActive: OFF,
      colorAfter: OFF,
      startAt: 0,
      activatedAt: 0,
      button: new Button(),
      effect: null,
    }));
  }

  get podCount() {
    return this.pods.length;
  }

  /** latest start time of pods that are still waiting to light */
  get scheduledUntil(): number | undefined {
    const times = this.pods.filter((p) => p.state === "scheduled").map((p) => p.startAt);
    return times.length ? Math.max(...times) : undefined;
  }

  arm(id: number, command: ArmCommand, now: number): number {
    const pod = this.pods[id]!;
    pod.cmdSeq = ++this.seq;
    pod.mode = command.mode;
    pod.colorActive = command.colorActive;
    pod.colorAfter = command.colorAfter ?? OFF;
    const litAt = command.startAt !== undefined && command.startAt > now ? command.startAt : now;
    pod.effect = command.countdown?.(litAt) ?? null;
    if (command.startAt !== undefined && command.startAt > now) {
      pod.state = "scheduled";
      pod.startAt = command.startAt;
      pod.color = OFF;
    } else {
      this.activate(pod, now);
    }
    return pod.cmdSeq;
  }

  reset(id: number) {
    const pod = this.pods[id];
    if (!pod) return;
    pod.state = "ready";
    pod.color = OFF;
    pod.effect = null;
  }

  /** an `effect` block aimed at a peripheral */
  setEffect(id: number, effect: RingEffect) {
    const pod = this.pods[id];
    if (pod) pod.effect = effect;
  }

  tick(now: number) {
    for (const pod of this.pods) if (pod.state === "scheduled" && now >= pod.startAt) this.activate(pod, now);
  }

  /** a press on a peripheral: only an active pod reports it (PeripheralRole, State::ACTIVE) */
  press(id: number, now: number) {
    const pod = this.pods[id];
    if (!pod || !pod.button.press(now) || pod.state !== "active") return;
    pod.color = pod.colorAfter;
    pod.effect = null; // a press stops the countdown
    pod.state = "done";
    this.events.push({ podId: id, cmdSeq: pod.cmdSeq, avoidHit: pod.mode === "avoid", reactionMs: now - pod.activatedAt });
  }

  release(id: number, now: number) {
    this.pods[id]?.button.release(now);
  }

  poll(): PodEvent | undefined {
    return this.events.shift();
  }

  private activate(pod: Peripheral, now: number) {
    pod.state = "active";
    pod.color = pod.colorActive;
    pod.activatedAt = now;
  }
}

class Results {
  private readonly metrics = new Map<string, number[]>();
  readonly all: Measurement[] = [];

  record(t: number, metric: string, pod: number, ms: number) {
    this.metrics.set(metric, [...(this.metrics.get(metric) ?? []), ms]);
    this.all.push({ t, metric, pod, ms });
  }
  stats(metric: string) {
    const values = this.metrics.get(metric) ?? [];
    const count = values.length;
    const sum = values.reduce((a, b) => a + b, 0);
    return {
      count,
      average: count ? Math.trunc(sum / count) : 0,
      best: count ? Math.min(...values) : 0,
      worst: count ? Math.max(...values) : 0,
    };
  }
  reset(metric: string) {
    this.metrics.delete(metric);
  }
  names() {
    return [...this.metrics.keys()];
  }
}

type Ctx = {
  now: () => number;
  vars: Variables;
  button: Button;
  leds: Rgb[];
  /** effect on the central's ring over `leds`; led, RESET and a press replace it */
  effect: RingEffect | null;
  network: Network;
  results: Results;
  random: Random;
  centralPodId: number;
  log: (kind: LogKind, text: string) => void;
};

/* ------------------------------------------------------------------ blocks */

type SimBlock = {
  name: string;
  type: string;
  /** port name → target block name */
  targets: Record<string, string | undefined>;
  /** port 0 is the fallback when it is "next" */
  ports: readonly string[];
  /** timer names of `timerStart` / `timerStop` (programs.md §7.9) */
  timerStart?: string;
  timerStop?: string;
  /** state kept across entries is reset when the program starts (Block::onProgramStart) */
  programStart?: () => void;
  enter: (ctx: Ctx) => void;
  /** the block is left (BlockManager: exit) */
  exit?: (ctx: Ctx) => void;
  execute: (ctx: Ctx) => PortResult;
  /** time at which the block ends by itself (delay, timeout), for "skip wait" */
  deadline?: (ctx: Ctx) => number | undefined;
  /** ends the block through its timeout now (skip wait without a deadline) */
  forceTimeout?: (ctx: Ctx) => PortResult;
  /** time at which the block still lights pods without any input (syncStartMs) */
  pendingLight?: () => number | undefined;
};

const randomBetween = (random: Random, min: number, max: number) => {
  const lo = Math.max(0, min);
  return max <= lo ? lo : lo + random.below(max - lo + 1);
};

function remoteColor(value: unknown, fallback: Rgb): Rgb {
  return value === undefined || value === null ? fallback : colorToRgb(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

const WHITE: Rgb = [255, 255, 255];

/** Freezes the central's effect in the frame it shows now (a block that is left stops its countdown, the ring keeps the last frame). */
function freezeEffect(ctx: Ctx, own: RingEffect | null) {
  if (!own || ctx.effect !== own) return;
  const frame = renderRing(ctx.leds, ctx.effect, ctx.now());
  frame.forEach((c, i) => (ctx.leds[i] = c));
  ctx.effect = null;
}

/**
 * `countdown`, `countdownColor`, `countdownFrom` of a timed block (programs.md §2 Countdown, §7.12, program
 * format 3). `secret` or a missing field gives no effect: the block behaves exactly as in format 1 and 2.
 */
function countdownOf(raw: Record<string, unknown>) {
  const style = typeof raw.countdown === "string" && raw.countdown !== "secret" ? raw.countdown : null;
  const end = remoteColor(raw.countdownColor, colorToRgb("red"));
  return {
    style,
    /** start colour of `delay` and `button`, which have no lit colour of their own */
    from: remoteColor(raw.countdownFrom, colorToRgb("green")),
    /** the countdown from `startAt` to `endAt` in `lit`, or null (secret, no time limit) */
    effect: (lit: Rgb, startAt: number, endAt: number): RingEffect | null => (style ? countdownEffect(style, lit, end, startAt, endAt) : null),
  };
}

/** Rings an `effect` block or a `delay` countdown is aimed at (`target`, programs.md §7.11). */
function effectTargets(ctx: Ctx, target: unknown): { central: boolean; pods: number[] } {
  const all = Array.from({ length: ctx.network.podCount }, (_, i) => i);
  if (target === undefined || target === "central") return { central: true, pods: [] };
  if (target === "all") return { central: true, pods: all };
  if (target === "peripherals") return { central: false, pods: all };
  const id = ctx.vars.read(target as Value) & 0xff;
  if (id === ctx.centralPodId) return { central: true, pods: [] };
  return { central: false, pods: id < ctx.network.podCount ? [id] : [] };
}

/* ------------------------------------------------------------------ hold (charge, release) */

/** The button a hold block watches: the central's own or a peripheral's (programs.md 7.13). null = cannot take part. */
type HoldTarget = { podId: number; central: boolean; button: Button };

function holdTarget(ctx: Ctx, pod: unknown): HoldTarget | null {
  if (pod === undefined || pod === "central") return { podId: ctx.centralPodId, central: true, button: ctx.button };
  const id = ctx.vars.read(pod as Value) & 0xff;
  if (id === ctx.centralPodId) return { podId: id, central: true, button: ctx.button };
  const peripheral = ctx.network.pods[id];
  return peripheral ? { podId: id, central: false, button: peripheral.button } : null;
}

function showRing(ctx: Ctx, target: HoldTarget, effect: RingEffect) {
  if (target.central) ctx.effect = effect;
  else ctx.network.setEffect(target.podId, effect);
}

/** The pod / the central's ring is reset (dark). */
function resetRing(ctx: Ctx, target: HoldTarget) {
  if (target.central) {
    ctx.leds.fill(OFF);
    ctx.effect = null;
  } else ctx.network.reset(target.podId);
}

/** A ring drawn by a function of the time. */
const frameEffect = (frame: (t: number) => Rgb[], startAt = 0): RingEffect => ({
  kind: "solid",
  color: OFF,
  color2: OFF,
  startAt,
  periodMs: 500,
  brightness: 255,
  frame,
});

/**
 * The start and the end of a hold on a button (HoldSession): a hold starts at a press edge after the entry; with
 * `allowHeld` a button that is down on entry starts it at the entry.
 */
class HoldWatch {
  started = false;
  /** start of the hold */
  at = 0;
  private pressSeen = 0;
  private releaseBase = 0;

  constructor(private readonly button: Button) {}

  enter(now: number, allowHeld: boolean) {
    this.pressSeen = this.button.pressCount;
    this.started = false;
    if (allowHeld && this.button.down) this.begin(now);
  }

  private begin(at: number) {
    this.started = true;
    this.at = at;
    this.releaseBase = this.button.releaseCountAtPress;
  }

  /** a hold starts now (a press edge since the last call) */
  poll(): boolean {
    if (this.started || this.button.pressCount === this.pressSeen) return false;
    this.pressSeen = this.button.pressCount;
    this.begin(this.button.lastPressTime);
    return true;
  }

  /** the release edge that ends the hold, once */
  released(): number | undefined {
    if (!this.started || this.button.releaseCount <= this.releaseBase) return undefined;
    return this.button.lastReleaseTime;
  }

  /** the hold is over, wait for the next press */
  rearm() {
    this.started = false;
    this.pressSeen = this.button.pressCount;
  }
}

function createBlock(raw: Record<string, unknown>): SimBlock | null {
  const def = blockType(raw.type);
  if (!def || typeof raw.name !== "string") return null;
  const targets: Record<string, string | undefined> = {};
  for (const port of def.ports) targets[port] = typeof raw[port] === "string" ? (raw[port] as string) : undefined;
  const base = { name: raw.name, type: def.type, targets, ports: def.ports, timerStart: str(raw.timerStart), timerStop: str(raw.timerStop) };
  const v = (field: string) => raw[field] as Value;

  switch (def.type) {
    case "led": {
      const color = colorToRgb(raw.color);
      const leds = Array.isArray(raw.leds) ? raw.leds.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < LED_COUNT) : null;
      return {
        ...base,
        enter: () => undefined,
        execute: (ctx) => {
          for (let i = 0; i < LED_COUNT; i++) if (!leds || leds.includes(i)) ctx.leds[i] = color;
          ctx.effect = null;
          return "next";
        },
      };
    }

    case "delay": {
      let until = 0;
      const [minF, maxF] = raw.ms !== undefined ? ["ms", "ms"] : ["minMs", "maxMs"];
      const countdown = countdownOf(raw);
      let own: RingEffect | null = null;
      return {
        ...base,
        enter: (ctx) => {
          until = ctx.now() + randomBetween(ctx.random, ctx.vars.read(v(minF)), ctx.vars.read(v(maxF)));
          own = null;
          if (!countdown.style) return;
          // central only: from the entry. With pods and more than 20 ms: all start 20 ms after the entry and end with the delay
          const { central, pods } = effectTargets(ctx, raw.countdownTarget);
          const start = pods.length > 0 && until - ctx.now() > 20 ? ctx.now() + 20 : ctx.now();
          if (central) ctx.effect = own = countdown.effect(countdown.from, start, until);
          if (start > ctx.now()) {
            for (const id of pods) {
              const effect = countdown.effect(countdown.from, start, until);
              if (effect) ctx.network.setEffect(id, effect);
            }
          }
        },
        exit: (ctx) => freezeEffect(ctx, own),
        execute: (ctx) => (ctx.now() >= until ? "next" : "running"),
        deadline: () => until,
      };
    }

    case "button": {
      let enterTime = 0;
      let countAtEnter = 0;
      let pressed = false;
      let timeout = 0;
      const random = raw.timeoutMs === undefined && raw.minTimeoutMs !== undefined;
      const record = str(raw.record);
      const storeAs = str(raw.storeAs);
      const pressedConnected = targets.pressed !== undefined;
      const countdown = countdownOf(raw);
      let own: RingEffect | null = null;
      return {
        ...base,
        enter: (ctx) => {
          own = null;
          enterTime = ctx.now();
          countAtEnter = ctx.button.pressCount;
          pressed = false;
          timeout = 0;
          if (raw.timeoutMs !== undefined) timeout = ctx.vars.read(v("timeoutMs"));
          else if (random) timeout = randomBetween(ctx.random, ctx.vars.read(v("minTimeoutMs")), ctx.vars.read(v("maxTimeoutMs")));
          if (countdown.style && timeout > 0) ctx.effect = own = countdown.effect(countdown.from, enterTime, enterTime + timeout);
        },
        exit: (ctx) => freezeEffect(ctx, own),
        execute: (ctx) => {
          if (!pressed) {
            if (ctx.button.pressCount === countAtEnter) {
              if (timeout > 0 && ctx.now() - enterTime >= timeout) return "timeout";
              return "running";
            }
            pressed = true;
            freezeEffect(ctx, own); // a press stops the countdown, the ring keeps the last frame
            const reaction = ctx.button.lastPressTime - enterTime;
            if (record) ctx.results.record(ctx.now(), record, ctx.centralPodId, reaction);
            if (record) ctx.log("result", `RESULT,${ctx.now()},${record},${ctx.centralPodId},${reaction}`);
            if (storeAs) ctx.vars.set(storeAs, reaction);
            if (pressedConnected) return "pressed";
          }
          if (ctx.button.down) return "running";
          const shortMs = raw.shortMs === undefined ? 1000 : ctx.vars.read(v("shortMs"));
          return ctx.button.lastHeldMs < shortMs ? "short" : "long";
        },
        deadline: () => (!pressed && timeout > 0 ? enterTime + timeout : undefined),
        forceTimeout: () => (pressed ? "running" : "timeout"),
      };
    }

    case "if": {
      const op = typeof raw.op === "string" ? raw.op : "==";
      return {
        ...base,
        enter: () => undefined,
        execute: (ctx) => {
          const l = ctx.vars.read(v("left"));
          const r = ctx.vars.read(v("right"));
          const result =
            op === "==" || op === "=" ? l === r : op === "!=" || op === "!" ? l !== r : op === ">" ? l > r : op === "<" ? l < r : op === ">=" ? l >= r : l <= r;
          return result ? "true" : "false";
        },
      };
    }

    case "setVariable": {
      const op = typeof raw.op === "string" ? raw.op : "=";
      const name = String(raw.var);
      return {
        ...base,
        enter: () => undefined,
        execute: (ctx) => {
          const current = ctx.vars.get(name);
          const value = ctx.vars.read(v("value"));
          if (op === "=" || op === "set") ctx.vars.set(name, value);
          else if (op === "+" || op === "add") ctx.vars.set(name, current + value);
          else if (op === "-" || op === "sub") ctx.vars.set(name, current - value);
          else if (op === "random" || op === "?") ctx.vars.set(name, ctx.random.below(value));
          else {
            // randomOther: never the current value, if there is another one
            let result = ctx.random.below(value);
            if (value >= 2 && current >= 0 && current < value) {
              result = ctx.random.below(value - 1);
              if (result >= current) result++;
            }
            ctx.vars.set(name, result);
          }
          return "next";
        },
      };
    }

    case "remotePress": {
      const avoid = raw.mode === "avoid";
      const colorActive = remoteColor(raw.color, avoid ? colorToRgb("red") : colorToRgb("green"));
      const colorAfter = remoteColor(raw.colorAfter, OFF);
      const record = str(raw.record);
      const storeAs = str(raw.storeAs);
      let enterTime = 0;
      let podId = 0;
      let cmdSeq = 0;
      let armed = false;
      const countdown = countdownOf(raw);
      // a countdown needs a fixed length: the timeout is read once on enter, else on every pass (programs.md §7.2)
      let fixedTimeout = 0;
      const timeoutAt = (ctx: Ctx) =>
        raw.timeoutMs === undefined ? undefined : enterTime + (countdown.style ? fixedTimeout : ctx.vars.read(v("timeoutMs")));
      return {
        ...base,
        enter: (ctx) => {
          enterTime = ctx.now();
          podId = ctx.vars.read(v("pod")) & 0xff; // uint8_t on the pod
          armed = false;
          fixedTimeout = raw.timeoutMs === undefined ? 0 : ctx.vars.read(v("timeoutMs"));
          if (podId >= ctx.network.podCount) {
            ctx.log("info", `${raw.name}: pod ${podId} not available`);
            return;
          }
          // the ARM command carries the countdown, which the pod plays from its activation over the timeout
          cmdSeq = ctx.network.arm(
            podId,
            { mode: avoid ? "avoid" : "hit", colorActive, colorAfter, countdown: (litAt) => countdown.effect(colorActive, litAt, litAt + fixedTimeout) },
            ctx.now(),
          );
          armed = true;
        },
        execute: (ctx) => {
          if (!armed) return "timeout";
          for (let event = ctx.network.poll(); event; event = ctx.network.poll()) {
            if (event.podId !== podId || event.cmdSeq !== cmdSeq) continue; // an earlier activation
            ctx.network.reset(podId);
            if (record) {
              ctx.results.record(ctx.now(), record, podId, event.reactionMs);
              ctx.log("result", `RESULT,${ctx.now()},${record},${podId},${event.reactionMs}`);
            }
            if (storeAs) ctx.vars.set(storeAs, event.reactionMs);
            return "next";
          }
          const at = timeoutAt(ctx);
          if (at !== undefined && ctx.now() >= at) {
            ctx.network.reset(podId);
            return "timeout";
          }
          return "running";
        },
        deadline: (ctx) => (armed ? timeoutAt(ctx) : undefined),
        forceTimeout: (ctx) => {
          if (armed) ctx.network.reset(podId);
          return "timeout";
        },
      };
    }

    case "remoteMultiPress": {
      const includeCentral = raw.includeCentral !== false;
      const hitColor = remoteColor(raw.hitColor, colorToRgb("green"));
      const avoidColor = remoteColor(raw.avoidColor, colorToRgb("red"));
      const record = str(raw.record);
      let enterTime = 0;
      let podCount = 0;
      let avoidMask = 0;
      let remaining = 0;
      let startAt = 0;
      let centralLit = false;
      let centralLitAt = 0;
      let pressCountAtLight = 0;
      const cmdSeqs: number[] = [];
      const countdown = countdownOf(raw);
      let fixedTimeout = 0;
      const timeoutAt = (ctx: Ctx) =>
        raw.timeoutMs === undefined ? undefined : enterTime + (countdown.style ? fixedTimeout : ctx.vars.read(v("timeoutMs")));
      return {
        ...base,
        enter: (ctx) => {
          enterTime = ctx.now();
          fixedTimeout = raw.timeoutMs === undefined ? 0 : ctx.vars.read(v("timeoutMs"));
          avoidMask = 0;
          remaining = 0;
          centralLit = false;
          const connected = ctx.network.podCount;
          const wanted = raw.pods === undefined ? connected : ctx.vars.read(v("pods"));
          podCount = Math.min(Math.max(wanted, 0), Math.min(connected, MAX_MULTI_PODS));
          const total = podCount + (includeCentral ? 1 : 0);
          if (total === 0) return;
          const avoidCount = Math.min(Math.max(ctx.vars.read(v("avoid")), 0), total - 1);
          for (let picked = 0; picked < avoidCount; ) {
            const bit = 1 << ctx.random.below(total);
            if ((avoidMask & bit) === 0) {
              avoidMask |= bit;
              picked++;
            }
          }
          const lead = raw.syncStartMs === undefined ? 20 : ctx.vars.read(v("syncStartMs"));
          startAt = ctx.now() + lead;
          const limit = timeoutAt(ctx) ?? 0;
          // every lit pod and the central count down together from the sync start to the timeout (D = T - syncStartMs)
          for (let i = 0; i < podCount; i++) {
            const isAvoid = (avoidMask & (1 << i)) !== 0;
            const colorActive = isAvoid ? avoidColor : hitColor;
            cmdSeqs[i] = ctx.network.arm(
              i,
              {
                mode: isAvoid ? "avoid" : "hit",
                colorActive,
                startAt: lead > 0 ? startAt : undefined,
                countdown: (litAt) => countdown.effect(colorActive, litAt, limit),
              },
              ctx.now(),
            );
            if (!isAvoid) remaining |= 1 << i;
          }
          if (includeCentral && (avoidMask & (1 << podCount)) === 0) remaining |= 1 << podCount;
        },
        execute: (ctx) => {
          const centralBit = 1 << podCount;
          if (includeCentral && !centralLit && ctx.now() >= startAt) {
            const color = avoidMask & centralBit ? avoidColor : hitColor;
            ctx.leds.fill(color);
            ctx.effect = countdown.effect(color, startAt, timeoutAt(ctx) ?? 0);
            centralLit = true;
            centralLitAt = ctx.now();
            pressCountAtLight = ctx.button.pressCount;
          }
          for (let event = ctx.network.poll(); event; event = ctx.network.poll()) {
            if (event.podId >= podCount || event.cmdSeq !== cmdSeqs[event.podId]) continue;
            const bit = 1 << event.podId;
            if (event.avoidHit || avoidMask & bit) {
              ctx.network.reset(event.podId);
              return "avoidHit";
            }
            if (remaining & bit) {
              remaining &= ~bit;
              ctx.network.reset(event.podId);
              if (record) {
                ctx.results.record(ctx.now(), record, event.podId, event.reactionMs);
                ctx.log("result", `RESULT,${ctx.now()},${record},${event.podId},${event.reactionMs}`);
              }
            }
          }
          if (centralLit && ctx.button.pressCount !== pressCountAtLight) {
            pressCountAtLight = ctx.button.pressCount;
            if (avoidMask & centralBit) return "avoidHit";
            if (remaining & centralBit) {
              remaining &= ~centralBit;
              ctx.leds.fill(OFF);
              ctx.effect = null;
              if (record) {
                const reaction = ctx.button.lastPressTime - centralLitAt;
                ctx.results.record(ctx.now(), record, ctx.centralPodId, reaction);
                ctx.log("result", `RESULT,${ctx.now()},${record},${ctx.centralPodId},${reaction}`);
              }
            }
          }
          if (remaining === 0) return "next";
          const at = timeoutAt(ctx);
          if (at !== undefined && ctx.now() >= at) return "timeout";
          return "running";
        },
        deadline: timeoutAt,
        forceTimeout: () => "timeout",
        pendingLight: () => (includeCentral && !centralLit ? startAt : undefined),
      };
    }

    case "remoteResetAll": {
      const ledsOff = raw.ledsOff !== false;
      return {
        ...base,
        enter: () => undefined,
        execute: (ctx) => {
          const connected = ctx.network.podCount;
          const count = raw.pods === undefined ? connected : Math.min(Math.max(ctx.vars.read(v("pods")), 0), connected);
          for (let i = 0; i < count; i++) ctx.network.reset(i);
          if (ledsOff) {
            ctx.leds.fill(OFF);
            ctx.effect = null;
          }
          return "next";
        },
      };
    }

    case "summary": {
      const metric = String(raw.metric);
      const reset = raw.reset !== false;
      return {
        ...base,
        enter: () => undefined,
        execute: (ctx) => {
          const s = ctx.results.stats(metric);
          ctx.log("summary", `SUMMARY,${metric},${s.count},${s.average},${s.best},${s.worst}`);
          const store = (field: string, value: number) => {
            const name = str(raw[field]);
            if (name) ctx.vars.set(name, value);
          };
          store("storeAverage", s.average);
          store("storeBest", s.best);
          store("storeWorst", s.worst);
          store("storeCount", s.count);
          if (reset) ctx.results.reset(metric);
          return "next";
        },
      };
    }

    case "effect": {
      // programs.md §7: starts the effect on enter; wait:false continues at once, wait:true at start + syncStartMs + durationMs
      const kind = (EFFECTS as readonly string[]).includes(raw.effect as string) ? (raw.effect as EffectKind) : "solid";
      const leds = Array.isArray(raw.leds) ? raw.leds.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < LED_COUNT) : undefined;
      const wait = raw.wait === true;
      let finishAt = 0;
      return {
        ...base,
        enter: (ctx) => {
          const sync = raw.syncStartMs === undefined ? 20 : Math.max(0, ctx.vars.read(v("syncStartMs")));
          const startAt = ctx.now() + sync;
          const duration = Math.max(0, ctx.vars.read(v("durationMs")));
          finishAt = startAt + duration;
          const effect: RingEffect = {
            kind,
            color: raw.color === undefined ? WHITE : colorToRgb(raw.color),
            color2: raw.color2 === undefined ? OFF : colorToRgb(raw.color2),
            startAt,
            endAt: duration > 0 ? startAt + duration : undefined,
            periodMs: ctx.vars.read(v("periodMs")) > 0 ? Math.min(65535, ctx.vars.read(v("periodMs"))) : 500,
            brightness: raw.brightness === undefined ? 255 : Math.min(255, Math.max(0, ctx.vars.read(v("brightness")))),
          };
          const { central, pods } = effectTargets(ctx, raw.target);
          if (central) ctx.effect = { ...effect, leds };
          for (const id of pods) ctx.network.setEffect(id, effect);
        },
        execute: (ctx) => (wait && ctx.now() < finishAt ? "running" : "next"),
        deadline: () => (wait ? finishAt : undefined),
      };
    }

    case "charge": {
      // programs.md 7.13 (ChargeBlock.cpp, HoldSession.cpp)
      const accumulate = raw.mode === "accumulate";
      const style = typeof raw.style === "string" ? raw.style : "fill";
      const color = remoteColor(raw.color, colorToRgb("green"));
      const color2 = remoteColor(raw.color2, colorToRgb("red"));
      const record = str(raw.record);
      const storeAs = str(raw.storeAs);
      const storePercent = str(raw.storePercent);
      const randomTimeout = raw.timeoutMs === undefined && raw.minTimeoutMs !== undefined;
      const countdown = countdownOf(raw);
      let target: HoldTarget | null = null;
      let watch: HoldWatch | null = null;
      let enterTime = 0;
      let onset = 0;
      let max = 1;
      let decay = 0;
      let limit = 0;
      let everHeld = false;
      let active = false;
      let p = 0;
      let c0 = 0;
      let r = 0;
      let cRelease = 0;
      let idle: RingEffect | null = null;

      const decayed = (t: number) => (decay > 0 ? Math.max(0, cRelease - ((t - r) * max) / decay) : cRelease);
      const chargeAt = (t: number) => (active ? Math.min(max, c0 + Math.max(0, t - p - onset)) : everHeld ? decayed(t) : 0);
      const store = (ctx: Ctx, charge: number) => {
        const ms = Math.round(charge);
        if (storeAs) ctx.vars.set(storeAs, ms);
        if (storePercent) ctx.vars.set(storePercent, Math.trunc((ms * 100 + Math.trunc(max / 2)) / max));
        if (record) {
          ctx.results.record(ctx.now(), record, target!.podId, ms);
          ctx.log("result", `RESULT,${ctx.now()},${record},${target!.podId},${ms}`);
        }
      };
      const dark = Array.from({ length: LED_COUNT }, () => OFF);
      const ring = (t: number): Rgb[] => {
        if (!everHeld) return idle ? renderRing(dark, idle, t) : chargeRing(style, 0, color, color2);
        return chargeRing(style, chargeAt(t) / max, color, color2);
      };
      const finish = (ctx: Ctx, port: string, charge: number) => {
        store(ctx, charge);
        resetRing(ctx, target!);
        return port;
      };
      const timeout = (ctx: Ctx) => {
        if (accumulate) store(ctx, chargeAt(enterTime + limit)); // the charge when the time ran out
        resetRing(ctx, target!);
        return "timeout";
      };
      const fullPort = (ctx: Ctx, fullAt: number) => {
        const flash = fullColor(style, color, color2);
        store(ctx, max);
        showRing(ctx, target!, frameEffect((t) => fullFlashRing(flash, t - fullAt), fullAt));
        return "full";
      };
      return {
        ...base,
        enter: (ctx) => {
          enterTime = ctx.now();
          onset = Math.max(0, ctx.vars.read(v("onsetMs")));
          max = Math.max(1, ctx.vars.read(v("maxMs")));
          decay = accumulate ? Math.max(0, ctx.vars.read(v("decayMs"))) : 0;
          limit = 0;
          if (raw.timeoutMs !== undefined) limit = ctx.vars.read(v("timeoutMs"));
          else if (randomTimeout) limit = randomBetween(ctx.random, ctx.vars.read(v("minTimeoutMs")), ctx.vars.read(v("maxTimeoutMs")));
          limit = Math.max(0, limit);
          everHeld = false;
          active = false;
          c0 = cRelease = 0;
          target = holdTarget(ctx, raw.pod);
          watch = null;
          if (!target) {
            ctx.log("info", `${raw.name}: pod not available`);
            return;
          }
          watch = new HoldWatch(target.button);
          watch.enter(enterTime, false);
          idle = limit > 0 ? countdown.effect(color, enterTime, enterTime + limit) : null;
          showRing(ctx, target, frameEffect(ring));
        },
        execute: (ctx) => {
          if (!target || !watch) return "timeout";
          const now = ctx.now();
          for (let again = true; again; ) {
            again = false;
            if (!active && watch.poll()) {
              c0 = accumulate && everHeld ? decayed(watch.at) : 0;
              p = watch.at;
              active = everHeld = true;
            }
            if (!active) break;
            const fullAt = p + onset + (max - c0);
            const rel = watch.released();
            if (rel === undefined) {
              if (now >= fullAt) return fullPort(ctx, fullAt);
            } else if (rel >= fullAt) {
              return fullPort(ctx, fullAt);
            } else if (!accumulate) {
              if (rel - p < onset) return finish(ctx, targets.early !== undefined ? "early" : "released", 0);
              return finish(ctx, "released", Math.min(max, rel - p - onset));
            } else {
              // a release pauses the charge, or drains it
              cRelease = Math.min(max, c0 + Math.max(0, rel - p - onset));
              r = rel;
              active = false;
              watch.rearm();
              again = true;
            }
          }
          if (limit > 0 && now - enterTime >= limit) return timeout(ctx);
          return "running";
        },
        deadline: () => (target && limit > 0 ? enterTime + limit : undefined),
        forceTimeout: (ctx) => (target ? timeout(ctx) : "timeout"),
      };
    }

    case "release": {
      // programs.md 7.14 (ReleaseBlock.cpp, HoldSession.cpp)
      const signal = raw.mode === "signal";
      const holdColor = remoteColor(raw.holdColor, colorToRgb("yellow"));
      const heldColor = remoteColor(raw.heldColor, holdColor);
      const goColor = remoteColor(raw.goColor, colorToRgb("green"));
      const allowHeld = typeof raw.allowHeld === "boolean" ? raw.allowHeld : !signal;
      const record = str(raw.record);
      const storeAs = str(raw.storeAs);
      const countdown = countdownOf(raw);
      let target: HoldTarget | null = null;
      let watch: HoldWatch | null = null;
      let enterTime = 0;
      let holdTimeout = 0;
      let maxHold = 0;
      let goDelay = 0;
      let timeoutMs = 0;
      let cd: RingEffect | null = null;
      const positive = (ctx: Ctx, field: string) => (raw[field] === undefined ? 0 : Math.max(0, ctx.vars.read(v(field))));
      const switchAt = () => watch!.at + goDelay;
      const dark = Array.from({ length: LED_COUNT }, () => OFF);
      const colors = { hold: holdColor, held: heldColor, go: goColor };
      const ring = (t: number): Rgb[] => {
        if (!watch!.started) return releaseRing("waiting", colors);
        if (signal) return t >= switchAt() ? (cd ? renderRing(dark, cd, t) : releaseRing("go", colors)) : releaseRing("held", colors);
        return cd ? renderRing(dark, cd, t) : releaseRing("held", colors);
      };
      const startRing = () => {
        // the countdown starts with the hold (trigger) or with the switch (signal)
        if (signal) cd = timeoutMs > 0 ? countdown.effect(goColor, switchAt(), switchAt() + timeoutMs) : null;
        else cd = maxHold > 0 ? countdown.effect(heldColor, watch!.at, watch!.at + maxHold) : null;
      };
      const leaveWith = (ctx: Ctx, port: string) => {
        resetRing(ctx, target!);
        return port;
      };
      const timeoutAt = () => {
        if (!watch) return undefined;
        if (!watch.started) return holdTimeout > 0 ? enterTime + holdTimeout : undefined;
        if (signal) return timeoutMs > 0 ? switchAt() + timeoutMs : undefined;
        return maxHold > 0 ? watch.at + maxHold : undefined;
      };
      return {
        ...base,
        enter: (ctx) => {
          enterTime = ctx.now();
          holdTimeout = positive(ctx, "holdTimeoutMs");
          maxHold = signal ? 0 : positive(ctx, "maxHoldMs");
          timeoutMs = signal ? positive(ctx, "timeoutMs") : 0;
          goDelay = 0;
          if (signal) {
            const [minF, maxF] = raw.goMs !== undefined ? ["goMs", "goMs"] : ["minGoMs", "maxGoMs"];
            goDelay = randomBetween(ctx.random, positive(ctx, minF), positive(ctx, maxF));
          }
          cd = null;
          target = holdTarget(ctx, raw.pod);
          watch = null;
          if (!target) {
            ctx.log("info", `${raw.name}: pod not available`);
            return;
          }
          watch = new HoldWatch(target.button);
          watch.enter(enterTime, allowHeld);
          if (watch.started) startRing();
          showRing(ctx, target, frameEffect(ring));
        },
        execute: (ctx) => {
          if (!target || !watch) return "timeout";
          const now = ctx.now();
          if (!watch.started && watch.poll()) startRing();
          if (watch.started) {
            const rel = watch.released();
            if (rel !== undefined) {
              if (!signal) {
                if (storeAs) ctx.vars.set(storeAs, rel - watch.at);
                return leaveWith(ctx, "next");
              }
              if (rel < switchAt()) return leaveWith(ctx, "falseStart");
              const reaction = rel - switchAt();
              if (record) {
                ctx.results.record(now, record, target.podId, reaction);
                ctx.log("result", `RESULT,${now},${record},${target.podId},${reaction}`);
              }
              if (storeAs) ctx.vars.set(storeAs, reaction);
              return leaveWith(ctx, "next");
            }
          }
          const at = timeoutAt();
          if (at !== undefined && now >= at) return leaveWith(ctx, watch.started ? "timeout" : "noHold");
          return "running";
        },
        deadline: timeoutAt,
        forceTimeout: (ctx) => (target ? leaveWith(ctx, watch!.started ? "timeout" : "noHold") : "timeout"),
      };
    }

    case "repeat": {
      // RepeatBlock.cpp, programs.md §7.10: counted on execute (once per entry), not on enter
      let counter = 0;
      const storeIndex = str(raw.storeIndex);
      return {
        ...base,
        programStart: () => {
          counter = 0;
        },
        enter: () => undefined,
        execute: (ctx) => {
          counter++;
          if (counter <= ctx.vars.read(v("count"))) {
            if (storeIndex) ctx.vars.set(storeIndex, counter);
            return "body";
          }
          counter = 0;
          return "done";
        },
      };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ simulator */

export type RunOptions = {
  /** pause right after the next block is entered */
  stopOnEnter?: boolean;
  /** pause when one of these blocks is entered */
  breakpoints?: ReadonlySet<string>;
};

/** why `advance` / `step` returned */
export type StopReason = "time" | "paused" | "waiting" | "ended";

export type PodView = {
  id: number;
  central: boolean;
  leds: Rgb[];
  /** a peripheral that is lit and waits for its press */
  state: PeripheralState | "central";
  held: boolean;
};

export type Snapshot = {
  time: number;
  running: boolean;
  current: string | null;
  /** blocks entered so far (for the "edge just taken") */
  previous: string | null;
  variables: Record<string, number>;
  pods: PodView[];
  metrics: { metric: string; count: number; average: number; best: number; worst: number }[];
  measurements: Measurement[];
  log: LogEntry[];
  steps: number;
  /** like `status.timers` (config-api.md §5): `timerStop`s without a running timer since the start */
  timers: { orphanStops: number };
};

export type SimulatorOptions = { seed?: number; logLimit?: number };

export class Simulator {
  readonly peripherals: number;
  readonly centralId: number;
  private readonly blocks = new Map<string, SimBlock>();
  private readonly startName: string | null;
  private readonly initialVariables: Record<string, number>;
  private readonly logLimit: number;

  private ctx!: Ctx;
  private time = 0;
  private running = false;
  private current: string | null = null;
  private previous: string | null = null;
  private stepsInPass = 0;
  private midPass = false;
  private entered = 0;
  private logEntries: LogEntry[] = [];
  private version = 0;
  /** running timers: name → start time (programs.md §7.9) */
  private readonly timers = new Map<string, number>();
  private orphanStops = 0;

  constructor(program: ResolvedProgram, options: SimulatorOptions = {}) {
    const doc = program.doc ?? {};
    this.peripherals = typeof doc.peripherals === "number" && Number.isInteger(doc.peripherals) ? Math.max(0, doc.peripherals) : 0;
    this.centralId = this.peripherals;
    this.logLimit = options.logLimit ?? 500;
    for (const { block } of program.blocks) {
      if (!isObject(block)) continue;
      const sim = createBlock(block);
      if (sim && !this.blocks.has(sim.name)) this.blocks.set(sim.name, sim);
    }
    const first = program.blocks.find((b) => isObject(b.block) && typeof b.block.name === "string");
    this.startName = typeof doc.start === "string" ? doc.start : first ? String(first.block.name) : null;

    // includes first, then the program (resolved.variables); `peripherals` sets two built-ins
    const own = isObject(doc.variables) ? doc.variables : {};
    const vars: Record<string, number> = { ...program.variables };
    if (doc.peripherals !== undefined) {
      if (!("REQUIRED_PERIPHERALS" in own)) vars.REQUIRED_PERIPHERALS = this.peripherals;
      if (!("NODE_COUNT" in own)) vars.NODE_COUNT = this.peripherals + 1;
    }
    this.initialVariables = vars;
    this.reset(options.seed ?? 1);
  }

  /** Back to the start: variables, LEDs, pods, results; the start block is entered at t = 0. */
  reset(seed: number) {
    const vars = new Variables();
    for (const [k, value] of Object.entries(this.initialVariables)) vars.set(k, value);
    this.time = 0;
    this.logEntries = [];
    this.entered = 0;
    this.previous = null;
    this.ctx = {
      now: () => this.time,
      vars,
      button: new Button(),
      leds: Array.from({ length: LED_COUNT }, () => OFF),
      effect: null,
      network: new Network(this.peripherals),
      results: new Results(),
      random: createRandom(seed),
      centralPodId: this.centralId,
      log: (kind, text) => this.log(kind, text),
    };
    this.stepsInPass = 0;
    // BlockManager::start: onProgramStart of every block, all timers stopped, no orphan stops
    for (const block of this.blocks.values()) block.programStart?.();
    this.timers.clear();
    this.orphanStops = 0;
    this.current = this.startName && this.blocks.has(this.startName) ? this.startName : null;
    this.running = this.current !== null;
    if (this.current) this.enter(this.current);
    else this.log("end", "no start block");
    this.midPass = this.running; // the first pass runs at t = 0
    this.version++;
  }

  get changeCount() {
    return this.version;
  }

  get isRunning() {
    return this.running;
  }

  get currentBlock() {
    return this.current;
  }

  /** Press a pod's button (`id` = central for the central). */
  press(id: number) {
    if (id === this.centralId) this.ctx.button.press(this.time);
    else this.ctx.network.press(id, this.time);
    this.version++;
  }

  release(id: number) {
    if (id === this.centralId) this.ctx.button.release(this.time);
    else this.ctx.network.release(id, this.time);
    this.version++;
  }

  /** Runs `ms` of simulated time (one pass per ms), or less if a pause condition is met. */
  advance(ms: number, options: RunOptions = {}): StopReason {
    const target = this.time + Math.max(0, Math.floor(ms));
    while (this.running) {
      if (!this.midPass) {
        if (this.time >= target) return "time";
        this.time++;
        this.ctx.network.tick(this.time);
      }
      if (this.pass(options) === "paused") return "paused";
    }
    return "ended";
  }

  /**
   * Step: runs until the next block is entered, at the current time. A waiting block stays
   * current (returns "waiting") until a press or `skipWait`.
   */
  step(): StopReason {
    if (!this.running) return "ended";
    if (this.pass({ stopOnEnter: true }) === "paused") return "paused";
    if (!this.running) return "ended";
    // pods that light by themselves shortly (syncStartMs) are not a wait for the user
    const block = this.blocks.get(this.current!)!;
    const lights = [this.ctx.network.scheduledUntil, block.pendingLight?.()].filter((t): t is number => t !== undefined && t > this.time);
    if (lights.length) {
      const reason = this.advance(Math.max(...lights) - this.time, { stopOnEnter: true });
      if (reason !== "time") return reason;
    }
    return this.running ? "waiting" : "ended";
  }

  /** The current waiting block's time to end by itself (delay end, timeout), if it has one. */
  deadline(): number | undefined {
    const block = this.current ? this.blocks.get(this.current) : undefined;
    return block?.deadline?.(this.ctx);
  }

  /**
   * Skip wait: jumps to the end of a delay / timeout, or ends the block through its timeout
   * port when it has no deadline. Stops after the next block is entered.
   */
  skipWait(): StopReason {
    if (!this.running || !this.current) return "ended";
    const block = this.blocks.get(this.current)!;
    const at = block.deadline?.(this.ctx);
    if (at !== undefined) {
      while (this.time < at) {
        this.time++;
        this.ctx.network.tick(this.time);
      }
      this.midPass = true;
      return this.advance(0, { stopOnEnter: true });
    }
    if (block.forceTimeout) {
      const port = block.forceTimeout(this.ctx);
      if (port === "running") return "waiting";
      this.leave(block, port);
      this.version++;
      return this.running ? "paused" : "ended";
    }
    return "waiting";
  }

  snapshot(): Snapshot {
    const pods: PodView[] = this.ctx.network.pods.map((p, id) => ({
      id,
      central: false,
      leds: renderRing(Array.from({ length: LED_COUNT }, () => p.color), p.effect, this.time),
      state: p.state,
      held: p.button.down,
    }));
    pods.push({ id: this.centralId, central: true, leds: renderRing(this.ctx.leds, this.ctx.effect, this.time), state: "central", held: this.ctx.button.down });
    const results = this.ctx.results;
    const metrics = [...new Set([...results.names(), ...results.all.map((m) => m.metric)])].map((metric) => ({ metric, ...results.stats(metric) }));
    return {
      time: this.time,
      running: this.running,
      current: this.current,
      previous: this.previous,
      variables: Object.fromEntries([...this.ctx.vars.values.entries()].sort(([a], [b]) => a.localeCompare(b))),
      pods,
      metrics,
      measurements: [...results.all],
      log: [...this.logEntries],
      steps: this.entered,
      timers: { orphanStops: this.orphanStops },
    };
  }

  /**
   * A pause on the pod (a peripheral was lost, BlockManager::restartCurrentBlock): the current
   * block is entered again, its times and random values are taken anew. The block is not left,
   * so its timers are neither started nor stopped and keep running.
   */
  restartCurrentBlock() {
    if (!this.running || !this.current) return;
    this.enter(this.current, false);
    this.version++;
  }

  /** Text of the log, like the pod's serial output with `trace on` (block events + RESULT / SUMMARY). */
  traceText(): string {
    return this.logEntries.map((e) => (e.kind === "enter" ? `{"event":"block","name":"${e.block}","t":${e.t}}` : e.text)).join("\n");
  }

  /* -------------------------------------------------------------- engine pass */

  private pass(options: RunOptions): "idle" | "paused" {
    while (this.running && this.stepsInPass < MAX_STEPS_PER_PASS) {
      const block = this.blocks.get(this.current!)!;
      const port = block.execute(this.ctx);
      if (port === "running") {
        this.endPass();
        return "idle";
      }
      this.stepsInPass++;
      const next = this.leave(block, port);
      if (next && (options.stopOnEnter || options.breakpoints?.has(next))) {
        this.midPass = this.stepsInPass < MAX_STEPS_PER_PASS;
        if (!this.midPass) this.stepsInPass = 0;
        this.version++;
        return "paused";
      }
    }
    this.endPass(); // step limit: the entered block runs in the next pass
    return "idle";
  }

  private endPass() {
    this.stepsInPass = 0;
    this.midPass = false;
    this.version++;
  }

  /** Port selection of BlockManager::run, then exit + enter. Returns the entered block. */
  private leave(block: SimBlock, port: string): string | null {
    let next = block.targets[port];
    if (next === undefined && port !== block.ports[0] && block.ports[0] === "next") next = block.targets.next;
    block.exit?.(this.ctx);
    this.stopTimer(block); // after exit, before the next block's start, also when the program ends here
    if (next === undefined || !this.blocks.has(next)) {
      this.running = false;
      this.midPass = false;
      this.log("end", `program ended in block '${block.name}' (${port})`);
      return null;
    }
    this.previous = block.name;
    this.current = next;
    this.enter(next);
    return next;
  }

  /** BlockManager::stopTimer: records now − start for the central, or counts an orphan stop. */
  private stopTimer(block: SimBlock) {
    const name = block.timerStop;
    if (name === undefined) return;
    const start = this.timers.get(name);
    if (start === undefined) {
      this.orphanStops++;
      this.log("info", `timer '${name}' stopped in '${block.name}' but not running`);
      return;
    }
    this.timers.delete(name);
    const ms = this.time - start;
    this.ctx.results.record(this.time, name, this.centralId, ms);
    this.log("result", `RESULT,${this.time},${name},${this.centralId},${ms}`);
  }

  /** BlockManager::enterCurrent; `applyTimers` = false after a pause (the block was not left). */
  private enter(name: string, applyTimers = true) {
    const block = this.blocks.get(name)!;
    if (applyTimers && block.timerStart !== undefined) this.timers.set(block.timerStart, this.time); // restarts a running one
    block.enter(this.ctx);
    this.entered++;
    this.logEntries.push({ t: this.time, kind: "enter", text: name, block: name });
    this.trimLog();
  }

  private log(kind: LogKind, text: string) {
    this.logEntries.push({ t: this.time, kind, text });
    this.trimLog();
  }

  private trimLog() {
    if (this.logEntries.length > this.logLimit) this.logEntries.splice(0, this.logEntries.length - this.logLimit);
  }
}
