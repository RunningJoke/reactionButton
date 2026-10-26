/**
 * The "Light effect" step (`effect` block, program format 3, programs.md §2 / §7.11): small operations
 * that keep the fields consistent. Pure: every function returns a new document.
 */
import { EFFECTS, PERIODIC_EFFECTS, type Block } from "@reactpod/program-model";
import { ownBlocks, setBlockField, type ProgramJson } from "./ops";

export { EFFECTS };
export type EffectKind = (typeof EFFECTS)[number];

const DEFAULT_DURATION_MS = 2000;

export const effectKind = (block: Block): EffectKind => ((EFFECTS as readonly unknown[]).includes(block.effect) ? (block.effect as EffectKind) : "solid");

/** blink, pulse, spin: repeat every period, endless without a duration */
export const isPeriodic = (kind: string) => PERIODIC_EFFECTS.includes(kind);
/** fill, drain, dim, colorShift, trafficLight: run once over their duration */
export const isTimed = (kind: string) => !isPeriodic(kind) && kind !== "solid" && kind !== "off";
/** effects that use `color` (traffic light and off bring their own) */
export const usesColor = (kind: string) => kind !== "off" && kind !== "trafficLight";

const durationOf = (block: Block): number | string | undefined =>
  typeof block.durationMs === "number" || typeof block.durationMs === "string" ? block.durationMs : undefined;

/** Does the effect have an end? Timed ones always, periodic ones with a duration. */
export function hasEnd(block: Block): boolean {
  const kind = effectKind(block);
  if (isTimed(kind)) return true;
  if (!isPeriodic(kind)) return false;
  const d = durationOf(block);
  return typeof d === "string" || (typeof d === "number" && d > 0);
}

/** Endless periodic effect (no duration): waiting for it would never end. */
export const isEndless = (block: Block) => isPeriodic(effectKind(block)) && !hasEnd(block);

/** Changes the effect and fixes duration and wait for it. */
export function setEffectKind(doc: ProgramJson, name: string, kind: EffectKind): ProgramJson {
  const block = ownBlocks(doc).find((b) => b.name === name);
  if (!block) return doc;
  let next = setBlockField(doc, name, "effect", kind);
  if (!isTimed(kind) && !isPeriodic(kind)) {
    // solid / off: there is no length to wait for
    next = setBlockField(next, name, "durationMs", undefined);
    next = setBlockField(next, name, "wait", undefined);
  } else if (isTimed(kind) && durationOf(block) === undefined) {
    next = setBlockField(next, name, "durationMs", DEFAULT_DURATION_MS);
  } else if (isPeriodic(kind) && durationOf(block) === undefined && block.wait === true) {
    next = setBlockField(next, name, "wait", undefined);
  }
  // the second colour is only asked for by colour shift; the other effects keep a set value
  return next;
}

export type EffectTarget = "central" | "all" | "peripherals" | number;

export function setEffectTarget(doc: ProgramJson, name: string, target: EffectTarget): ProgramJson {
  return setBlockField(doc, name, "target", target === "central" ? undefined : target);
}

/** Periodic effects: endless (no duration) or for a time. Endless ones cannot be waited for. */
export function setEndless(doc: ProgramJson, name: string, endless: boolean): ProgramJson {
  if (endless) return setBlockField(setBlockField(doc, name, "durationMs", undefined), name, "wait", undefined);
  return setBlockField(doc, name, "durationMs", DEFAULT_DURATION_MS);
}
