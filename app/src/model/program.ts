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

/** A complete program (listed in /programs.json). */
export type ProgramFile = {
  version?: number;
  name: string;
  description?: string;
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

export function peripheralsOf(doc: ProgramFile): number {
  return typeof doc.peripherals === "number" ? doc.peripherals : 0;
}
