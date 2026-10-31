/**
 * Exits of a step in normal mode (issue #88 §4, editor-ux.md §4 D): one picker for every exit. Reads where an
 * exit goes in the words of the picker (next step, count a miss, next round, leave the loop, a step) and sets
 * it again. Pure; the picker page is `ExitPicker.tsx`.
 */
import { blockType, type Block } from "@reactpod/program-model";
import { ownBlocks, setBlockField, type ProgramJson } from "./ops";
import { entryOf, mainPort, stepNeighbours, type LoopInfo, type Step } from "./structure";
import { isMissCounterBlock, linkMissCounter, removeExit } from "./switches";

export type ExitChoice =
  | { kind: "next" }
  | { kind: "countMiss" }
  | { kind: "nextRound" }
  | { kind: "leave" }
  | { kind: "step"; target: string }
  /** toggle team exits only: not connected, the game goes on */
  | { kind: "none" };

/** What an exit does now; `none`: not connected and nothing takes over (the game goes on / the program ends). */
export type ExitValue = ExitChoice;

const link = (b: Block | undefined, port: string) => (b && typeof b[port] === "string" ? (b[port] as string) : undefined);

/** The main exit's target, or undefined. */
const mainTargetOf = (b: Block) => {
  const port = mainPort(b);
  return port ? link(b, port) : undefined;
};

/** The loop around a step, if any. */
export function loopOf(steps: readonly Step[], name: string): LoopInfo | undefined {
  const step = steps.find((s) => s.block === name && !s.loop);
  return step?.inLoop ? steps.find((s) => s.loop && s.block === step.inLoop)?.loop : undefined;
}

/** Exits that mean "it went wrong": only these offer "Count a miss". */
const FAILURE = new Set(["timeout", "avoidHit", "noHold", "early", "falseStart"]);
export const isFailureExit = (port: string) => FAILURE.has(port);

/** Is the main exit of this block `port`? */
export const isMainExit = (block: Block, port: string) => (mainPort(block) ?? "next") === port;

/**
 * An unconnected exit falls back to `next` (programs.md §7.1), except on `if` and the toggle's team exits
 * (the game goes on). Only counts when `next` goes where the main exit goes.
 */
function fallsBack(block: Block, port: string): boolean {
  if (block.type === "if" || block.type === "toggle" || port === "next") return false;
  return link(block, "next") !== undefined && link(block, "next") === mainTargetOf(block);
}

/** Where the flow goes when the step simply goes on: the step after it in the list, else the end of the round. */
export function naturalNext(steps: readonly Step[], name: string): string | undefined {
  const { step, after } = stepNeighbours(steps, name);
  return after ? entryOf(after) : step?.inLoop;
}

export function exitValue(blocks: ReadonlyMap<string, Block>, steps: readonly Step[], block: Block, port: string): ExitValue {
  const to = link(block, port);
  const step = steps.find((s) => s.block === block.name && !s.loop);
  const loop = loopOf(steps, block.name);
  if (isMainExit(block, port)) {
    if (to === undefined) return { kind: "none" };
    const jumps = !!step?.branches.some((b) => b.port === port && b.role === "then");
    if (!jumps) return { kind: "next" };
  } else if (to === undefined) {
    return fallsBack(block, port) ? { kind: "next" } : { kind: "none" };
  } else if (to === mainTargetOf(block)) {
    return { kind: "next" };
  }
  const target = to === undefined ? undefined : blocks.get(to);
  if (!isMainExit(block, port) && isMissCounterBlock(target) && link(target, "next") === mainTargetOf(block)) return { kind: "countMiss" };
  if (loop && to === loop.head) return { kind: "nextRound" };
  if (loop && loop.after !== undefined && to === loop.after) return { kind: "leave" };
  return { kind: "step", target: to! };
}

/** Does a block wait before it moves on (`waits` of the model; an effect without `wait` and a summary without `show` do not)? */
function waitsNow(b: Block): boolean {
  if (b.type === "effect") return b.wait === true;
  if (b.type === "summary") return b.show === true;
  return !!blockType(b.type)?.waits;
}

/**
 * Would linking `port` of `name` to `target` make the program go round without a waiting step (the engine
 * runs 32 blocks per pass, programs.md §7.1, then the lights flicker)? A waiting `name` is fine.
 */
export function instantLoop(doc: ProgramJson, name: string, target: string): boolean {
  const blocks = new Map(ownBlocks(doc).map((b) => [b.name, b]));
  const from = blocks.get(name);
  if (!from || waitsNow(from)) return false;
  const seen = new Set<string>();
  const queue = [target];
  while (queue.length) {
    const id = queue.pop()!;
    if (id === name) return true;
    const b = blocks.get(id);
    if (!b || seen.has(id) || waitsNow(b)) continue;
    seen.add(id);
    for (const p of blockType(b.type)?.ports ?? []) {
      const t = link(b, p);
      if (t) queue.push(t);
    }
  }
  return false;
}

/** Sets an exit to a choice of the picker. `next` on an exit with a fallback removes the link. */
export function setExit(doc: ProgramJson, steps: readonly Step[], name: string, port: string, choice: ExitChoice): ProgramJson {
  const block = ownBlocks(doc).find((b) => b.name === name);
  if (!block) return doc;
  const loop = loopOf(steps, name);
  switch (choice.kind) {
    case "none":
      return removeExit(doc, name, port);
    case "countMiss":
      return linkMissCounter(doc, name, port);
    case "step":
      return setBlockField(removeExit(doc, name, port), name, port, choice.target);
    case "nextRound":
      return loop ? setBlockField(removeExit(doc, name, port), name, port, loop.head) : doc;
    case "leave":
      return loop?.after !== undefined ? setBlockField(removeExit(doc, name, port), name, port, loop.after) : doc;
    case "next": {
      if (isMainExit(block, port)) {
        const to = naturalNext(steps, name);
        return setBlockField(removeExit(doc, name, port), name, port, to);
      }
      const cleared = removeExit(doc, name, port);
      return fallsBack(block, port) ? cleared : setBlockField(cleared, name, port, mainTargetOf(block) ?? naturalNext(steps, name));
    }
  }
}

/** Which of the picker's optional choices make sense for this exit. */
export function exitChoices(block: Block, steps: readonly Step[], port: string): { countMiss: boolean; loop: boolean; none: boolean } {
  return { countMiss: isFailureExit(port), loop: !!loopOf(steps, block.name), none: block.type === "toggle" && port !== "next" };
}

/**
 * A step added with `createStep` after `from` sits in the flow; "a new step here…" wants it on the exit `port`
 * instead: `from` keeps its own links, `port` leads to the new step, which goes on where `from` did.
 */
export function connectNewStep(before: ProgramJson, added: ProgramJson, from: string, port: string, focus: string): ProgramJson {
  const old = ownBlocks(before).find((b) => b.name === from);
  if (!old) return added;
  return { ...added, blocks: ownBlocks(added).map((b) => (b.name === from ? { ...old, [port]: focus } : b)) };
}
