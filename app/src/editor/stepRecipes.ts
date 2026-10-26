/**
 * "Add a step" by intent (docs/app/editor-ux.md §4 E): one step per tile, and recipes that add or
 * change several blocks at once. Pure: every function returns a new document.
 *
 * Values come from the context (problem 5 in editor-ux.md §1): the colour of the previous light,
 * the time limit and the recorded metric already used in the round. Nothing creates a placeholder
 * variable or metric: a counter is the program's `MISSES` (declared with 0 when it is missing),
 * "Show results" needs a step that records times, and recording reuses the round's metric.
 *
 * Single steps are inserted with `ops.addStep`; this module fills in their fields and the ports
 * `addStep` cannot know (both answers of a decision, the round of a repeat).
 */
import { BUILTIN_VARIABLES, blockType, isNamedColor, isObject, type Block, type Value } from "@reactpod/program-model";
import { MISSES } from "../programs/recipes/fragments";
import { DEFAULT_MAX_MS } from "./holdStep";
import { addStep, newBlockName, ownBlocks, uniqueName, type ProgramJson } from "./ops";
import { detectLoops, entryOf, isCatchEarly, mainPort, stepFamily, stepList, stepNeighbours, type Step } from "./structure";

/** Single steps, in the order of the tiles. */
export const INTENTS = [
  { id: "light", type: "led" },
  { id: "effect", type: "effect" },
  { id: "pause", type: "delay" },
  { id: "press", type: "button" },
  { id: "pod", type: "remotePress" },
  { id: "race", type: "remoteMultiPress" },
  { id: "charge", type: "charge" },
  { id: "release", type: "release" },
  { id: "count", type: "setVariable" },
  { id: "decide", type: "if" },
  { id: "repeat", type: "repeat" },
  { id: "results", type: "summary" },
  { id: "off", type: "remoteResetAll" },
] as const;

export type Intent = (typeof INTENTS)[number]["id"];

export const RECIPES = ["countMiss", "pauseBetweenRounds", "flashFalseStart"] as const;
export type Recipe = (typeof RECIPES)[number];

/** Why a tile or recipe cannot be used here (i18n `editor.add.reason.<reason>`). */
export type Unavailable =
  | "noPods" // the program uses no pods besides the central
  | "noMetric" // nothing records a time yet
  | "needsFormat" // the connected pod's program format is too old
  | "unsupported" // the connected pod does not have this block type
  | "noPress" // no press step in the round (that does not count misses already)
  | "noPause"; // no pause before a press in the round

export type Added = { doc: ProgramJson; focus: string };

export type AddOptions = {
  /** block names that are taken besides the program's own (blocks of included files) */
  taken?: ReadonlySet<string>;
};

const PRESS_TYPES = new Set(["button", "remotePress", "remoteMultiPress"]);
const DEFAULT_LIMIT_MS = 2000;
const BETWEEN_ROUNDS_MS = 2000;
const FLASH_MS = 1000;

/* ------------------------------------------------------------------ context */

type Context = {
  doc: ProgramJson;
  steps: Step[];
  blocks: Map<string, Block>;
  /** the step the new one goes after */
  after?: string;
  /** loop head of the round `after` is in, else of the first round */
  round?: string;
};

function contextOf(doc: ProgramJson, after?: string): Context {
  const steps = stepList(doc);
  const blocks = new Map(ownBlocks(doc).map((b) => [b.name, b]));
  const at = after ?? defaultInsertAfter(doc);
  const step = at ? steps.find((s) => s.block === at) : undefined;
  const round = step ? step.inLoop : steps.find((s) => s.loop && !s.unreachable)?.block;
  return { doc, steps, blocks, after: at, round };
}

/** Steps (not brackets) of the round, or of the whole program when it has no loop. */
function roundSteps(ctx: Context): Step[] {
  return ctx.steps.filter((s) => !s.loop && (ctx.round === undefined || s.inLoop === ctx.round));
}

/** Steps up to and including `after`, latest first. */
function stepsBefore(ctx: Context): Step[] {
  const i = ctx.after ? ctx.steps.findIndex((s) => s.block === ctx.after) : ctx.steps.length - 1;
  return ctx.steps.slice(0, i + 1).reverse();
}

const isPress = (b: Block | undefined): b is Block =>
  !!b && PRESS_TYPES.has(b.type) && !isCatchEarly(b) && !(b.type === "remotePress" && b.mode === "avoid");

function variablesOf(doc: ProgramJson): Record<string, unknown> {
  return isObject(doc.variables) ? doc.variables : {};
}

function declare(doc: ProgramJson, name: string, value = 0): ProgramJson {
  const variables = variablesOf(doc);
  if (name in variables || (BUILTIN_VARIABLES as readonly string[]).includes(name)) return doc;
  return { ...doc, variables: { ...variables, [name]: value } };
}

/** The colour of the previous light (central or pod); `named` for pods, which know only the named colours. */
function previousColor(ctx: Context, named: boolean): string {
  const usable = (c: unknown): c is string => typeof c === "string" && c !== "off" && c !== "red" && c !== "black" && (!named || isNamedColor(c));
  for (const step of stepsBefore(ctx)) {
    const b = ctx.blocks.get(step.block);
    if (!b || step.branchOf) continue;
    const c = b.type === "led" ? b.color : b.type === "remotePress" ? b.color : b.type === "remoteMultiPress" ? b.hitColor : undefined;
    if (usable(c)) return c;
  }
  const menu = Array.isArray(ctx.doc.menu) ? ctx.doc.menu[0] : undefined;
  const menuColor = isObject(menu) ? menu.color : undefined;
  return usable(menuColor) ? menuColor : "green";
}

type Limit = { timeoutMs: Value } | { minTimeoutMs: Value; maxTimeoutMs: Value };

/** The time limit already used by a press in the round. */
function roundLimit(ctx: Context): Limit | undefined {
  for (const step of roundSteps(ctx)) {
    const b = ctx.blocks.get(step.block);
    if (!isPress(b)) continue;
    if (b.timeoutMs !== undefined) return { timeoutMs: b.timeoutMs as Value };
    if (b.minTimeoutMs !== undefined && b.maxTimeoutMs !== undefined) return { minTimeoutMs: b.minTimeoutMs as Value, maxTimeoutMs: b.maxTimeoutMs as Value };
  }
  return undefined;
}

/** Pods know only a fixed time limit: the longest of a random one. */
function fixedLimit(limit: Limit): { timeoutMs: Value } {
  return "timeoutMs" in limit ? limit : { timeoutMs: limit.maxTimeoutMs };
}

/** The metric the round records (else any the program records). */
export function recordedMetric(doc: ProgramJson, after?: string): string | undefined {
  const ctx = contextOf(doc, after);
  const fromRound = roundSteps(ctx)
    .map((s) => ctx.blocks.get(s.block)?.record)
    .find((m): m is string => typeof m === "string" && m !== "");
  if (fromRound) return fromRound;
  for (const b of ctx.blocks.values()) if (typeof b.record === "string" && b.record) return b.record;
  return undefined;
}

/**
 * Where a step goes without a selected one: after the last step of the (first) round, else after
 * the last step of the program. Undefined for an empty program.
 */
export function defaultInsertAfter(doc: ProgramJson): string | undefined {
  const steps = stepList(doc);
  const own = new Set(ownBlocks(doc).map((b) => b.name));
  const last = lastOfRound(steps, steps.find((s) => s.loop && !s.unreachable)?.block);
  if (last && own.has(last)) return last;
  const top = steps.filter((s) => s.depth === 0 && !s.loop && !s.unreachable).pop();
  return top && own.has(top.block) ? top.block : undefined;
}

/** The last step on the main path of a round (`head`: its loop head). */
function lastOfRound(steps: readonly Step[], head: string | undefined): string | undefined {
  const i = head ? steps.findIndex((s) => s.loop && s.block === head) : -1;
  if (i < 0) return undefined;
  const depth = steps[i]!.depth + 1;
  let last: string | undefined;
  for (let j = i + 1; j < steps.length && steps[j]!.depth >= depth; j++) {
    if (steps[j]!.depth === depth && !steps[j]!.loop) last = steps[j]!.block;
  }
  return last;
}

/* ------------------------------------------------------------------ availability */

/** Why the tile cannot be used, or null. */
export function intentUnavailable(
  intent: Intent,
  doc: ProgramJson,
  options: { after?: string; supportedTypes?: readonly string[]; programFormat?: number } = {},
): Unavailable | null {
  const type = INTENTS.find((i) => i.id === intent)!.type;
  const def = blockType(type)!;
  if (options.programFormat !== undefined && (def.minFormat ?? 1) > options.programFormat) return "needsFormat";
  if (options.supportedTypes && !options.supportedTypes.includes(type)) return "unsupported";
  if ((intent === "pod" || intent === "race") && !(Number(doc.peripherals) > 0)) return "noPods";
  if (intent === "results" && !recordedMetric(doc, options.after)) return "noMetric";
  return null;
}

/** Why the recipe cannot be used, or null. */
export function recipeUnavailable(recipe: Recipe, doc: ProgramJson, options: { after?: string; supportedTypes?: readonly string[] } = {}): Unavailable | null {
  const ctx = contextOf(doc, options.after);
  if (recipe === "countMiss") return missTargets(ctx).length ? null : "noPress";
  if (recipe === "flashFalseStart") return falseStartPause(ctx) ? null : "noPause";
  return null;
}

/* ------------------------------------------------------------------ single steps */

function patch(doc: ProgramJson, name: string, fields: Record<string, unknown>): ProgramJson {
  return {
    ...doc,
    blocks: ownBlocks(doc).map((b) => {
      if (b.name !== name) return b;
      const next: Block = { ...b };
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) delete next[k];
        else next[k] = v;
      }
      return next;
    }),
  };
}

function takenOf(doc: ProgramJson, options: AddOptions): Set<string> {
  return new Set([...ownBlocks(doc).map((b) => b.name), ...(options.taken ?? [])]);
}

/**
 * Inserts a block of `type` after `after` (ops.addStep), with two cases addStep leaves open:
 * after a decision the new step goes where both answers meet, after a counter loop's head it goes
 * after the last round. Returns the new block's name and the block it leads on to.
 */
function insert(doc: ProgramJson, type: string, after: string | undefined, taken: Set<string>): { doc: ProgramJson; name: string; onTo?: string } {
  const anchor = after ? ownBlocks(doc).find((b) => b.name === after) : undefined;
  if (anchor?.type === "if") {
    const steps = stepList(doc);
    const loop = detectLoops(doc).find((l) => l.kind === "counter" && l.head === anchor.name);
    // ports into the new step: the loop's exit, or every link of the decision's steps to where they meet
    let ports: { block: string; port: string }[] = [];
    let onTo: string | undefined;
    if (loop) {
      const port = anchor.true === loop.entry ? "false" : "true";
      onTo = typeof anchor[port] === "string" ? (anchor[port] as string) : undefined;
      ports = [{ block: anchor.name, port }];
    } else {
      // where the answers meet: the next step in the list, else where most of the branch links go
      const family = new Set(stepFamily(steps, anchor.name));
      const links = ownBlocks(doc).flatMap((b) =>
        family.has(b.name) ? (blockType(b.type)?.ports ?? []).filter((p) => typeof b[p] === "string" && !family.has(b[p] as string)).map((port) => ({ block: b.name, port, to: b[port] as string })) : [],
      );
      const next = stepNeighbours(steps, anchor.name).after;
      const count = (to: string) => links.filter((l) => l.to === to).length;
      onTo = next && count(entryOf(next)) ? entryOf(next) : [...new Set(links.map((l) => l.to))].sort((a, b) => count(b) - count(a))[0];
      ports = links.filter((l) => l.to === onTo);
    }
    if (ports.length) {
      const added = addStep(doc, type, taken, null);
      let next = added.doc;
      for (const p of ports) next = patch(next, p.block, { [p.port]: added.name });
      if (onTo && blockType(type)?.ports.includes("next")) next = patch(next, added.name, { next: onTo });
      return { doc: next, name: added.name, onTo };
    }
  }
  const oldNext = anchor ? anchor[mainPort(anchor) ?? "next"] : undefined;
  const added = addStep(doc, type, taken, anchor ? after : null);
  return { ...added, onTo: typeof oldNext === "string" ? oldNext : undefined };
}

/**
 * Adds the step of a tile after `after` (else at the end of the round or program). Returns the new
 * program and the block to select.
 */
export function createStep(intent: Intent, doc: ProgramJson, after?: string, options: AddOptions = {}): Added {
  const ctx = contextOf(doc, after);
  const taken = takenOf(doc, options);
  const type = INTENTS.find((i) => i.id === intent)!.type;
  const { doc: added, name, onTo } = insert(doc, type, ctx.after, taken);
  let next = added;
  taken.add(name);
  const limit = roundLimit(ctx);
  const metric = recordedMetric(doc, ctx.after);
  const roundRecords = roundSteps(ctx).some((s) => typeof ctx.blocks.get(s.block)?.record === "string");
  const record = roundRecords ? metric : undefined;

  switch (intent) {
    case "light":
      next = patch(next, name, { color: previousColor(ctx, false) });
      break;
    case "effect":
      // a pulse in the previous light's colour, until the next light change
      next = patch(next, name, { target: "central", effect: "pulse", color: previousColor(ctx, true) });
      break;
    case "pause": {
      const prev = stepsBefore(ctx)
        .map((s) => ctx.blocks.get(s.block))
        .find((b) => b?.type === "delay");
      const time = prev?.ms !== undefined ? { ms: prev.ms } : prev?.minMs !== undefined && prev.maxMs !== undefined ? { ms: undefined, minMs: prev.minMs, maxMs: prev.maxMs } : { ms: 1000 };
      next = patch(next, name, time);
      break;
    }
    case "press":
      next = patch(next, name, { ...(limit ?? {}), record });
      break;
    case "pod":
      next = patch(next, name, { pod: 0, color: previousColor(ctx, true), ...(limit ? fixedLimit(limit) : {}), record });
      break;
    case "charge":
      next = patch(next, name, { maxMs: DEFAULT_MAX_MS, color: previousColor(ctx, true) });
      break;
    case "release":
      // letting go of the central goes on
      break;
    case "race": {
      next = patch(next, name, { hitColor: previousColor(ctx, true), ...(limit ? fixedLimit(limit) : {}), record });
      // pods that were not pressed stay lit (programs.md §2): switch them off after the race
      const reset = addStep(next, "remoteResetAll", taken, name);
      next = reset.doc;
      break;
    }
    case "count":
      next = patch(declare(next, MISSES), name, { var: MISSES, op: "+", value: 1 });
      break;
    case "decide":
      // both answers go on with the next step until the user adds steps to them
      next = patch(declare(next, MISSES), name, { left: MISSES, op: ">=", right: 3, true: onTo, false: onTo });
      break;
    case "repeat": {
      // one round: a pause that leads back to the repeat; the user adds the round's steps after it
      const body = newBlockName("delay", taken);
      next = patch(next, name, { count: 3, next: undefined, body, done: onTo });
      next = { ...next, blocks: [...ownBlocks(next), { name: body, type: "delay", ms: 1000, next: name }] };
      break;
    }
    case "results":
      next = patch(next, name, { metric: metric ?? undefined });
      break;
    case "off":
      break;
  }
  return { doc: next, focus: name };
}

/* ------------------------------------------------------------------ recipes */

/** Presses in the round whose time-out does not count a miss yet. */
function missTargets(ctx: Context): Block[] {
  return roundSteps(ctx)
    .map((s) => ctx.blocks.get(s.block))
    .filter(isPress)
    .filter((b) => {
      const to = typeof b.timeout === "string" ? ctx.blocks.get(b.timeout) : undefined;
      return !(to?.type === "setVariable" && to.var === MISSES && to.op === "+");
    });
}

/** The first pause of the round that is followed by a press (the pause before the light). */
function falseStartPause(ctx: Context): Block | undefined {
  const list = roundSteps(ctx).filter((s) => !s.branchOf);
  for (const [i, step] of list.entries()) {
    const b = ctx.blocks.get(step.block);
    if (b?.type !== "delay") continue;
    if (list.slice(i + 1).some((s) => isPress(ctx.blocks.get(s.block)))) return b;
  }
  return undefined;
}

/** Adds a recipe (several blocks, or switches on existing ones). */
export function applyRecipe(recipe: Recipe, doc: ProgramJson, after?: string, options: AddOptions = {}): Added {
  const ctx = contextOf(doc, after);
  const taken = takenOf(doc, options);
  switch (recipe) {
    case "countMiss":
      return countMissWhenTooSlow(ctx, taken);
    case "pauseBetweenRounds": {
      // the round of the selected step, else the first round, else after the selected step
      const firstRound = ctx.steps.find((s) => s.loop && !s.unreachable)?.block;
      const at = lastOfRound(ctx.steps, ctx.round) ?? lastOfRound(ctx.steps, firstRound) ?? ctx.after;
      const { doc: next, name } = insert(doc, "delay", at, taken);
      return { doc: patch(next, name, { ms: BETWEEN_ROUNDS_MS }), focus: name };
    }
    case "flashFalseStart":
      return flashOnFalseStart(ctx, taken);
  }
}

/** Time limit (the round's, else 2 s) on every press of the round; too slow → MISSES + 1 → on as before. */
function countMissWhenTooSlow(ctx: Context, taken: Set<string>): Added {
  const presses = missTargets(ctx);
  if (!presses.length) return { doc: ctx.doc, focus: ctx.after ?? "" };
  const limit = roundLimit(ctx) ?? (TIME_LIMIT in variablesOf(ctx.doc) ? { timeoutMs: TIME_LIMIT } : { timeoutMs: DEFAULT_LIMIT_MS });
  let doc = declare(ctx.doc, MISSES);
  const extra: Block[] = [];
  for (const press of presses) {
    const hasLimit = press.timeoutMs !== undefined || press.minTimeoutMs !== undefined;
    const main = mainPort(press);
    const goOn = typeof press.timeout === "string" ? press.timeout : main ? (press[main] as string) : undefined;
    const miss = uniqueName(`${press.name}Miss`, taken);
    taken.add(miss);
    extra.push({ name: miss, type: "setVariable", var: MISSES, op: "+", value: 1, ...(goOn ? { next: goOn } : {}) });
    doc = patch(doc, press.name, { ...(hasLimit ? {} : press.type === "button" ? limit : fixedLimit(limit)), timeout: miss });
  }
  return { doc: { ...doc, blocks: [...ownBlocks(doc), ...extra] }, focus: presses[0]!.name };
}

const TIME_LIMIT = "TIME_LIMIT_MS";

/**
 * The round's first pause catches early presses (the pattern of solo.json): a button whose
 * time-out is the pause. A press before it is up flashes the central red (and counts a miss when
 * the program counts misses), then the round ends.
 */
function flashOnFalseStart(ctx: Context, taken: Set<string>): Added {
  const pause = falseStartPause(ctx);
  if (!pause) return { doc: ctx.doc, focus: ctx.after ?? "" };
  const loop = ctx.round ? detectLoops(ctx.doc).find((l) => l.head === ctx.round) : undefined;
  // where a round that ends early goes: the loop head (repeat block, or the counter's check), else the start
  const roundEnd = loop ? loop.head : typeof ctx.doc.start === "string" ? ctx.doc.start : undefined;
  const counts = MISSES in variablesOf(ctx.doc);
  const name = (base: string) => {
    const n = uniqueName(`${pause.name}${base}`, taken);
    taken.add(n);
    return n;
  };
  const red = name("FalseStart");
  const miss = counts ? name("FalseStartMiss") : undefined;
  const hold = name("FalseStartPause");
  const off = name("FalseStartOff");
  const time =
    pause.ms !== undefined ? { minTimeoutMs: pause.ms, maxTimeoutMs: pause.ms } : { minTimeoutMs: pause.minMs, maxTimeoutMs: pause.maxMs };
  const button: Block = { name: pause.name, type: "button", ...time, pressed: red, ...(typeof pause.next === "string" ? { timeout: pause.next } : {}) };
  for (const key of ["timerStart", "timerStop"]) if (pause[key] !== undefined) button[key] = pause[key];
  const extra: Block[] = [
    { name: red, type: "led", color: "red", next: miss ?? hold },
    ...(miss ? [{ name: miss, type: "setVariable", var: MISSES, op: "+", value: 1, next: hold }] : []),
    { name: hold, type: "delay", ms: FLASH_MS, next: off },
    { name: off, type: "led", color: "off", ...(roundEnd ? { next: roundEnd } : {}) },
  ];
  const blocks = ownBlocks(ctx.doc).map((b) => (b.name === pause.name ? button : b));
  return { doc: { ...ctx.doc, blocks: [...blocks, ...extra] }, focus: pause.name };
}
