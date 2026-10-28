/**
 * The countdown of timed steps (program format 3, programs.md §2 "Countdown"): the ring shows the
 * time running out. A pause (and the catch-early press) always has a time; a press or a pod
 * step has one while its time limit is on.
 */
import type { Block } from "@reactpod/program-model";
import { ownBlocks, setBlockField, type ProgramJson } from "./ops";
import { isCatchEarly } from "./structure";
import { switchState } from "./switches";

/** The styles the editor offers (`secret` = off). */
export const COUNTDOWN_STYLES = ["drain", "fill", "dim", "colorShift", "trafficLight"] as const;
export type CountdownStyle = (typeof COUNTDOWN_STYLES)[number];

/** The fields a countdown owns; they all go when it is switched off or the time limit is. */
export const COUNTDOWN_FIELDS = ["countdown", "countdownColor", "countdownFrom", "countdownTarget"] as const;

/** Where the pod lights up a pause countdown. */
export const COUNTDOWN_TARGETS = ["central", "all", "peripherals"] as const;

/**
 * `pause`: the step is a time (delay, catch-early press); `limit`: it has a time limit that can be
 * switched on; `game`: the game length of a toggle step is always its time; null: the step has no countdown.
 */
export function countdownKind(block: Block): "pause" | "limit" | "game" | null {
  switch (block.type) {
    case "delay":
      return "pause";
    case "button":
      return isCatchEarly(block) ? "pause" : "limit";
    case "remotePress":
    case "remoteMultiPress":
    case "charge":
    case "release":
      return "limit";
    case "toggle":
      return "game";
    default:
      return null;
  }
}

/** Does the step have a time the countdown can run over? */
export function hasCountdownTime(block: Block): boolean {
  const kind = countdownKind(block);
  return kind === "pause" || kind === "game" || (kind === "limit" && switchState(block, "timeLimit"));
}

export function countdownStyle(block: Block): CountdownStyle | null {
  return (COUNTDOWN_STYLES as readonly unknown[]).includes(block.countdown) ? (block.countdown as CountdownStyle) : null;
}

/** Style on, or null for off: `secret` is the same as no field. */
export function setCountdown(doc: ProgramJson, name: string, style: CountdownStyle | null): ProgramJson {
  const block = ownBlocks(doc).find((b) => b.name === name);
  if (!block || countdownKind(block) === null) return doc;
  let next = doc;
  if (style === null) {
    for (const f of COUNTDOWN_FIELDS) if (block[f] !== undefined) next = setBlockField(next, name, f, undefined);
    return next;
  }
  next = setBlockField(next, name, "countdown", style);
  // the end colour belongs to `colorShift` only
  if (style !== "colorShift" && block.countdownColor !== undefined) next = setBlockField(next, name, "countdownColor", undefined);
  return next;
}
