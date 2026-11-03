/**
 * "Pick a pod at random" (a `setVariable` random step on the variable that names the pod): the plain choice
 * and the op / value pair it stands for. Pure; the expert fields edit the same two fields.
 */
import { isObject, type Block } from "@reactpod/program-model";
import { setBlockField, type ProgramJson } from "./ops";

export type PodPick = "any" | "never" | "notMain";

export const POD_PICKS: readonly PodPick[] = ["any", "never", "notMain"];

const RANDOM = ["random", "?"];
const RANDOM_OTHER = ["randomOther", "!"];
const POD_NAMES = /SELECTED|POD|BUZZER/i;

/** Is this step a random pick of a pod? Only the two pod counts have a plain version. */
export function isPodPick(block: Block, blocks: Iterable<Block>): boolean {
  if (block.type !== "setVariable" || typeof block.var !== "string") return false;
  if (![...RANDOM, ...RANDOM_OTHER].includes(String(block.op))) return false;
  if (block.value !== "NODE_COUNT" && block.value !== "REQUIRED_PERIPHERALS") return false;
  return POD_NAMES.test(block.var) || [...blocks].some((b) => isObject(b) && b.pod === block.var);
}

export function podPickOf(block: Block): PodPick {
  if (RANDOM_OTHER.includes(String(block.op))) return "never";
  return block.value === "REQUIRED_PERIPHERALS" ? "notMain" : "any";
}

/** The central has the pod number REQUIRED_PERIPHERALS, so counting only that many leaves it out. */
export function setPodPick(doc: ProgramJson, name: string, pick: PodPick): ProgramJson {
  const op = pick === "never" ? "randomOther" : "random";
  const value = pick === "notMain" ? "REQUIRED_PERIPHERALS" : "NODE_COUNT";
  return setBlockField(setBlockField(doc, name, "op", op), name, "value", value);
}
