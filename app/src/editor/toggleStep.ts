/**
 * The "Domination" step (`toggle` block, program format 4, programs.md §2, §7.15): small operations on
 * the team colours, the game length and the result variables. Pure: every function returns a new document.
 */
import { isNamedColor, TOGGLE_STARTS, type Block } from "@reactpod/program-model";
import { ownBlocks, setBlockField, type ProgramJson } from "./ops";

export { TOGGLE_STARTS };
export type ToggleStart = (typeof TOGGLE_STARTS)[number];

/** Team colours of a block without `colors` (A, B). */
export const DEFAULT_TEAM_COLORS: readonly [string, string] = ["red", "blue"];
/** Game length of a new step. */
export const DEFAULT_GAME_MS = 30_000;
/** Longest cooldown the link can carry (u16 ms). */
export const MAX_COOLDOWN_MS = 65_535;
export const DEFAULT_COOLDOWN_MS = 300;

/** The two team colours (A, B) as the pods show them; defaults for a missing or broken `colors`. */
export function teamColors(block: Block): [string, string] {
  const c = block.colors;
  if (Array.isArray(c) && c.length === 2 && c.every(isNamedColor)) return [String(c[0]), String(c[1])];
  return [DEFAULT_TEAM_COLORS[0], DEFAULT_TEAM_COLORS[1]];
}

/** Sets the colour of team `index` (0 = A, 1 = B); the default pair is not written. */
export function setTeamColor(doc: ProgramJson, name: string, index: 0 | 1, color: string | undefined): ProgramJson {
  const block = ownBlocks(doc).find((b) => b.name === name);
  if (!block) return doc;
  const pair = teamColors(block);
  pair[index] = color ?? DEFAULT_TEAM_COLORS[index];
  const isDefault = pair[0] === DEFAULT_TEAM_COLORS[0] && pair[1] === DEFAULT_TEAM_COLORS[1];
  return setBlockField(doc, name, "colors", isDefault ? undefined : pair);
}

export const toggleStart = (block: Block): ToggleStart => ((TOGGLE_STARTS as readonly unknown[]).includes(block.start) ? (block.start as ToggleStart) : "alternate");

export function setToggleStart(doc: ProgramJson, name: string, start: ToggleStart): ProgramJson {
  return setBlockField(doc, name, "start", start === "alternate" ? undefined : start);
}

/** Is the game length random (shortest / longest) rather than fixed? */
export const durationIsRandom = (block: Block) => block.durationMs === undefined && (block.minDurationMs !== undefined || block.maxDurationMs !== undefined);

/** Switches between one fixed game length and a random one; the time carries over. */
export function setDurationRandom(doc: ProgramJson, name: string, random: boolean): ProgramJson {
  const block = ownBlocks(doc).find((b) => b.name === name);
  if (!block || durationIsRandom(block) === random) return doc;
  if (random) {
    const base = block.durationMs ?? DEFAULT_GAME_MS;
    let next = setBlockField(doc, name, "minDurationMs", base);
    next = setBlockField(next, name, "maxDurationMs", typeof base === "number" ? base * 2 : base);
    return setBlockField(next, name, "durationMs", undefined);
  }
  let next = setBlockField(doc, name, "durationMs", block.minDurationMs ?? DEFAULT_GAME_MS);
  next = setBlockField(next, name, "minDurationMs", undefined);
  return setBlockField(next, name, "maxDurationMs", undefined);
}

/** The results a game can keep: field, default setting name, i18n key. */
export const TOGGLE_RESULTS = [
  ["storeA", "TEAM_A_PODS", "podsA"],
  ["storeB", "TEAM_B_PODS", "podsB"],
  ["storeTimeA", "TEAM_A_MS", "timeA"],
  ["storeTimeB", "TEAM_B_MS", "timeB"],
  ["storeFlips", "FLIPS", "flips"],
] as const;
