import { describe, expect, it } from "vitest";
import { colorToRgb, validateProgram, type Block } from "@reactpod/program-model";
import { Simulator } from "../simulator/engine";
import { LOOP, generateProgram, loopFormFor, storyOf, describeAnswers } from "./generate";
import {
  GAMES,
  answerProblems,
  defaultAnswers,
  gameNeeds,
  normalizeAnswers,
  podsUsed,
  setCountMisses,
  setOnTimeout,
  setTimeLimit,
  type GameId,
  type OnTimeout,
  type WizardAnswers,
} from "./answers";
import i18next from "i18next";
import en from "../i18n/en.json";
import de from "../i18n/de.json";

const i18n = i18next.createInstance();
await i18n.init({ lng: "en", fallbackLng: false, resources: { en: { translation: en }, de: { translation: de } }, interpolation: { escapeValue: false } });

const PATH = "/prog/wizard.json";

function resolve(a: WizardAnswers) {
  const json = generateProgram(a, "counter");
  return { json, resolved: validateProgram(PATH, (p) => (p === PATH ? JSON.stringify(json) : undefined)) };
}

/** Every answer combination worth checking for a game. */
function variants(game: GameId): WizardAnswers[] {
  const out: WizardAnswers[] = [];
  const base = defaultAnswers(game, Math.max(gameNeeds(game).minPods, 3));
  const limits: (OnTimeout | null)[] = [null, "goOn", "countMiss", "endRound"];
  for (const pause of [{ kind: "fixed", ms: 1500 }, { kind: "random", minMs: 500, maxMs: 2500 }] as const) {
    for (const limit of limits) {
      for (const record of [true, false]) {
        for (const extra of [false, true]) {
          let a: WizardAnswers = { ...base, pause, measure: { ...base.measure, record, results: record } };
          a = setTimeLimit(a, limit !== null);
          if (limit) a = setOnTimeout(a, limit);
          if (game === "solo") a = { ...a, measure: { ...a.measure, falseStart: extra } };
          if (game === "multi") a = { ...a, redPods: extra ? 2 : 0 };
          if (game !== "solo" && game !== "multi" && extra) a = { ...a, pods: 7 };
          a = normalizeAnswers(a);
          out.push(a, setCountMisses(a, !a.measure.countMisses));
        }
      }
    }
  }
  return out.map(normalizeAnswers);
}

/** Measurements a fully played round gives. */
const perRound = (a: WizardAnswers) => ({ solo: 1, star: 2, random: 1, multi: podsUsed(a) + 1 - Math.min(a.redPods, podsUsed(a)), duo: 2 })[a.game];

type Script = {
  /** 1-based rounds in which nothing is pressed (time limit runs out) */
  idle?: Set<number>;
  /** rounds with a false start (solo) */
  early?: Set<number>;
  /** rounds in which a red pod is pressed (multi) */
  red?: Set<number>;
  reactionMs?: number;
};

/**
 * Plays one series to the end: presses every target `reactionMs` after it lights.
 * Returns the simulator when the finish step (blue, results) is entered.
 */
function play(a: WizardAnswers, json: Record<string, unknown>, script: Script = {}) {
  const resolved = validateProgram(PATH, (p) => (p === PATH ? JSON.stringify(json) : undefined));
  const sim = new Simulator(resolved, { seed: 7, logLimit: 1_000_000 });
  const blocks = json.blocks as Block[];
  const byName = new Map(blocks.map((b) => [b.name, b]));
  const waits = new Set(blocks.filter((b) => b.type === "button" || b.type === "remotePress" || b.type === "remoteMultiPress").map((b) => b.name));
  waits.add(LOOP.finish);
  const target = colorToRgb(a.color);
  const reaction = script.reactionMs ?? 250;
  const click = (ids: number[]) => {
    for (const id of ids) sim.press(id);
    atBreakpoint = sim.advance(40, { breakpoints: waits }) === "paused";
    for (const id of ids) sim.release(id);
  };
  let atBreakpoint = false;
  for (let guard = 0; guard < 1000; guard++) {
    if (!atBreakpoint) expect(sim.advance(120_000, { breakpoints: waits })).toBe("paused");
    atBreakpoint = false;
    const name = sim.currentBlock!;
    const round = sim.snapshot().variables.RUNS!;
    if (name === LOOP.finish) return { sim, rounds: round };
    const block = byName.get(name)!;
    if (name === "Wait") {
      if (script.early?.has(round)) {
        sim.advance(100);
        click([sim.centralId]);
      }
      continue;
    }
    if (script.idle?.has(round)) continue;
    sim.advance(reaction);
    const snap = sim.snapshot();
    const same = (rgb: number[]) => rgb.every((v, i) => v === target[i]);
    let ids: number[];
    if (block.type === "remoteMultiPress" && script.red?.has(round)) {
      ids = snap.pods.filter((p) => !p.central && p.state === "active" && !same(p.leds[0]!)).map((p) => p.id);
      if (ids.length === 0 && !same(snap.pods.find((p) => p.central)!.leds[0]!)) ids = [sim.centralId];
      ids = ids.slice(0, 1);
    } else if (block.type === "button") {
      ids = [sim.centralId];
    } else {
      ids = snap.pods.filter((p) => (p.central ? block.type === "remoteMultiPress" && same(p.leds[0]!) : p.state === "active" && same(p.leds[0]!))).map((p) => p.id);
    }
    expect(ids.length, `${name} round ${round}: something to press`).toBeGreaterThan(0);
    click(ids);
  }
  throw new Error("the series did not end");
}


describe("wizard answers", () => {
  it("knows what each game needs", () => {
    expect(GAMES.map((g) => gameNeeds(g).minPods)).toEqual([0, 1, 1, 2, 1]);
    expect(answerProblems(defaultAnswers("multi", 1))).toEqual(["notEnoughPods"]);
    expect(answerProblems(defaultAnswers("multi", 2))).toEqual([]);
    expect(answerProblems({ ...defaultAnswers("solo", 0), pause: { kind: "random", minMs: 2000, maxMs: 2000 } })).toEqual(["pauseOrder"]);
    expect(answerProblems({ ...defaultAnswers("multi", 3), color: "red" })).toEqual(["redTarget"]);
  });

  it("keeps the miss switch and 'if too slow' in step", () => {
    let a = setTimeLimit(defaultAnswers("star", 3), true);
    expect(a.timeLimit).toEqual({ ms: 2000, onTimeout: "countMiss" });
    expect(a.measure.countMisses).toBe(true);
    a = setCountMisses(a, false);
    expect(a.timeLimit!.onTimeout).toBe("goOn");
    a = setOnTimeout(a, "countMiss");
    expect(a.measure.countMisses).toBe(true);
    a = setTimeLimit(a, false);
    expect(a.measure.countMisses).toBe(false); // nothing left to count
  });

  it("clamps numbers and drops answers of other games", () => {
    const a = normalizeAnswers({ ...defaultAnswers("star", 3), rounds: 500, redPods: 3, pods: 12, color: "off", measure: { record: true, countMisses: true, results: true, falseStart: true } });
    expect(a.rounds).toBe(99);
    expect(a.pods).toBe(7);
    expect(a.redPods).toBe(0);
    expect(a.color).toBe("green");
    expect(a.measure.falseStart).toBe(false);
    expect(a.measure.countMisses).toBe(false);
  });

  it("picks the loop form from the pod's program format", () => {
    expect(loopFormFor(undefined)).toBe("counter");
    expect(loopFormFor(1)).toBe("counter");
    expect(loopFormFor(2)).toBe("repeat");
    expect(loopFormFor(3)).toBe("repeat");
  });
});

describe("generated programs (counter form)", () => {
  for (const game of GAMES) {
    it(`${game}: every answer combination validates without a note`, () => {
      for (const a of variants(game)) {
        const { json, resolved } = resolve(a);
        expect(resolved.issues, JSON.stringify(a)).toEqual([]);
        expect(json.include).toBeUndefined();
        expect(json.peripherals).toBe(podsUsed(a));
        expect((json.variables as Record<string, number>).ROUNDS).toBe(a.rounds);
      }
    });

    it(`${game}: plays every combination to the end in the simulator`, () => {
      for (const a of variants(game)) {
        const short = { ...a, rounds: 3 };
        const { json } = resolve(short);
        const { sim, rounds } = play(short, json);
        const snap = sim.snapshot();
        expect(rounds, JSON.stringify(short)).toBe(3);
        expect(snap.variables.RUNS).toBe(3);
        expect(snap.measurements.length).toBe(a.measure.record ? 3 * perRound(short) : 0);
        // all at once lights 20 ms after the block starts (syncStartMs)
        if (a.measure.record) expect(snap.measurements.every((m) => m.ms === (a.game === "multi" ? 230 : 250))).toBe(true);
        if ("MISSES" in snap.variables) expect(snap.variables.MISSES).toBe(0);
      }
    });
  }

  it("shows the results at the end and starts again", () => {
    const a = { ...defaultAnswers("star", 3), rounds: 4 };
    const { json } = resolve(a);
    const { sim } = play(a, json);
    sim.advance(5);
    const summary = sim.snapshot().log.filter((e) => e.kind === "summary");
    expect(summary.map((e) => e.text)).toEqual(["SUMMARY,reaction,8,250,250,250"]);
    expect(sim.snapshot().variables.AVG_REACTION).toBe(250);
    sim.advance(3100);
    expect(sim.snapshot().variables.RUNS).toBe(1); // the next series has begun
  });

  it("counts misses when too slow and goes on", () => {
    let a: WizardAnswers = { ...defaultAnswers("duo", 1), rounds: 4 };
    expect(a.timeLimit).toEqual({ ms: 5000, onTimeout: "countMiss" });
    const { json } = resolve(a);
    const { sim } = play(a, json, { idle: new Set([2, 3]) });
    const snap = sim.snapshot();
    expect(snap.variables.MISSES).toBe(4); // central and pod in rounds 2 and 3
    expect(snap.measurements).toHaveLength(4);
    sim.advance(3100);
    expect(sim.snapshot().variables.MISSES).toBe(0); // reset for the next series

    a = setOnTimeout({ ...defaultAnswers("star", 2), rounds: 3 }, "goOn");
    a = setTimeLimit(a, true);
    a = setOnTimeout(a, "goOn");
    const goOn = play(a, resolve(a).json, { idle: new Set([2]) }).sim.snapshot();
    expect(goOn.variables.MISSES).toBeUndefined();
    expect(goOn.measurements).toHaveLength(4);
  });

  it("ends the round when too slow (and counts it if asked)", () => {
    let a: WizardAnswers = setTimeLimit({ ...defaultAnswers("star", 3), rounds: 3 }, true);
    a = setOnTimeout(a, "endRound");
    a = setCountMisses(a, true);
    const { json } = resolve(a);
    const blocks = json.blocks as Block[];
    expect(blocks.find((b) => b.name === "CentralPress")!.timeout).toBe("CentralPressMiss");
    expect(blocks.find((b) => b.name === "CentralPressMiss")!.next).toBe("EndRound");
    const { sim } = play(a, json, { idle: new Set([2]) });
    const snap = sim.snapshot();
    expect(snap.variables.MISSES).toBe(1); // the pod step of round 2 never came
    expect(snap.measurements).toHaveLength(4);
    const entered = snap.log.filter((e) => e.kind === "enter").map((e) => e.block);
    expect(entered.filter((b) => b === "PodTarget")).toHaveLength(2);
  });

  it("solo: a false start flashes red, counts a miss and uses up the round", () => {
    const a = { ...defaultAnswers("solo", 0), rounds: 3 };
    expect(a.measure.falseStart).toBe(true);
    const withMiss = setCountMisses(setTimeLimit(a, true), true);
    const { json } = resolve(withMiss);
    expect((json.blocks as Block[]).find((b) => b.name === "Wait")).toMatchObject({ type: "button", minTimeoutMs: "PAUSE_MIN_MS", maxTimeoutMs: "PAUSE_MAX_MS", pressed: "WaitFalseStart" });
    const { sim, rounds } = play(withMiss, json, { early: new Set([2]) });
    const snap = sim.snapshot();
    expect(rounds).toBe(3);
    expect(snap.variables.MISSES).toBe(1);
    expect(snap.measurements).toHaveLength(2);
    expect(snap.log.some((e) => e.block === "WaitFalseStart")).toBe(true);
  });

  it("multi: hitting a red pod flashes red, counts a miss and ends the round", () => {
    const a = setCountMisses({ ...defaultAnswers("multi", 3), rounds: 3, redPods: 1 }, true);
    expect(a.measure.countMisses).toBe(true);
    const { json } = resolve(a);
    const all = (json.blocks as Block[]).find((b) => b.name === "AllAtOnce")!;
    expect(all).toMatchObject({ avoid: "RED_PODS", avoidHit: "AllAtOnceRedHit", hitColor: "green", pods: "REQUIRED_PERIPHERALS" });
    const { sim, rounds } = play(a, json, { red: new Set([1]) });
    const snap = sim.snapshot();
    expect(rounds).toBe(3);
    expect(snap.variables.MISSES).toBe(1);
    expect(snap.measurements).toHaveLength(2 * 3); // 3 pods + central, 1 red → 3 green per round
  });

  it("random: lights the central as one of the pods, never the same twice", () => {
    const a = { ...defaultAnswers("random", 2), rounds: 12 };
    const { json } = resolve(a);
    const { sim } = play(a, json);
    const pods = sim.snapshot().measurements.map((m) => m.pod);
    expect(pods).toHaveLength(12);
    expect(new Set(pods)).toEqual(new Set([0, 1, 2]));
    for (let i = 1; i < pods.length; i++) expect(pods[i]).not.toBe(pods[i - 1]);
  });

  it("keeps the answers in variables and the menu pattern", () => {
    const a = { ...defaultAnswers("multi", 4), name: "Sprint", rounds: 20, redPods: 2, color: "cyan", menuLeds: [1, 2, 3] };
    const json = generateProgram(setTimeLimit(a, true), "counter");
    expect(json).toMatchObject({
      name: "Sprint",
      peripherals: 4,
      menu: [{ leds: [1, 2, 3], color: "cyan" }],
      start: "StartLoop",
      variables: { ROUNDS: 20, RUNS: 0, PAUSE_MS: 3000, TIME_LIMIT_MS: 2000, RED_PODS: 2, MISSES: 0 },
    });
  });
});

describe("generated programs (repeat form)", () => {
  // Validation and simulation follow in Wave 2, when the model knows `repeat`.
  it("loops with a repeat block and links the round back to it", () => {
    const json = generateProgram({ ...defaultAnswers("star", 3), rounds: 5 }, "repeat");
    const blocks = json.blocks as Block[];
    expect(json.start).toBe("Rounds");
    expect(blocks[0]).toEqual({ name: "Rounds", type: "repeat", count: "ROUNDS", storeIndex: "RUNS", body: "Pause", done: "StartReset" });
    expect(blocks.find((b) => b.name === "PodTarget")!.next).toBe("Rounds");
    expect(blocks.some((b) => b.name === "StartLoop" || b.name === "EndLoop" || b.name === "ResetRuns")).toBe(false);
    expect(blocks.at(-1)!.next).toBe("Rounds");
  });
});

describe("story", () => {
  it("tells each game in both languages", async () => {
    for (const lng of ["en", "de"]) {
      await i18n.changeLanguage(lng);
      for (const game of GAMES) {
        const a = setTimeLimit(defaultAnswers(game, 3), true);
        const story = storyOf(a, i18n.t);
        expect(story.steps.length).toBeGreaterThan(1);
        const text = describeAnswers(a, i18n.t);
        expect(text).not.toMatch(/wizard\.|{{|undefined/);
      }
    }
    await i18n.changeLanguage("en");
    const a = setTimeLimit({ ...defaultAnswers("star", 3), rounds: 12, pause: { kind: "random", minMs: 1000, maxMs: 3000 } }, true);
    expect(describeAnswers(a, i18n.t)).toContain("12 rounds");
    expect(describeAnswers(a, i18n.t)).toContain("1–3 s");
    expect(describeAnswers(a, i18n.t)).toContain("max 2 s");
  });
});
