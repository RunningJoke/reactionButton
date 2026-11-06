/** Limits and path rules of the pod's program store (docs/firmware/config-api.md §4). */

export const INDEX_PATH = "/programs.json";
export const PROGRAM_DIR = "/prog/";
export const LIBRARY_DIR = "/prog/lib/";

export const MAX_PATH = 31;
export const MAX_FILE_SIZE = 16384;
export const MAX_REQUEST = 12288;
/** Sum of a set's files in bytes: SPIFFS 384 KB is reliable to 288 KB and a full sync needs the store twice (ADR 0009). */
export const MAX_STORE_BYTES = 144 * 1024;
export const MAX_GET_CHUNK = 4096;
export const MAX_INCLUDE_DEPTH = 3;
export const MAX_PERIPHERALS = 7;
export const LED_COUNT = 18;
export const PROGRAM_FORMAT_VERSION = 1;
/**
 * Revision of block fields, ports and semantics the app's block types match (`info.programFormat`,
 * programs.md §6). 2: `timerStart` / `timerStop` on every block, block type `repeat`.
 * 3: block type `effect`, `countdown` fields on timed blocks, block types `charge` and `release`.
 * 4: block type `toggle`.
 * 5: block type `communicate` (reports, remote ops).
 * 6: `summary` shows the average as a bar on the central's ring (`show`, `targetMs`, `showMs`).
 */
export const PROGRAM_FORMAT = 6;
/** Longest set name in bytes (`setName`). */
export const MAX_SET_NAME = 16;

/** Whether the files of a set (sizes in bytes) exceed MAX_STORE_BYTES. Exactly at the limit is not over. */
export function storeOverBudget(sizes: readonly number[]): boolean {
  return sizes.reduce((sum, size) => sum + size, 0) > MAX_STORE_BYTES;
}

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
/** User-facing program texts (`story`, `labels`; programs.md 1.2): languages and limits in code points. */
export const TEXT_LANGUAGES = ["en", "de"] as const;
export const MAX_STORY_CHARS = 255;
export const MAX_LABEL_CHARS = 32;
