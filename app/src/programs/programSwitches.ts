/**
 * Switches for the whole program (Adjust sheet, docs/app/editor-ux.md §4 G): time limit and
 * record times on every press step, results at the end. Built on the step switches of
 * `editor/switches.ts`; only the program's own blocks change (library parts stay as they are).
 */
import type { Block, SwitchId } from "@reactpod/program-model";
import { deleteStep, ownBlocks, uniqueName, type ProgramJson } from "../editor/ops";
import { detectLoops, isCatchEarly, mainPort, portsOf } from "../editor/structure";
import { setSwitch, switchesFor, switchState, timeoutAction, type SwitchOptions, type TimeoutAction } from "../editor/switches";

export type ProgramSwitch = "timeLimit" | "record" | "results";

const METRIC = "reaction";

/**
 * The press steps a program switch acts on. A red "don't touch" pod (remotePress in avoid mode)
 * keeps its time limit: without one it would wait forever.
 */
export function pressSteps(doc: ProgramJson, id: Exclude<ProgramSwitch, "results">): Block[] {
  return ownBlocks(doc).filter((b) => switchesFor(b).includes(id as SwitchId) && !(id === "timeLimit" && b.type === "remotePress" && b.mode === "avoid"));
}

const summaries = (doc: ProgramJson) => ownBlocks(doc).filter((b) => b.type === "summary");

/** On for every press step, off for all, or "mixed". A program without press steps is off. */
export function programSwitchState(doc: ProgramJson, id: ProgramSwitch): boolean | "mixed" {
  if (id === "results") return summaries(doc).length > 0;
  const states = pressSteps(doc, id).map((b) => switchState(b, id));
  if (states.length === 0) return false;
  if (states.every(Boolean)) return true;
  return states.some(Boolean) ? "mixed" : false;
}

/** Can the switch change anything in this program (own press steps; results: own blocks)? */
export function programSwitchApplies(doc: ProgramJson, id: ProgramSwitch): boolean {
  if (id === "results") return summaries(doc).length > 0 || addResults(doc) !== doc;
  return pressSteps(doc, id).length > 0;
}

/**
 * Turns a program switch on or off. timeLimit / record: `setSwitch` on every press step (with
 * `options.onTimeout` also on steps that already have a limit, so the time-outs all do the same).
 * results: adds a summary step after the last round (or at the end), or removes the summary steps.
 */
export function setProgramSwitch(doc: ProgramJson, id: ProgramSwitch, on: boolean, options?: SwitchOptions): ProgramJson {
  if (id === "results") return on ? addResults(doc) : removeResults(doc);
  let next = doc;
  for (const b of pressSteps(doc, id)) next = setSwitch(next, b.name, id, on, options);
  return next;
}

/** The time limit of the press steps: a number (ms), a variable name, or undefined when off or different. */
export function programTimeLimit(doc: ProgramJson): number | string | undefined {
  const values = pressSteps(doc, "timeLimit")
    .filter((b) => switchState(b, "timeLimit"))
    .map((b) => b.timeoutMs);
  if (values.length === 0 || values.some((v) => v !== values[0])) return undefined;
  const v = values[0];
  return typeof v === "number" || typeof v === "string" ? v : undefined;
}

/** Sets a fixed time limit (ms) on every press step that has one. */
export function setProgramTimeLimit(doc: ProgramJson, ms: number): ProgramJson {
  const timed = new Set(pressSteps(doc, "timeLimit").filter((b) => switchState(b, "timeLimit") && !isCatchEarly(b)).map((b) => b.name));
  if (timed.size === 0) return doc;
  const blocks = ownBlocks(doc).map((b) => {
    if (!timed.has(b.name)) return b;
    const { minTimeoutMs: _min, maxTimeoutMs: _max, ...rest } = b;
    return { ...rest, timeoutMs: ms };
  });
  return { ...doc, blocks };
}

/** What happens when a press is too slow, if all timed press steps do the same. */
export function programTimeoutAction(doc: ProgramJson): TimeoutAction | undefined {
  const actions = pressSteps(doc, "timeLimit")
    .filter((b) => switchState(b, "timeLimit"))
    .map((b) => timeoutAction(doc, b.name));
  if (actions.length === 0 || actions.some((a) => a !== actions[0])) return undefined;
  return actions[0];
}

function metricOf(doc: ProgramJson): string {
  for (const b of ownBlocks(doc)) if (typeof b.record === "string") return b.record;
  return METRIC;
}

/** Summary step like the wizard's (`fragments.results`): average and best of the recorded metric. */
function addResults(doc: ProgramJson): ProgramJson {
  if (summaries(doc).length > 0) return doc;
  const blocks = ownBlocks(doc).map((b) => ({ ...b }));
  if (blocks.length === 0) return doc;
  const name = uniqueName("Summary", new Set(blocks.map((b) => b.name)));
  const summary: Block = { name, type: "summary", metric: metricOf(doc), storeAverage: "AVG_REACTION", storeBest: "BEST_REACTION" };

  // after the last round: the loop's exit port leads to the summary, the summary to what came next
  const loop = detectLoops(doc).find((l) => blocks.some((b) => b.name === l.head));
  if (loop) {
    const head = blocks.find((b) => b.name === loop.head)!;
    const port = exitPort(head, loop.after, new Set(loop.body));
    if (port) {
      if (loop.after) summary.next = loop.after;
      head[port] = name;
      blocks.splice(blocks.indexOf(head) + 1, 0, summary);
      return { ...doc, blocks };
    }
  }
  // no loop: after the last step of the main path
  const last = lastOnMainPath(doc, blocks);
  if (!last) return doc; // the flow never ends: nowhere to show results
  last.block[last.port] = name;
  blocks.splice(blocks.indexOf(last.block) + 1, 0, summary);
  return { ...doc, blocks };
}

/** The port of the loop head that leaves the loop: `done` of a repeat, the `if` port to `after`. */
function exitPort(head: Block, after: string | undefined, body: ReadonlySet<string>): string | undefined {
  if (head.type === "repeat") return "done";
  if (head.type !== "if") return undefined;
  for (const port of ["true", "false"]) {
    const target = head[port];
    if (after !== undefined ? target === after : typeof target !== "string" || !body.has(target)) return port;
  }
  return undefined;
}

/** Follows the main links from the start to the block where the program ends (none if it loops). */
function lastOnMainPath(doc: ProgramJson, blocks: Block[]): { block: Block; port: string } | undefined {
  const byName = new Map(blocks.map((b) => [b.name, b]));
  let current = byName.get(typeof doc.start === "string" ? doc.start : (blocks[0]?.name ?? ""));
  const seen = new Set<string>();
  while (current && !seen.has(current.name)) {
    seen.add(current.name);
    const port = mainPort(current) ?? (current.type === "button" && !isCatchEarly(current) ? "pressed" : portsOf(current).includes("next") ? "next" : undefined);
    if (!port) return undefined;
    const target = current[port];
    if (typeof target !== "string") return { block: current, port };
    current = byName.get(target);
  }
  return undefined;
}

/** Removes the summary steps; links into one continue with the step after it. */
function removeResults(doc: ProgramJson): ProgramJson {
  let next = doc;
  for (const b of summaries(doc)) next = deleteStep(next, b.name);
  return next;
}
