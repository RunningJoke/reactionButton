import { createHash } from "node:crypto";
import { isLibraryPath, isValidPath, programFormatOf, validateProgram, type Issue } from "@reactpod/program-model";
import type { Ports } from "../../core/ports";
import { AppError, invalidInput } from "../../core/errors";

export type CheckedProgram = {
  path: string;
  text: string;
  json: Record<string, unknown>;
  issues: Issue[];
  errors: number;
  warnings: number;
  /** the program format revision the program needs, with its includes (programs.md §6) */
  programFormat: number;
};

/**
 * Checks a program file for saving: valid path, parseable JSON object, includes only the shipped
 * library parts (the platform serves those itself; other includes are flattened in the app first).
 * Validation errors do not stop saving a draft, only publishing.
 */
export function checkProgram(ports: Ports, path: string, text: string): CheckedProgram {
  if (!isValidPath(path) || isLibraryPath(path) || path === "/programs.json") {
    throw invalidInput("`path` must be a program path like /prog/sprint.json (not the library or the menu).");
  }
  const source = (p: string) => (p === path ? text : ports.library[p]);
  const resolved = validateProgram(path, source);
  if (!resolved.doc) {
    throw new AppError(400, "invalid_program", "The program is not a JSON object.", { issues: resolved.issues });
  }
  const foreign = [...resolved.files.keys()].filter((p) => p !== path && ports.library[p] === undefined);
  const missing = resolved.issues.filter((i) => i.code === "fileNotFound").map((i) => String(i.params?.path));
  if (foreign.length > 0 || missing.length > 0) {
    throw new AppError(400, "include_not_shipped", "Programs may include only the shipped library parts (/prog/lib/*). Flatten other includes in the app.", {
      includes: [...new Set([...foreign, ...missing])],
    });
  }
  const errors = resolved.issues.filter((i) => i.severity === "error").length;
  return {
    path,
    text,
    json: resolved.doc,
    issues: resolved.issues,
    errors,
    warnings: resolved.issues.length - errors,
    programFormat: programFormatOf(resolved),
  };
}

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Escapes % and _ for ILIKE. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
