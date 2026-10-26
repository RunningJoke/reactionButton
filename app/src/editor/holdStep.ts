/**
 * The "Hold to charge" and "Let go" steps (`charge` and `release` blocks, program format 3, programs.md §2,
 * §7.13, §7.14): small operations that keep the fields consistent with the mode. Pure: every function
 * returns a new document.
 */
import { CHARGE_MODES, CHARGE_STYLES, RELEASE_MODES, type Block } from "@reactpod/program-model";
import { ownBlocks, setBlockField, type ProgramJson } from "./ops";

export { CHARGE_STYLES };
export type ChargeStyle = (typeof CHARGE_STYLES)[number];
export type ChargeMode = (typeof CHARGE_MODES)[number];
export type ReleaseMode = (typeof RELEASE_MODES)[number];

export const isHoldStep = (block: Block) => block.type === "charge" || block.type === "release";

export const chargeMode = (block: Block): ChargeMode => (block.mode === "accumulate" ? "accumulate" : "release");
export const releaseMode = (block: Block): ReleaseMode => (block.mode === "signal" ? "signal" : "trigger");

/** The field of a `release` step that holds its time limit in this mode. */
export const releaseLimitField = (mode: ReleaseMode) => (mode === "signal" ? "timeoutMs" : "maxHoldMs");

/** The time limit field(s) a hold step has now: for `charge` its `timeoutMs`, for `release` the one of its mode. */
export function limitFieldOf(block: Block): "timeoutMs" | "maxHoldMs" {
  return block.type === "release" ? releaseLimitField(releaseMode(block)) : "timeoutMs";
}

const DEFAULT_GO_MIN_MS = 1500;
const DEFAULT_GO_MAX_MS = 3000;
export const DEFAULT_MAX_MS = 2000;

/** Which pod a hold step watches: the central or a pod (number), else "other" (a setting). */
export function holdPod(block: Block): "central" | number | "other" {
  if (block.pod === undefined || block.pod === "central") return "central";
  return typeof block.pod === "number" ? block.pod : "other";
}

export function setHoldPod(doc: ProgramJson, name: string, pod: "central" | number): ProgramJson {
  return setBlockField(doc, name, "pod", pod === "central" ? undefined : pod);
}

export function setChargeStyle(doc: ProgramJson, name: string, style: ChargeStyle): ProgramJson {
  let next = setBlockField(doc, name, "style", style === "fill" ? undefined : style);
  // the end colour belongs to colour shift only
  if (style !== "colorShift") next = setBlockField(next, name, "color2", undefined);
  return next;
}

/** `release` (a hold ends it) or `accumulate` (a release pauses or drains the charge, only full / time-out end it). */
export function setChargeMode(doc: ProgramJson, name: string, mode: ChargeMode): ProgramJson {
  let next = setBlockField(doc, name, "mode", mode === "release" ? undefined : mode);
  if (mode === "release") next = setBlockField(next, name, "decayMs", undefined);
  return next;
}

/** The fields only the signal mode has. */
const SIGNAL_FIELDS = ["goColor", "goMs", "minGoMs", "maxGoMs", "record"] as const;

/**
 * Changes the mode of a `release` step: the time limit moves to the field of the new mode (same value), signal
 * fields are added (a random 1.5–3 s until the signal) or removed with the false start link.
 */
export function setReleaseMode(doc: ProgramJson, name: string, mode: ReleaseMode): ProgramJson {
  const block = ownBlocks(doc).find((b) => b.name === name);
  if (!block || releaseMode(block) === mode) return doc;
  const from = releaseLimitField(releaseMode(block));
  const to = releaseLimitField(mode);
  let next = setBlockField(doc, name, "mode", mode === "trigger" ? undefined : mode);
  if (block[from] !== undefined) {
    next = setBlockField(next, name, to, block[from]);
    next = setBlockField(next, name, from, undefined);
  }
  if (mode === "signal") {
    if (block.goMs === undefined && block.minGoMs === undefined) {
      next = setBlockField(next, name, "minGoMs", DEFAULT_GO_MIN_MS);
      next = setBlockField(next, name, "maxGoMs", DEFAULT_GO_MAX_MS);
    }
    // a signal needs a hold that was not there before the step began
    return next;
  }
  for (const f of SIGNAL_FIELDS) next = setBlockField(next, name, f, undefined);
  return setBlockField(next, name, "falseStart", undefined);
}

/** Is the time until the signal random (shortest / longest) rather than fixed? */
export const goIsRandom = (block: Block) => block.goMs === undefined && (block.minGoMs !== undefined || block.maxGoMs !== undefined);

export function setGoRandom(doc: ProgramJson, name: string, random: boolean): ProgramJson {
  const block = ownBlocks(doc).find((b) => b.name === name);
  if (!block || goIsRandom(block) === random) return doc;
  let next = doc;
  if (random) {
    const fixed = typeof block.goMs === "number" ? block.goMs : undefined;
    next = setBlockField(next, name, "minGoMs", block.goMs ?? DEFAULT_GO_MIN_MS);
    next = setBlockField(next, name, "maxGoMs", fixed !== undefined ? fixed * 2 : typeof block.goMs === "string" ? block.goMs : DEFAULT_GO_MAX_MS);
    return setBlockField(next, name, "goMs", undefined);
  }
  next = setBlockField(next, name, "goMs", block.minGoMs ?? DEFAULT_GO_MIN_MS);
  next = setBlockField(next, name, "minGoMs", undefined);
  return setBlockField(next, name, "maxGoMs", undefined);
}
