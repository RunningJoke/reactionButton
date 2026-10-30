/**
 * Feature switches of the step sheet (docs/app/editor-ux.md §4 D): optional things of a step
 * behind one switch. Turning a switch on adds its fields (and the branch it needs, e.g. "count a
 * miss" on the time-out); turning it off removes the fields and the branch it created. Pure.
 *
 * - `randomPause`: a pause waits a random time (`ms` ↔ `minMs`/`maxMs`; on a pause that catches
 *   early presses `minTimeoutMs` = `maxTimeoutMs` means fixed)
 * - `timeLimit`: `timeoutMs` and the `timeout` link: go on, count a miss, or end the round
 * - `record`: `record` (the metric the program already uses, else "reaction")
 * - `longPress`: `shortMs`, a long press goes to the next round (`pressed` becomes `short`)
 * - `avoid`: remotePress `mode: "avoid"`; remoteMultiPress red pods (`avoid`, `avoidHit` → flash red)
 * - `falseStart`: a `delay` becomes the button with a random time-out of solo.json
 *
 * Defaults come from the program (time limit already used, `TIME_LIMIT_MS`, `RED_PODS`, the miss
 * counter), never a placeholder. "Count a miss" is `onTimeout: "countMiss"`; without options a
 * miss is counted when the program already has the miss variable.
 */
import { blockType, isObject, type Block, type SwitchId } from "@reactpod/program-model";
import { limitFieldOf, releaseMode } from "./holdStep";
import { ownBlocks, uniqueName, type ProgramJson } from "./ops";
import { isCatchEarly, mainPort, stepList, type Step } from "./structure";

export type SwitchOptions = { onTimeout?: "goOn" | "countMiss" | "endRound"; missVar?: string };
export type TimeoutAction = "goOn" | "countMiss" | "endRound" | "other";

const MISSES = "MISSES";
const METRIC = "reaction";
const DEFAULT_LIMIT_MS = 2000;
const DEFAULT_HOLD_LIMIT_MS = 5000;
const FLASH_MS = 1000;

/** Switches that apply to this block (in the order the step sheet shows them). */
export function switchesFor(block: Block): SwitchId[] {
  switch (block.type) {
    case "delay":
      return ["randomPause", "falseStart"];
    case "button":
      return isCatchEarly(block) ? ["randomPause", "falseStart"] : ["timeLimit", "record", "longPress"];
    case "remotePress":
      return block.mode === "avoid" ? ["avoid", "timeLimit"] : ["avoid", "timeLimit", "record"];
    case "remoteMultiPress":
      return ["avoid", "timeLimit", "record"];
    case "charge":
      return ["timeLimit", "record"];
    case "release":
      return releaseMode(block) === "signal" ? ["timeLimit", "record"] : ["timeLimit"];
    default:
      return [];
  }
}

const has = (b: Block, field: string) => b[field] !== undefined;
const link = (b: Block, port: string) => (typeof b[port] === "string" ? (b[port] as string) : undefined);

export function switchState(block: Block, id: SwitchId): boolean {
  switch (id) {
    case "randomPause":
      if (block.type === "delay") return !has(block, "ms") && (has(block, "minMs") || has(block, "maxMs"));
      return isCatchEarly(block) && block.minTimeoutMs !== block.maxTimeoutMs;
    case "timeLimit":
      if (block.type === "release") return has(block, limitFieldOf(block));
      return !isCatchEarly(block) && ["timeoutMs", "minTimeoutMs", "maxTimeoutMs"].some((f) => has(block, f));
    case "record":
      return typeof block.record === "string";
    case "longPress":
      return block.type === "button" && !isCatchEarly(block) && (link(block, "long") !== undefined || link(block, "short") !== undefined);
    case "avoid":
      if (block.type === "remotePress") return block.mode === "avoid";
      return block.type === "remoteMultiPress" && has(block, "avoid") && block.avoid !== 0;
    case "falseStart":
      return isCatchEarly(block);
  }
}

/* ---------------------------------------------------------------- reading the program */

function variablesOf(doc: ProgramJson): Record<string, number> {
  return isObject(doc.variables) ? (doc.variables as Record<string, number>) : {};
}

/** The number a value stands for (a variable's start value), if known. */
function numberOf(doc: ProgramJson, v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && typeof variablesOf(doc)[v] === "number") return variablesOf(doc)[v];
  return undefined;
}

function stepOf(steps: readonly Step[], name: string) {
  return steps.find((s) => s.block === name && !s.loop);
}

/** The loop head a step's round goes back to ("end the round"): repeat block or the counter's check. */
function roundHead(doc: ProgramJson, name: string): string | undefined {
  const steps = stepList(doc);
  let step = stepOf(steps, name);
  while (step && !step.inLoop && step.branchOf) step = stepOf(steps, step.branchOf.block);
  return step?.inLoop;
}

/** Where the flow goes after this block normally (its main link). */
function mainTarget(block: Block): string | undefined {
  const port = mainPort(block);
  return port ? link(block, port) : undefined;
}

function isMissCounter(b: Block | undefined, missVar?: string): b is Block {
  return !!b && b.type === "setVariable" && (b.op === "+" || b.op === "add") && b.value === 1 && typeof b.var === "string" && (!missVar || b.var === missVar);
}

/** What the time-out of a block does: the three choices of the step sheet, or "other". */
export function timeoutAction(doc: ProgramJson, name: string): TimeoutAction {
  const blocks = ownBlocks(doc);
  const block = blocks.find((b) => b.name === name);
  if (!block) return "other";
  const to = link(block, "timeout");
  const main = mainTarget(block);
  if (to === undefined || to === main) return "goOn";
  const head = roundHead(doc, name);
  if (head !== undefined && to === head) return "endRound";
  const miss = blocks.find((b) => b.name === to);
  if (isMissCounter(miss) && link(miss, "next") === main) return "countMiss";
  return "other";
}

/** The miss counter's variable on a block's time-out, if it counts one. */
export function missVariable(doc: ProgramJson, name: string): string | undefined {
  const blocks = ownBlocks(doc);
  const to = link(blocks.find((b) => b.name === name) ?? ({} as Block), "timeout");
  const miss = blocks.find((b) => b.name === to);
  return isMissCounter(miss) ? (miss.var as string) : undefined;
}

/** The time limit already used in the program: another press's `timeoutMs`, `TIME_LIMIT_MS`, 2 s. */
function defaultLimit(doc: ProgramJson, except: string): unknown {
  for (const b of ownBlocks(doc)) {
    if (b.name !== except && !isCatchEarly(b) && b.timeoutMs !== undefined && ["button", "remotePress", "remoteMultiPress"].includes(b.type)) return b.timeoutMs;
  }
  return "TIME_LIMIT_MS" in variablesOf(doc) ? "TIME_LIMIT_MS" : DEFAULT_LIMIT_MS;
}

function defaultMetric(doc: ProgramJson): string {
  for (const b of ownBlocks(doc)) if (typeof b.record === "string") return b.record;
  for (const b of ownBlocks(doc)) if (b.type === "summary" && typeof b.metric === "string") return b.metric;
  return METRIC;
}

function countsMiss(doc: ProgramJson, options: SwitchOptions): boolean {
  if (options.onTimeout) return options.onTimeout === "countMiss";
  return (options.missVar ?? MISSES) in variablesOf(doc);
}

/* ---------------------------------------------------------------- changing the program */

type Draft = { doc: ProgramJson; blocks: Block[] };

function draft(doc: ProgramJson): Draft {
  return { doc, blocks: ownBlocks(doc).map((b) => ({ ...b })) };
}

function finish(d: Draft): ProgramJson {
  return { ...d.doc, blocks: d.blocks };
}

function names(d: Draft): Set<string> {
  return new Set(d.blocks.map((b) => b.name));
}

/** Inserts blocks right after `after` (keeps related blocks together in the file). */
function insertAfter(d: Draft, after: string, added: Block[]) {
  const at = d.blocks.findIndex((b) => b.name === after);
  d.blocks.splice(at < 0 ? d.blocks.length : at + 1, 0, ...added);
}

function addVariable(d: Draft, name: string) {
  const vars = variablesOf(d.doc);
  if (name in vars) return;
  d.doc = { ...d.doc, variables: { ...vars, [name]: 0 } };
}

const portsOf = (b: Block) => blockType(b.type)?.ports ?? [];

function reach(byName: Map<string, Block>, roots: Iterable<string>, skip?: { block: string; port: string }): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const n = queue.pop()!;
    if (seen.has(n)) continue;
    const b = byName.get(n);
    if (!b) continue;
    seen.add(n);
    for (const p of portsOf(b)) {
      if (skip && skip.block === n && skip.port === p) continue;
      const t = link(b, p);
      if (t && !seen.has(t)) queue.push(t);
    }
  }
  return seen;
}

/**
 * Removes the link `port` of `from` and the blocks only that link leads to (the branch it
 * created). Blocks the rest of the program also reaches stay.
 */
function cutBranch(d: Draft, from: string, port: string) {
  const block = d.blocks.find((b) => b.name === from);
  const to = block && link(block, port);
  if (!block) return;
  delete block[port];
  if (!to) return;
  const byName = new Map(d.blocks.map((b) => [b.name, b]));
  const candidates = reach(byName, [to]);
  const start = typeof d.doc.start === "string" ? d.doc.start : d.blocks[0]?.name;
  const roots = [...(start ? [start] : []), ...d.blocks.filter((b) => !candidates.has(b.name)).map((b) => b.name)];
  const kept = reach(byName, roots);
  const branch = new Set([...candidates].filter((n) => !kept.has(n)));
  if (branch.size === 0) return;
  d.blocks = d.blocks.filter((b) => !branch.has(b.name));
  dropUnusedVariables(d, missVars(byName, branch));
}

function missVars(byName: Map<string, Block>, removed: Set<string>): string[] {
  return [...removed].map((n) => byName.get(n)).filter((b) => isMissCounter(b)).map((b) => b!.var as string);
}

/** Removes miss variables no block reads or writes any more. */
function dropUnusedVariables(d: Draft, candidates: string[]) {
  const vars = { ...variablesOf(d.doc) };
  let changed = false;
  for (const v of candidates) {
    if (!(v in vars)) continue;
    const used = d.blocks.some((b) => Object.entries(b).some(([k, x]) => k !== "name" && k !== "type" && x === v));
    if (!used) {
      delete vars[v];
      changed = true;
    }
  }
  if (!changed) return;
  const next: ProgramJson = { ...d.doc, variables: vars };
  if (Object.keys(vars).length === 0) delete next.variables;
  d.doc = next;
}

/** A miss counter `+1` that continues at `next`; returns its name. */
function addMissCounter(d: Draft, after: string, base: string, next: string | undefined, missVar: string): string {
  const name = uniqueName(base, names(d));
  insertAfter(d, after, [{ name, type: "setVariable", var: missVar, op: "+", value: 1, ...(next ? { next } : {}) }]);
  addVariable(d, missVar);
  return name;
}

/** "Flash red" branch: led red → (count a miss →) pause → `next`; returns its first block. */
function addRedFlash(d: Draft, after: string, base: string, next: string | undefined, miss: string | null): string {
  const taken = names(d);
  const red = uniqueName(base, taken);
  taken.add(red);
  const hold = uniqueName(`${base}Pause`, taken);
  taken.add(hold);
  const count = miss ? uniqueName(`${base}Miss`, taken) : undefined;
  const blocks: Block[] = [
    { name: red, type: "led", color: "red", next: count ?? hold },
    ...(count ? [{ name: count, type: "setVariable", var: miss!, op: "+", value: 1, next: hold }] : []),
    { name: hold, type: "delay", ms: FLASH_MS, ...(next ? { next } : {}) },
  ];
  insertAfter(d, after, blocks);
  if (miss) addVariable(d, miss);
  return red;
}

/** Links the time-out as `action` says (the time limit itself is already set). */
function linkTimeout(d: Draft, name: string, action: "goOn" | "countMiss" | "endRound", missVar: string) {
  const block = d.blocks.find((b) => b.name === name)!;
  const main = mainTarget(block);
  if (action === "goOn") {
    if (main) block.timeout = main;
    return;
  }
  if (action === "endRound") {
    const head = roundHead(finish(d), name) ?? main;
    if (head) block.timeout = head;
    return;
  }
  block.timeout = addMissCounter(d, name, `${name}Miss`, main, missVar);
}

function setTimeLimit(d: Draft, name: string, on: boolean, options: SwitchOptions) {
  const block = d.blocks.find((b) => b.name === name)!;
  const already = switchState(block, "timeLimit");
  if (!on) {
    // a countdown runs over the time limit: it goes with it
    for (const f of ["timeoutMs", "minTimeoutMs", "maxTimeoutMs", "maxHoldMs", "countdown", "countdownColor", "countdownFrom"]) delete block[f];
    cutBranch(d, name, "timeout");
    return;
  }
  if (already && !options.onTimeout) return;
  if (!already) block[block.type === "release" ? limitFieldOf(block) : "timeoutMs"] = block.type === "release" && limitFieldOf(block) === "maxHoldMs" ? DEFAULT_HOLD_LIMIT_MS : defaultLimit(d.doc, name);
  cutBranch(d, name, "timeout");
  const action = options.onTimeout ?? (countsMiss(d.doc, options) ? "countMiss" : "goOn");
  linkTimeout(d, name, action, options.missVar ?? MISSES);
}

function setRandomPause(d: Draft, name: string, on: boolean) {
  const block = d.blocks.find((b) => b.name === name)!;
  const vars = variablesOf(d.doc);
  if (block.type === "delay") {
    if (on && !switchState(block, "randomPause")) {
      if ("PAUSE_MIN_MS" in vars && "PAUSE_MAX_MS" in vars && typeof block.ms === "string") {
        block.minMs = "PAUSE_MIN_MS";
        block.maxMs = "PAUSE_MAX_MS";
      } else {
        const v = numberOf(d.doc, block.ms) ?? 0;
        block.minMs = v > 0 ? block.ms : 1000;
        block.maxMs = v > 0 ? v * 2 : 3000;
      }
      delete block.ms;
    } else if (!on && switchState(block, "randomPause")) {
      block.ms = block.minMs === "PAUSE_MIN_MS" && "PAUSE_MS" in vars ? "PAUSE_MS" : (block.minMs ?? block.maxMs);
      delete block.minMs;
      delete block.maxMs;
    }
    return;
  }
  if (!isCatchEarly(block)) return;
  if (on && !switchState(block, "randomPause")) {
    const min = block.minTimeoutMs;
    const v = numberOf(d.doc, min) ?? 0;
    block.maxTimeoutMs = min === "PAUSE_MIN_MS" && "PAUSE_MAX_MS" in vars ? "PAUSE_MAX_MS" : v > 0 ? v * 2 : 3000;
  } else if (!on) {
    block.maxTimeoutMs = block.minTimeoutMs;
  }
}

function setRecord(d: Draft, name: string, on: boolean) {
  const block = d.blocks.find((b) => b.name === name)!;
  if (!on) delete block.record;
  else if (typeof block.record !== "string") block.record = defaultMetric(d.doc);
}

function setLongPress(d: Draft, name: string, on: boolean) {
  const block = d.blocks.find((b) => b.name === name)!;
  if (on) {
    if (switchState(block, "longPress")) return;
    // a connected `pressed` leaves on the press edge: short / long need it on `short`
    const pressed = link(block, "pressed");
    if (pressed) {
      block.short = pressed;
      delete block.pressed;
    }
    if (block.shortMs === undefined) block.shortMs = 1000;
    const head = roundHead(finish(d), name) ?? mainTarget(block);
    if (head) block.long = head;
    return;
  }
  delete block.shortMs;
  const short = link(block, "short");
  cutBranch(d, name, "long");
  const b = d.blocks.find((x) => x.name === name)!;
  if (short) {
    delete b.short;
    b.pressed = short;
  }
}

function setAvoid(d: Draft, name: string, on: boolean, options: SwitchOptions) {
  const block = d.blocks.find((b) => b.name === name)!;
  if (block.type === "remotePress") {
    if (on) {
      if (block.mode === "avoid") return;
      block.mode = "avoid";
      // missing colour: red in avoid mode, green in hit mode
      if (block.color === "green") delete block.color;
      delete block.record;
      // without a time limit a red pod would wait forever
      if (!switchState(block, "timeLimit")) {
        block.timeoutMs = defaultLimit(d.doc, name);
        linkTimeout(d, name, "goOn", MISSES);
      }
    } else {
      delete block.mode;
    }
    return;
  }
  if (block.type !== "remoteMultiPress") return;
  if (!on) {
    delete block.avoid;
    delete block.avoidColor;
    cutBranch(d, name, "avoidHit");
    return;
  }
  if (switchState(block, "avoid") && !options.onTimeout) return;
  if (!switchState(block, "avoid")) {
    const vars = variablesOf(d.doc);
    block.avoid = "RED_PODS" in vars ? "RED_PODS" : "AVOID_COUNT" in vars ? "AVOID_COUNT" : 1;
  }
  cutBranch(d, name, "avoidHit");
  const b = d.blocks.find((x) => x.name === name)!;
  const next = roundHead(finish(d), name) ?? mainTarget(b);
  const miss = countsMiss(d.doc, options) ? (options.missVar ?? MISSES) : null;
  b.avoidHit = addRedFlash(d, name, `${name}RedHit`, next, miss);
}

const TIMERS = ["timerStart", "timerStop"];

function setFalseStart(d: Draft, name: string, on: boolean, options: SwitchOptions) {
  const at = d.blocks.findIndex((b) => b.name === name);
  const block = d.blocks[at]!;
  if (on) {
    if (block.type !== "delay") return;
    const random = !has(block, "ms");
    const min = random ? block.minMs : block.ms;
    const max = random ? block.maxMs : block.ms;
    const button: Block = { name, type: "button", minTimeoutMs: min ?? 0, maxTimeoutMs: max ?? min ?? 0 };
    for (const f of TIMERS) if (has(block, f)) button[f] = block[f];
    const next = link(block, "next");
    if (next) button.timeout = next;
    d.blocks[at] = button;
    const back = roundHead(finish(d), name) ?? next;
    const miss = countsMiss(d.doc, options) ? (options.missVar ?? MISSES) : null;
    button.pressed = addRedFlash(d, name, `${name}FalseStart`, back, miss);
    return;
  }
  if (!isCatchEarly(block)) return;
  cutBranch(d, name, "pressed");
  const i = d.blocks.findIndex((x) => x.name === name);
  const b = d.blocks[i]!;
  const delay: Block = { name, type: "delay" };
  if (b.minTimeoutMs === b.maxTimeoutMs) delay.ms = b.minTimeoutMs;
  else Object.assign(delay, { minMs: b.minTimeoutMs, maxMs: b.maxTimeoutMs });
  for (const f of TIMERS) if (has(b, f)) delay[f] = b[f];
  const next = link(b, "timeout");
  if (next) delay.next = next;
  d.blocks[i] = delay;
}

/**
 * Turns a switch of the step `blockName` on or off. On adds the fields (and the branch: miss
 * counter, red flash); on again with `options.onTimeout` replaces the branch and keeps the values.
 * Off removes the fields and the blocks only the branch used. Unknown blocks or switches that do
 * not apply leave the program as it is.
 */
export function setSwitch(doc: ProgramJson, blockName: string, id: SwitchId, on: boolean, options: SwitchOptions = {}): ProgramJson {
  const block = ownBlocks(doc).find((b) => b.name === blockName);
  if (!block || !switchesFor(block).includes(id)) return doc;
  if (switchState(block, id) === on && !(on && options.onTimeout && (id === "timeLimit" || id === "avoid"))) return doc;
  const d = draft(doc);
  switch (id) {
    case "timeLimit":
      setTimeLimit(d, blockName, on, options);
      break;
    case "randomPause":
      setRandomPause(d, blockName, on);
      break;
    case "record":
      setRecord(d, blockName, on);
      break;
    case "longPress":
      setLongPress(d, blockName, on);
      break;
    case "avoid":
      setAvoid(d, blockName, on, options);
      break;
    case "falseStart":
      setFalseStart(d, blockName, on, options);
      break;
  }
  return finish(d);
}

const DEFAULT_REPORT_LIMIT_MS = 30_000;

/**
 * The time limit of a `communicate` step (waiting for the phone). Not a `switchesFor` entry: the
 * Adjust sheet's program-wide switches must not add a limit to a report. Off removes the time-out exit.
 */
export function setReportLimit(doc: ProgramJson, blockName: string, on: boolean): ProgramJson {
  const d = draft(doc);
  const block = d.blocks.find((b) => b.name === blockName);
  if (!block || block.type !== "communicate") return doc;
  if (on) {
    if (!(typeof block.timeoutMs === "string" || (typeof block.timeoutMs === "number" && block.timeoutMs > 0))) block.timeoutMs = DEFAULT_REPORT_LIMIT_MS;
    return finish(d);
  }
  delete block.timeoutMs;
  cutBranch(d, blockName, "timeout");
  return finish(d);
}

/** Removes the exit `port` of a step and the blocks only that exit led to. */
export function removeExit(doc: ProgramJson, blockName: string, port: string): ProgramJson {
  const d = draft(doc);
  cutBranch(d, blockName, port);
  return finish(d);
}

/** Does this block count a miss (the `+1` of the exit picker's "Count a miss")? Exported for the exit picker. */
export const isMissCounterBlock = (b: Block | undefined, missVar?: string): b is Block => isMissCounter(b, missVar);

/** The exit `port` leads to a new miss counter that continues where the step's main exit goes. */
export function linkMissCounter(doc: ProgramJson, blockName: string, port: string): ProgramJson {
  const d = draft(doc);
  cutBranch(d, blockName, port);
  const block = d.blocks.find((b) => b.name === blockName);
  if (!block) return doc;
  const counted = ownBlocks(doc).find((b) => isMissCounter(b));
  const base = `${blockName}${port.charAt(0).toUpperCase()}${port.slice(1)}Miss`;
  block[port] = addMissCounter(d, blockName, base, mainTarget(block), (counted?.var as string | undefined) ?? MISSES);
  return finish(d);
}

/** The step's round head (where "next round" leads), as the time-out choice "End the round" uses it. */
export const roundHeadOf = (doc: ProgramJson, blockName: string): string | undefined => roundHead(doc, blockName);
