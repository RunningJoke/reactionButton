import type { Color } from "./colors";

/** JSON program format v1 (docs/firmware/programs.md). Types describe valid files; parsed input is checked by validate.ts. */

/** A number or the name of a variable, read when the block runs. */
export type Value = number | string;

export type MenuGroup = { leds: number[]; color: Color };

export type Block = {
  name: string;
  type: string;
  /** parameters and ports; ports hold the name of the next block */
  [field: string]: unknown;
};

/** A text per language (`en`, `de`). */
export type LocalizedText = { en?: string; de?: string };

/** A complete program (listed in /programs.json). */
export type ProgramFile = {
  version?: number;
  name: string;
  /** developer note */
  description?: string;
  /** "What happens" for coaches per language; ignored by the firmware (programs.md 1.2) */
  story?: LocalizedText;
  /** metric or variable name to words for coaches; ignored by the firmware */
  labels?: Record<string, LocalizedText>;
  peripherals?: number;
  menu?: MenuGroup[];
  variables?: Record<string, number>;
  include?: string[];
  start?: string;
  blocks?: Block[];
};

/** An include fragment (e.g. /prog/lib/loop.json): variables and blocks only. */
export type FragmentFile = {
  description?: string;
  variables?: Record<string, number>;
  include?: string[];
  blocks?: Block[];
};

/** /programs.json */
export type ProgramIndex = { programs: string[] };

/** Variables the central sets before a program starts (programs.md §1.2). */
export const BUILTIN_VARIABLES = ["REQUIRED_PERIPHERALS", "NODE_COUNT"] as const;

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A file with a `name` is a program, otherwise a fragment. */
export function isProgramFile(doc: unknown): doc is ProgramFile {
  return isObject(doc) && typeof doc.name === "string";
}

const textOf = (value: unknown, lang: string): string | undefined => {
  if (!isObject(value)) return undefined;
  const text = value[lang] ?? value.en;
  return typeof text === "string" && text !== "" ? text : undefined;
};

/** The program's story in `lang` ("de-DE" counts as "de"), else English, else undefined. */
export function storyOf(doc: unknown, lang: string): string | undefined {
  return isObject(doc) ? textOf(doc.story, lang.slice(0, 2).toLowerCase()) : undefined;
}

/** The program's labels in `lang` (English as fallback): metric or variable name to words. */
export function labelsOf(doc: unknown, lang: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObject(doc) || !isObject(doc.labels)) return out;
  for (const [name, value] of Object.entries(doc.labels)) {
    const text = textOf(value, lang.slice(0, 2).toLowerCase());
    if (text !== undefined) out[name] = text;
  }
  return out;
}

export function peripheralsOf(doc: ProgramFile): number {
  return typeof doc.peripherals === "number" ? doc.peripherals : 0;
}
