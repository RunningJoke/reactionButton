/** Limits and path rules of the pod's program store (docs/firmware/config-api.md §4). */

export const INDEX_PATH = "/programs.json";
export const PROGRAM_DIR = "/prog/";
export const LIBRARY_DIR = "/prog/lib/";

export const MAX_PATH = 31;
export const MAX_FILE_SIZE = 16384;
export const MAX_REQUEST = 12288;
export const MAX_GET_CHUNK = 4096;
export const MAX_INCLUDE_DEPTH = 3;
export const MAX_PERIPHERALS = 7;
export const LED_COUNT = 18;
export const PROGRAM_FORMAT_VERSION = 1;
/**
 * Revision of block fields, ports and semantics the app's block types match (`info.programFormat`,
 * programs.md §6). 2: `timerStart` / `timerStop` on every block, block type `repeat`.
 */
export const PROGRAM_FORMAT = 2;
/** Longest set name in bytes (`setName`). */
export const MAX_SET_NAME = 16;

/** Same rules as ProgramStore::isValidPath in the firmware. */
export function isValidPath(path: unknown): path is string {
  if (typeof path !== "string" || path.length > MAX_PATH) return false;
  if (path === INDEX_PATH) return true;
  if (path.length <= PROGRAM_DIR.length || !path.startsWith(PROGRAM_DIR) || path.endsWith("/")) return false;
  const rest = path.slice(PROGRAM_DIR.length);
  if (!/^[A-Za-z0-9_\-./]+$/.test(rest)) return false;
  return !rest.includes("..") && !path.includes("//");
}

export function isLibraryPath(path: string): boolean {
  return path.startsWith(LIBRARY_DIR);
}

/** Longest slug for `/prog/<slug>.json` within MAX_PATH. */
export const MAX_SLUG = MAX_PATH - PROGRAM_DIR.length - ".json".length;

/** Program name → file path, e.g. "Übung Sprint 2" → "/prog/uebung-sprint-2.json". */
export function pathForName(name: string, taken: ReadonlySet<string> = new Set()): string {
  const base =
    name
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_SLUG)
      .replace(/-+$/, "") || "program";
  let path = `${PROGRAM_DIR}${base}.json`;
  for (let n = 2; taken.has(path) || isLibraryPath(path); n++) {
    const suffix = `-${n}`;
    path = `${PROGRAM_DIR}${base.slice(0, MAX_SLUG - suffix.length)}${suffix}.json`;
  }
  return path;
}
