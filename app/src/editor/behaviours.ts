/**
 * Behaviours of a step, UI name "Sprinkles" (issue #88, docs/app/editor-ux.md §4 D): optional things
 * that own some fields of a step, maybe one exit and the helper blocks that exit needs. Off by default;
 * the state is always read from the program file, never stored. Turning one on adds its fields (and
 * helpers: miss counter, red flash, pods-off step); turning it off removes exactly those. Pure.
 *
 * The six feature switches (`switches.ts`) are the first entries; `countdown.ts`, `holdStep.ts` and
 * `toggleStep.ts` keep their field operations and are used here. A step that only partly matches a
 * behaviour is "custom": the registry leaves it alone (expert mode edits the raw fields).
 *
 * Not a behaviour: colour, effect type, pod, mode, Fixed | Random (plain controls, `FixedOrRandomTime`).
 */
import { blockType, MAX_TIMERS, TIMER_FIELDS, type BehaviourId, type Block } from "@reactpod/program-model";
import { chargeMode, releaseMode } from "./holdStep";
import { ownBlocks, setBlockField, uniqueName, type ProgramJson } from "./ops";
import { entryOf, mainPort, stepList, stepNeighbours } from "./structure";
import type { SwitchId } from "@reactpod/program-model";
import { removeExit, setReportLimit, setSwitch, switchesFor, switchState, type SwitchOptions } from "./switches";
import { TOGGLE_RESULTS } from "./toggleStep";

export type { BehaviourId };
/** Rules = what a step demands, Measure = what it records or shows, Flow = where it leads. */
export type BehaviourGroup = "rules" | "measure" | "flow";
export type BehaviourState = "on" | "off" | "custom";

export type BehaviourOptions = SwitchOptions & {
  /** goTo: the block the main exit leads to */
  target?: string;
  /** stopwatch: timer names */
  timerStart?: string;
  timerStop?: string;
  /** phoneSettings: variables the report includes */
  vars?: readonly string[];
};

export type Behaviour = {
  id: Exclude<BehaviourId, "randomPause">;
  group: BehaviourGroup;
  /** program format that runs the behaviour's fields (the block type may need more) */
  minFormat: number;
  /** Does the step offer it? `format` (the pod's program format, if known) must run its fields. */
  appliesTo(block: Block, mode: string | undefined, format?: number): boolean;
  isOn(block: Block, doc: ProgramJson): BehaviourState;
  turnOn(doc: ProgramJson, name: string, options?: BehaviourOptions): ProgramJson;
  /** Removes the behaviour's fields, its exit and the helper blocks only it used. */
  turnOff(doc: ProgramJson, name: string): ProgramJson;
  /** The value shown in the row ("2 s", "reaction"); language-neutral. */
  summary(block: Block, doc: ProgramJson): string | undefined;
};

/** The mode a behaviour may depend on: release / charge mode, remotePress hit | avoid. */
export function modeOf(block: Block): string | undefined {
  if (block.type === "release") return releaseMode(block);
  if (block.type === "charge") return chargeMode(block);
  if (block.type === "remotePress") return block.mode === "avoid" ? "avoid" : "hit";
  return undefined;
}

const has = (b: Block, f: string) => b[f] !== undefined;
const link = (b: Block, port: string) => (typeof b[port] === "string" ? (b[port] as string) : undefined);
/** A time or count that is set: a setting name, or a number above 0. */
const positive = (v: unknown) => typeof v === "string" || (typeof v === "number" && v > 0);
const state = (on: boolean): BehaviourState => (on ? "on" : "off");

/** "2 s", "1–3 s", a setting name as is. */
export function formatTime(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v !== "number") return undefined;
  return v % 1000 === 0 ? `${v / 1000} s` : `${Math.round(v / 100) / 10} s`;
}
const range = (a: unknown, b: unknown) => (a === b ? formatTime(a) : `${(formatTime(a) ?? "?").replace(/ s$/, "")}–${formatTime(b) ?? "?"}`);

function patch(doc: ProgramJson, name: string, fields: Record<string, unknown>): ProgramJson {
  let next = doc;
  for (const [f, v] of Object.entries(fields)) next = setBlockField(next, name, f, v);
  return next;
}

function formatOk(block: Block, minFormat: number, format?: number): boolean {
  return format === undefined || format >= Math.max(minFormat, blockType(block.type)?.minFormat ?? 1);
}

/* ---------------------------------------------------------------- the six switches */

function fromSwitch(id: SwitchId, group: BehaviourGroup, summary: Behaviour["summary"], minFormat = 1): Behaviour {
  return {
    id: id as Behaviour["id"],
    group,
    minFormat,
    appliesTo: (b, _mode, format) => switchesFor(b).includes(id) && formatOk(b, minFormat, format),
    isOn: (b) => state(switchState(b, id)),
    turnOn: (doc, name, options) => setSwitch(doc, name, id, true, options),
    turnOff: (doc, name) => setSwitch(doc, name, id, false),
    summary,
  };
}

const timeLimitOf = (b: Block): string | undefined => {
  if (b.type === "release") return formatTime(releaseMode(b) === "signal" ? b.timeoutMs : b.maxHoldMs);
  if (b.minTimeoutMs !== undefined && b.timeoutMs === undefined) return range(b.minTimeoutMs, b.maxTimeoutMs);
  return formatTime(b.timeoutMs);
};

const timeLimit: Behaviour = {
  ...fromSwitch("timeLimit", "rules", timeLimitOf),
  appliesTo: (b, _m, format) => (b.type === "communicate" || switchesFor(b).includes("timeLimit")) && formatOk(b, 1, format),
  isOn: (b) => (b.type === "communicate" ? state(positive(b.timeoutMs)) : state(switchState(b, "timeLimit"))),
  turnOn: (doc, name, o) => (ownBlocks(doc).find((b) => b.name === name)?.type === "communicate" ? setReportLimit(doc, name, true) : setSwitch(doc, name, "timeLimit", true, o)),
  turnOff: (doc, name) => (ownBlocks(doc).find((b) => b.name === name)?.type === "communicate" ? setReportLimit(doc, name, false) : setSwitch(doc, name, "timeLimit", false)),
};

/* ---------------------------------------------------------------- measure */

/** The result variables a step can keep, with the name a new one gets. */
function keptFields(block: Block): { field: string; name: string }[] {
  const base = block.name.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase().replace(/^(\d)/, "_$1").slice(0, 24);
  switch (block.type) {
    case "button":
    case "remotePress":
    case "release":
      return [{ field: "storeAs", name: `${base}_MS` }];
    case "charge":
      return [
        { field: "storeAs", name: `${base}_MS` },
        { field: "storePercent", name: `${base}_PERCENT` },
      ];
    case "toggle":
      return TOGGLE_RESULTS.map(([field, name]) => ({ field, name }));
    default:
      return [];
  }
}

const keepResult: Behaviour = {
  id: "keepResult",
  group: "measure",
  minFormat: 1,
  appliesTo: (b, _m, format) => keptFields(b).length > 0 && formatOk(b, 1, format),
  isOn: (b) => state(keptFields(b).some((k) => has(b, k.field))),
  turnOn: (doc, name) => {
    const block = ownBlocks(doc).find((b) => b.name === name);
    if (!block || keptFields(block).some((k) => has(block, k.field))) return doc;
    return patch(doc, name, Object.fromEntries(keptFields(block).map((k) => [k.field, k.name])));
  },
  // the variable stays in the program: a store field needs no declaration, and a setting may use it
  turnOff: (doc, name) => {
    const block = ownBlocks(doc).find((b) => b.name === name);
    return block ? patch(doc, name, Object.fromEntries(keptFields(block).map((k) => [k.field, undefined]))) : doc;
  },
  summary: (b) => {
    const names = keptFields(b).flatMap((k) => (typeof b[k.field] === "string" ? [b[k.field] as string] : []));
    return names.length === 0 ? undefined : names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
  },
};

const TIMER_NAMES = ["cycle", "lap"];
const timerOf = (b: Block, f: "timerStart" | "timerStop") => (typeof b[f] === "string" ? (b[f] as string) : undefined);

/** Timer names the program uses (own blocks). */
export function timerNames(doc: ProgramJson): string[] {
  const out = new Set<string>();
  for (const b of ownBlocks(doc)) for (const f of ["timerStart", "timerStop"] as const) if (timerOf(b, f)) out.add(timerOf(b, f)!);
  return [...out];
}

/** Names the Stopwatch row suggests: a started timer nothing stops, then `cycle`, `lap`, then a new name. */
export function suggestTimerNames(doc: ProgramJson): string[] {
  const blocks = ownBlocks(doc);
  const open = timerNames(doc).filter((n) => blocks.some((b) => timerOf(b, "timerStart") === n) && !blocks.some((b) => timerOf(b, "timerStop") === n));
  const used = new Set(timerNames(doc));
  return [...open, ...TIMER_NAMES.filter((n) => !used.has(n))];
}

const stopwatch: Behaviour = {
  id: "stopwatch",
  group: "measure",
  minFormat: 2,
  appliesTo: (b, _m, format) => blockType(b.type) !== undefined && formatOk(b, 2, format),
  isOn: (b) => state(TIMER_FIELDS.some((f) => has(b, f.name))),
  turnOn: (doc, name, o = {}) => {
    const block = ownBlocks(doc).find((b) => b.name === name);
    if (!block || TIMER_FIELDS.some((f) => has(block, f.name))) return doc;
    const names = timerNames(doc);
    const suggested = suggestTimerNames(doc)[0] ?? uniqueName("timer", new Set(names));
    const stops = names.includes(suggested) && !ownBlocks(doc).some((b) => timerOf(b, "timerStop") === suggested);
    const given = o.timerStart !== undefined || o.timerStop !== undefined;
    const fields = given ? { timerStart: o.timerStart, timerStop: o.timerStop } : { timerStart: stops ? undefined : suggested, timerStop: stops ? suggested : undefined };
    const added = [fields.timerStart, fields.timerStop].filter((n): n is string => !!n && !names.includes(n));
    if (new Set([...names, ...added]).size > MAX_TIMERS) return doc;
    return patch(doc, name, fields);
  },
  turnOff: (doc, name) => patch(doc, name, { timerStart: undefined, timerStop: undefined }),
  summary: (b) => {
    const parts = [timerOf(b, "timerStart") && `▶ ${timerOf(b, "timerStart")}`, timerOf(b, "timerStop") && `■ ${timerOf(b, "timerStop")}`].filter(Boolean);
    return parts.length ? parts.join(" · ") : undefined;
  },
};

const DEFAULT_TARGET_MS = 500;

const showBar: Behaviour = {
  id: "showBar",
  group: "measure",
  minFormat: 6,
  appliesTo: (b, _m, format) => b.type === "summary" && formatOk(b, 6, format),
  isOn: (b) => state(b.show === true),
  turnOn: (doc, name) => {
    const block = ownBlocks(doc).find((b) => b.name === name);
    if (!block || block.show === true) return doc;
    const other = ownBlocks(doc).find((b) => b.type === "summary" && b.name !== name && b.targetMs !== undefined)?.targetMs;
    return patch(doc, name, { show: true, targetMs: block.targetMs ?? other ?? DEFAULT_TARGET_MS });
  },
  turnOff: (doc, name) => patch(doc, name, { show: undefined, targetMs: undefined, showMs: undefined }),
  summary: (b) => formatTime(b.targetMs),
};

const listLength = (v: unknown) => (Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0);

const phoneSettings: Behaviour = {
  id: "phoneSettings",
  group: "measure",
  minFormat: 5,
  appliesTo: (b, _m, format) => b.type === "communicate" && formatOk(b, 5, format),
  isOn: (b) => state(listLength(b.vars) > 0 || listLength(b.editable) > 0),
  // without options the first setting of the program: the report needs a variable the program declares
  turnOn: (doc, name, o = {}) => {
    const block = ownBlocks(doc).find((b) => b.name === name);
    if (!block || listLength(block.vars) > 0 || listLength(block.editable) > 0) return doc;
    const declared = doc.variables && typeof doc.variables === "object" ? Object.keys(doc.variables) : [];
    const vars = o.vars ?? declared.slice(0, 1);
    return vars.length === 0 ? doc : patch(doc, name, { vars: [...vars] });
  },
  turnOff: (doc, name) => patch(doc, name, { vars: undefined, editable: undefined }),
  summary: (b) => {
    const n = new Set([...(Array.isArray(b.vars) ? b.vars : []), ...(b.editable && typeof b.editable === "object" ? Object.keys(b.editable) : [])]).size;
    return n ? String(n) : undefined;
  },
};

/* ---------------------------------------------------------------- rules */

const includeCentral: Behaviour = {
  id: "includeCentral",
  group: "rules",
  minFormat: 1,
  appliesTo: (b, _m, format) => (b.type === "remoteMultiPress" || b.type === "toggle") && formatOk(b, 1, format),
  // on is the firmware default: the row exists to switch it off
  isOn: (b) => state(b.includeCentral !== false),
  turnOn: (doc, name) => setBlockField(doc, name, "includeCentral", undefined),
  turnOff: (doc, name) => setBlockField(doc, name, "includeCentral", false),
  summary: () => undefined,
};

const holdFirst: Behaviour = {
  id: "holdFirst",
  group: "rules",
  minFormat: 3,
  appliesTo: (b, _m, format) => (b.type === "charge" || b.type === "release") && formatOk(b, 3, format),
  isOn: (b) => state(b.type === "charge" ? positive(b.onsetMs) : has(b, "holdTimeoutMs")),
  turnOn: (doc, name) => {
    const block = ownBlocks(doc).find((b) => b.name === name);
    if (!block || holdFirst.isOn(block, doc) === "on") return doc;
    return block.type === "charge" ? setBlockField(doc, name, "onsetMs", 500) : setBlockField(doc, name, "holdTimeoutMs", 5000);
  },
  turnOff: (doc, name) => {
    const block = ownBlocks(doc).find((b) => b.name === name);
    if (!block) return doc;
    if (block.type === "charge") return setBlockField(doc, name, "onsetMs", undefined);
    // the `noHold` exit and the blocks only it led to go too
    return removeExit(setBlockField(doc, name, "holdTimeoutMs", undefined), name, "noHold");
  },
  summary: (b) => formatTime(b.type === "charge" ? b.onsetMs : b.holdTimeoutMs),
};

const drains: Behaviour = {
  id: "drains",
  group: "rules",
  minFormat: 3,
  appliesTo: (b, mode, format) => b.type === "charge" && mode === "accumulate" && formatOk(b, 3, format),
  isOn: (b) => state(positive(b.decayMs)),
  turnOn: (doc, name) => (positive(ownBlocks(doc).find((b) => b.name === name)?.decayMs) ? doc : setBlockField(doc, name, "decayMs", 2000)),
  turnOff: (doc, name) => setBlockField(doc, name, "decayMs", undefined),
  summary: (b) => formatTime(b.decayMs),
};

/* ---------------------------------------------------------------- flow */

const ENTRY_PORTS = ["next", "released", "pressed", "full"];

/** The exit a step normally leaves by, also when it is not linked yet. */
const mainOf = (b: Block) => mainPort(b) ?? (blockType(b.type)?.ports.find((p) => ENTRY_PORTS.includes(p)) ?? "next");

const resetOf = (doc: ProgramJson, b: Block): Block | undefined => {
  const to = link(b, mainOf(b));
  return to === undefined ? undefined : ownBlocks(doc).find((x) => x.name === to && x.type === "remoteResetAll");
};

/** How many ports (and the start) lead to a block. */
function inbound(doc: ProgramJson, name: string): number {
  let n = doc.start === name ? 1 : 0;
  for (const b of ownBlocks(doc)) for (const p of blockType(b.type)?.ports ?? []) if (b[p] === name) n++;
  return n;
}

const podsOff: Behaviour = {
  id: "podsOff",
  group: "flow",
  minFormat: 1,
  appliesTo: (b, _m, format) => (["remoteMultiPress", "toggle", "charge", "release"].includes(b.type) || (b.type === "effect" && b.target !== undefined && b.target !== "central")) && formatOk(b, 1, format),
  // exact: the way on leads to a bare "turn all pods off" that only this step uses. Any other reset is "custom".
  isOn: (b, doc) => {
    const reset = resetOf(doc, b);
    if (!reset) return "off";
    const bare = Object.keys(reset).every((k) => ["name", "type", "next"].includes(k));
    return bare && inbound(doc, reset.name) === 1 ? "on" : "custom";
  },
  turnOn: (doc, name) => {
    const block = ownBlocks(doc).find((b) => b.name === name);
    if (!block || podsOff.isOn(block, doc) !== "off") return doc;
    const port = mainOf(block);
    const reset = uniqueName(`${name}PodsOff`, new Set(ownBlocks(doc).map((b) => b.name)));
    const at = ownBlocks(doc).findIndex((b) => b.name === name);
    const blocks = ownBlocks(doc).map((b) => ({ ...b }));
    blocks[at]![port] = reset;
    blocks.splice(at + 1, 0, { name: reset, type: "remoteResetAll", ...(link(block, port) ? { next: link(block, port) } : {}) });
    return { ...doc, blocks };
  },
  turnOff: (doc, name) => {
    const block = ownBlocks(doc).find((b) => b.name === name);
    if (!block || podsOff.isOn(block, doc) !== "on") return doc;
    const reset = resetOf(doc, block)!;
    const port = mainOf(block);
    const blocks = ownBlocks(doc)
      .filter((b) => b.name !== reset.name)
      .map((b) => {
        if (b.name !== name) return b;
        const next = { ...b };
        if (link(reset, "next")) next[port] = reset.next;
        else delete next[port];
        return next;
      });
    return { ...doc, blocks };
  },
  summary: () => undefined,
};

/** The main exit leaves the list order: it jumps to a step that does not follow, or back. */
const goTo: Behaviour = {
  id: "goTo",
  group: "flow",
  minFormat: 1,
  appliesTo: (b, _m, format) => b.type !== "if" && blockType(b.type) !== undefined && formatOk(b, 1, format),
  isOn: (b, doc) => {
    const step = stepList(doc).find((s) => s.block === b.name && !s.loop);
    return state(!!step && step.branches.some((br) => br.port === mainPort(b) && br.role === "then"));
  },
  turnOn: (doc, name, o = {}) => {
    const block = ownBlocks(doc).find((b) => b.name === name);
    if (!block || !o.target || o.target === name || !ownBlocks(doc).some((b) => b.name === o.target)) return doc;
    return setBlockField(doc, name, mainOf(block), o.target);
  },
  // back to "next step": the step that follows in the list, else the end of the round (the loop head)
  turnOff: (doc, name) => {
    const block = ownBlocks(doc).find((b) => b.name === name);
    if (!block || goTo.isOn(block, doc) !== "on") return doc;
    const steps = stepList(doc);
    const { step, after } = stepNeighbours(steps, name);
    const to = after ? entryOf(after) : step?.inLoop;
    return to ? setBlockField(doc, name, mainPort(block)!, to) : doc;
  },
  summary: (b) => link(b, mainPort(b) ?? "next"),
};

/* ---------------------------------------------------------------- the registry */

const falseStartBase = fromSwitch("falseStart", "rules", () => undefined);
/** A pause becomes a button: not offered when the pause has a field the button lacks (it would be dropped silently). */
const falseStart: Behaviour = {
  ...falseStartBase,
  appliesTo: (b, m, format) => {
    if (!falseStartBase.appliesTo(b, m, format)) return false;
    if (b.type !== "delay") return true;
    const kept = new Set(["name", "type", "ms", "minMs", "maxMs", "next", ...(blockType("button")?.fields.map((f) => f.name) ?? [])]);
    return Object.keys(b).every((k) => kept.has(k));
  },
};

/**
 * Turning on a behaviour that is on (or custom), or off one that is off, returns the same document: nothing
 * happens that was not asked for. `reapply`: turning on again with options re-links the exit (time-out, red flash, target).
 */
function guard(x: Behaviour, reapply = false): Behaviour {
  const find = (doc: ProgramJson, name: string) => ownBlocks(doc).find((b) => b.name === name);
  return {
    ...x,
    turnOn: (doc, name, o) => {
      const block = find(doc, name);
      if (!block) return doc;
      const s = x.isOn(block, doc);
      return s === "off" || (reapply && s === "on" && (o?.onTimeout !== undefined || o?.target !== undefined)) ? x.turnOn(doc, name, o) : doc;
    },
    turnOff: (doc, name) => {
      const block = find(doc, name);
      return block && x.isOn(block, doc) === "on" ? x.turnOff(doc, name) : doc;
    },
  };
}

export const BEHAVIOURS: readonly Behaviour[] = [
  guard(timeLimit, true),
  guard(fromSwitch("avoid", "rules", (b) => (b.type === "remoteMultiPress" ? String(b.avoid ?? 0) : undefined)), true),
  guard(fromSwitch("longPress", "rules", (b) => formatTime(b.shortMs))),
  guard(falseStart),
  guard(holdFirst),
  guard(drains),
  guard(includeCentral),
  guard(fromSwitch("record", "measure", (b) => (typeof b.record === "string" ? b.record : undefined))),
  guard(keepResult),
  guard(phoneSettings),
  guard(showBar),
  guard(stopwatch),
  guard(goTo, true),
  guard(podsOff),
];

export function behaviour(id: Behaviour["id"]): Behaviour {
  return BEHAVIOURS.find((x) => x.id === id)!;
}

/** The behaviours a step offers, in the order of the sheet (`format` greys out what the pod cannot run). */
export function behavioursFor(block: Block, format?: number): Behaviour[] {
  const mode = modeOf(block);
  return BEHAVIOURS.filter((x) => x.appliesTo(block, mode, format));
}

/** State of every behaviour that applies, for the sheet. */
export function behaviourStates(block: Block, doc: ProgramJson, format?: number): { behaviour: Behaviour; state: BehaviourState }[] {
  return behavioursFor(block, format).map((x) => ({ behaviour: x, state: x.isOn(block, doc) }));
}
