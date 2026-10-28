import { describe, expect, it } from "vitest";
import { BUILTIN_VARIABLES, blockType, hasErrors, isObject, validateProgram, type Block, type Issue } from "@reactpod/program-model";
import { DEFAULT_FILES } from "../defaults";
import { Simulator } from "../simulator/engine";
import { generateProgram } from "../wizard/generate";
import { defaultAnswers, setTimeLimit, type WizardAnswers } from "../wizard/answers";
import { ownBlocks, type ProgramJson } from "./ops";
import { stepList } from "./structure";
import {
  INTENTS,
  RECIPES,
  applyRecipe,
  createStep,
  defaultInsertAfter,
  intentUnavailable,
  recipeUnavailable,
  type Added,
} from "./stepRecipes";

const PATH = "/prog/test.json";

const wizard = (a: WizardAnswers, form: "repeat" | "counter") => generateProgram(a, form);
const answers = (game: Parameters<typeof defaultAnswers>[0], change: (a: WizardAnswers) => WizardAnswers = (a) => a) => change(defaultAnswers(game, 3));

const DOCS: [string, ProgramJson][] = [
  ["solo.json", JSON.parse(DEFAULT_FILES["/prog/solo.json"]!) as ProgramJson],
  ["wizard solo (counter)", wizard(answers("solo"), "counter")],
  ["wizard solo (repeat)", wizard(answers("solo"), "repeat")],
  ["wizard star, time limit (repeat)", wizard(answers("star", (a) => setTimeLimit(a, true)), "repeat")],
  ["wizard random (counter)", wizard(answers("random"), "counter")],
  ["wizard multi, red pods (repeat)", wizard(answers("multi", (a) => ({ ...a, redPods: 1 })), "repeat")],
  ["wizard duo, no recording (counter)", wizard(answers("duo", (a) => ({ ...a, measure: { ...a.measure, record: false, results: false } })), "counter")],
  ["wizard solo, no false start (repeat)", wizard(answers("solo", (a) => ({ ...a, measure: { ...a.measure, falseStart: false } })), "repeat")],
];

function validate(doc: ProgramJson) {
  const text = JSON.stringify(doc);
  return validateProgram(PATH, (p) => (p === PATH ? text : DEFAULT_FILES[p]), { programFormat: 4 });
}

const key = (i: Issue) => `${i.code}|${i.block ?? ""}|${i.field ?? ""}`;

/** Variable and metric names the program's blocks use. */
function names(doc: ProgramJson): { variables: Set<string>; metrics: Set<string> } {
  const variables = new Set<string>();
  const metrics = new Set<string>();
  for (const b of ownBlocks(doc)) {
    for (const field of blockType(b.type)?.fields ?? []) {
      const v = b[field.name];
      if (typeof v !== "string") continue;
      if (field.kind === "value" || field.kind === "variable") variables.add(v);
      if (field.kind === "metric" && field.name !== "timerStart" && field.name !== "timerStop") metrics.add(v);
    }
  }
  return { variables, metrics };
}

/** Checks a result: no new problem, no placeholder, every name declared or already used. */
function check(label: string, before: ProgramJson, added: Added) {
  const { doc, focus } = added;
  expect(ownBlocks(doc).some((b) => b.name === focus), `${label}: focus ${focus}`).toBe(true);
  const old = new Set(validate(before).issues.map(key));
  const issues = validate(doc).issues;
  expect(hasErrors(issues), `${label}: ${JSON.stringify(issues)}`).toBe(false);
  expect(issues.map(key).filter((k) => !old.has(k)), label).toEqual([]);
  const was = names(before);
  const now = names(doc);
  const declared = new Set([...Object.keys(isObject(doc.variables) ? doc.variables : {}), ...BUILTIN_VARIABLES]);
  for (const v of now.variables) {
    expect(v, label).not.toBe("VALUE");
    expect(was.variables.has(v) || declared.has(v), `${label}: variable ${v}`).toBe(true);
  }
  for (const m of now.metrics) expect(was.metrics.has(m), `${label}: new metric ${m}`).toBe(true);
  // every step is still in the list: nothing was cut off
  const listed = new Set(stepList(doc).flatMap((s) => (s.loop ? s.loop.hidden : [s.block])));
  for (const b of ownBlocks(doc)) expect(listed.has(b.name), `${label}: ${b.name} listed`).toBe(true);
  expect(stepList(doc).some((s) => s.unreachable), `${label}: unreachable steps`).toBe(stepList(before).some((s) => s.unreachable));
}

/**
 * Plays the program with a bot: most turns it waits a moment and presses everything that is lit
 * (and the central), every fourth turn it lets the time run out. Returns the blocks entered.
 */
function play(doc: ProgramJson, turns = 40): { entered: Set<string>; sim: Simulator } {
  const sim = new Simulator(validate(doc), { seed: 3, logLimit: 1_000_000 });
  for (let i = 0; i < turns && sim.isRunning; i++) {
    sim.advance(i % 4 === 3 ? 6000 : 350);
    const ids = sim.snapshot().pods.filter((p) => p.central || p.state === "active").map((p) => p.id);
    for (const id of ids) sim.press(id);
    sim.advance(40);
    for (const id of ids) sim.release(id);
  }
  const entered = new Set(sim.snapshot().log.filter((e) => e.kind === "enter" && e.block).map((e) => e.block!));
  return { entered, sim };
}

/** Where a step can be added: nothing selected, and after every own step and loop. */
function positions(doc: ProgramJson): (string | undefined)[] {
  const own = new Set(ownBlocks(doc).map((b) => b.name));
  return [undefined, ...stepList(doc).map((s) => s.block).filter((b) => own.has(b))];
}

describe("add a step: tiles", () => {
  for (const [label, doc] of DOCS) {
    it(`${label}: every tile at every place validates and adds no placeholder`, () => {
      for (const { id } of INTENTS) {
        for (const after of positions(doc)) {
          if (intentUnavailable(id, doc, { after })) continue;
          check(`${id} after ${after}`, doc, createStep(id, doc, after));
        }
      }
    });

    it(`${label}: every tile runs in the simulator`, () => {
      for (const { id } of INTENTS) {
        if (intentUnavailable(id, doc)) continue;
        const added = createStep(id, doc);
        const { entered } = play(added.doc);
        expect(entered.has(added.focus), `${id}: ${added.focus} entered`).toBe(true);
      }
    });
  }

  it("takes values from the context", () => {
    const star = DOCS[3]![1];
    const press = createStep("press", star);
    const block = ownBlocks(press.doc).find((b) => b.name === press.focus)!;
    expect(block).toMatchObject({ type: "button", timeoutMs: "TIME_LIMIT_MS", record: "reaction" });
    const pod = createStep("pod", star);
    expect(ownBlocks(pod.doc).find((b) => b.name === pod.focus)).toMatchObject({ pod: 0, color: "green", timeoutMs: "TIME_LIMIT_MS", record: "reaction" });
    // solo.json: after "Hit" the last light was green ("Go"); the cyan comes after
    const solo = DOCS[0]![1];
    const led = createStep("light", solo, "Hit");
    expect(ownBlocks(led.doc).find((b) => b.name === led.focus)).toEqual({ name: "Led1", type: "led", color: "green", next: "HitLED" });
    // no recording in the round: the press does not record and results are not offered
    const duo = DOCS[6]![1];
    expect(ownBlocks(createStep("press", duo).doc).find((b) => b.name === "Button1")!.record).toBeUndefined();
    expect(intentUnavailable("results", duo)).toBe("noMetric");
  });

  it("counts into MISSES and declares it once", () => {
    const solo = DOCS[0]![1];
    const { doc, focus } = createStep("count", solo, "Hit");
    expect(doc.variables).toEqual({ MISSES: 0 });
    expect(ownBlocks(doc).find((b) => b.name === focus)).toMatchObject({ var: "MISSES", op: "+", value: 1 });
    const decide = createStep("decide", doc, focus);
    expect(decide.doc.variables).toEqual({ MISSES: 0 });
    const block = ownBlocks(decide.doc).find((b) => b.name === decide.focus)!;
    expect(block).toMatchObject({ left: "MISSES", op: ">=", right: 3, true: "HitLED", false: "HitLED" });
  });

  it("adds after a decision where both answers meet", () => {
    const random = DOCS[4]![1];
    const { doc, focus } = createStep("light", random, "IsCentral");
    const steps = stepList(doc).map((s) => s.block);
    expect(steps.indexOf(focus)).toBeGreaterThan(steps.indexOf("PodTarget"));
    expect(ownBlocks(doc).filter((b) => Object.values(b).includes(focus)).length).toBeGreaterThan(1);
  });

  it("marks tiles the pod cannot run", () => {
    const doc = DOCS[1]![1];
    expect(intentUnavailable("repeat", doc, { programFormat: 1 })).toBe("needsFormat");
    expect(intentUnavailable("repeat", doc, { programFormat: 3 })).toBeNull();
    expect(intentUnavailable("repeat", doc)).toBeNull();
    expect(intentUnavailable("race", doc, { supportedTypes: ["led", "delay"] })).toBe("unsupported");
    expect(intentUnavailable("pod", doc)).toBe("noPods");
  });

  it("domination needs format 4 and pods", () => {
    const doc = { ...DOCS[1]![1], peripherals: 2 };
    expect(intentUnavailable("domination", doc, { programFormat: 3 })).toBe("needsFormat");
    expect(intentUnavailable("domination", doc, { programFormat: 4 })).toBeNull();
    expect(intentUnavailable("domination", doc, { supportedTypes: ["led", "delay"] })).toBe("unsupported");
    expect(intentUnavailable("domination", { ...doc, peripherals: 0 })).toBe("noPods");
    const added = createStep("domination", doc);
    expect(ownBlocks(added.doc).find((b) => b.name === added.focus)).toMatchObject({ type: "toggle", durationMs: 30000 });
  });

  it("starts an empty program", () => {
    const empty: ProgramJson = { version: 1, name: "Empty", peripherals: 0, menu: [], blocks: [] };
    expect(defaultInsertAfter(empty)).toBeUndefined();
    const { doc, focus } = createStep("light", empty);
    expect(doc.start).toBe(focus);
  });
});

describe("add a step: recipes", () => {
  for (const [label, doc] of DOCS) {
    it(`${label}: every recipe validates, adds no placeholder and runs`, () => {
      for (const recipe of RECIPES) {
        for (const after of positions(doc)) {
          if (recipeUnavailable(recipe, doc, { after })) continue;
          check(`${recipe} after ${after}`, doc, applyRecipe(recipe, doc, after));
        }
        if (recipeUnavailable(recipe, doc)) continue;
        const added = applyRecipe(recipe, doc);
        expect(play(added.doc).entered.has(added.focus), `${recipe} runs`).toBe(true);
      }
    });
  }

  it("count a miss when too slow: misses are counted", () => {
    expect(recipeUnavailable("countMiss", DOCS[3]![1])).toBe("noPress"); // counts them already
    const random = DOCS[4]![1];
    expect(recipeUnavailable("countMiss", random)).toBeNull();
    const { doc } = applyRecipe("countMiss", random);
    expect((doc.variables as Record<string, number>).MISSES).toBe(0);
    const { sim } = play(doc);
    expect(sim.snapshot().variables.MISSES).toBeGreaterThan(0);
    // applied once, nothing is left to do
    expect(recipeUnavailable("countMiss", doc)).toBe("noPress");
  });

  it("count a miss when too slow: a press without a time limit gets the round's or 2 s", () => {
    const solo = DOCS[0]![1];
    const { doc, focus } = applyRecipe("countMiss", solo);
    expect(focus).toBe("Hit");
    const hit = ownBlocks(doc).find((b) => b.name === "Hit")!;
    expect(hit).toMatchObject({ timeoutMs: 2000, timeout: "HitMiss" });
    expect(ownBlocks(doc).find((b) => b.name === "HitMiss")).toEqual({ name: "HitMiss", type: "setVariable", var: "MISSES", op: "+", value: 1, next: "HitLED" });
  });

  it("pause between rounds goes at the end of the round", () => {
    const star = DOCS[3]![1];
    const { doc, focus } = applyRecipe("pauseBetweenRounds", star, "Pause");
    expect(ownBlocks(doc).find((b) => b.name === focus)).toMatchObject({ type: "delay", ms: 2000, next: "Rounds" });
    const round = stepList(doc).filter((s) => s.inLoop === "Rounds" && s.depth === 1);
    expect(round[round.length - 1]!.block).toBe(focus);
  });

  it("flash red on a false start turns the first pause into a catching one", () => {
    const solo = DOCS[7]![1];
    expect(recipeUnavailable("flashFalseStart", DOCS[0]![1])).toBe("noPause"); // solo.json catches them already
    expect(recipeUnavailable("flashFalseStart", DOCS[2]![1])).toBe("noPause"); // so does the wizard's solo
    const { doc, focus } = applyRecipe("flashFalseStart", solo);
    expect(focus).toBe("Wait");
    const wait = ownBlocks(doc).find((b) => b.name === "Wait")!;
    expect(wait).toMatchObject({ type: "button", minTimeoutMs: "PAUSE_MIN_MS", maxTimeoutMs: "PAUSE_MAX_MS", pressed: "WaitFalseStart", timeout: "Go" });
    const off = ownBlocks(doc).find((b) => b.name === "WaitFalseStartOff") as Block;
    expect(off.next).toBe("Rounds");
    const { entered } = play(doc);
    expect(entered.has("WaitFalseStart")).toBe(true);
  });
});
