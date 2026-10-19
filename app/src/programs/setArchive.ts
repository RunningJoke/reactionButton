/**
 * A whole set as a .zip: `programs.json` + `prog/…`, the same layout as `firmware/data/` (docs/app/spec.md §6).
 * Export: the local menu, its programs with their includes, and every local program.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { INDEX_PATH, isLibraryPath, isValidPath, MAX_FILE_SIZE } from "../model/limits";
import { resolveProgram, type FileSource } from "../model/validate";
import { formatMenu, parseMenu } from "../pod/sync";
import { isObject } from "../model/program";

/** More files than a pod can sensibly hold: the archive is not a set. */
const MAX_FILES = 200;

/** Store files of a set: the menu, its programs + includes, and `extra` paths (local programs). */
export function collectSet(menu: readonly string[], extra: Iterable<string>, read: FileSource): Record<string, string> {
  const files: Record<string, string> = { [INDEX_PATH]: formatMenu(menu) };
  for (const path of new Set([...menu, ...extra])) {
    for (const file of resolveProgram(path, read).files.keys()) {
      const text = read(file);
      if (text !== undefined) files[file] = text;
    }
  }
  return files;
}

export function zipSet(files: Readonly<Record<string, string>>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1))) entries[path.slice(1)] = strToU8(text);
  return zipSync(entries, { level: 6 });
}

export type ImportedSet = {
  menu?: string[];
  /** programs (files with a `name`, not in the library) */
  programs: { path: string; json: Record<string, unknown> }[];
  /** files that were not taken: library parts, fragments, invalid paths or JSON */
  ignored: string[];
};

/** Reads a set archive. Throws when it is not a zip or has no `programs.json` and no program. */
export function unzipSet(bytes: Uint8Array): ImportedSet {
  let count = 0;
  const entries = unzipSync(bytes, {
    filter: (file) => {
      count++;
      if (count > MAX_FILES) throw new Error("too many files");
      return !file.name.endsWith("/") && file.originalSize <= MAX_FILE_SIZE;
    },
  });
  // archives made by hand often have one top folder (e.g. "data/programs.json")
  const names = Object.keys(entries);
  const top = names.find((n) => n === "programs.json" || n.endsWith("/programs.json"));
  const prefix = top ? top.slice(0, -"programs.json".length) : "";

  const result: ImportedSet = { programs: [], ignored: [] };
  for (const name of names.sort()) {
    const path = `/${name.startsWith(prefix) ? name.slice(prefix.length) : name}`;
    let text: string;
    try {
      text = strFromU8(entries[name]!);
    } catch {
      result.ignored.push(path);
      continue;
    }
    if (path === INDEX_PATH) {
      result.menu = parseMenu(text);
      if (!result.menu) result.ignored.push(path);
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (!isValidPath(path) || isLibraryPath(path) || !isObject(json) || typeof json.name !== "string") {
      result.ignored.push(path);
      continue;
    }
    result.programs.push({ path, json });
  }
  if (!result.menu && result.programs.length === 0) throw new Error("not a program set");
  return result;
}
