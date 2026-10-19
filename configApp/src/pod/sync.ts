/**
 * Sync between the local workspace and a pod (README §9.2–9.4): the state of every file,
 * the push plan and the push itself. Plain functions on top of PodClient; the Pod tab drives them.
 */
import { DEFAULT_FILES } from "../defaults";
import { formatProgram } from "../model/format";
import { INDEX_PATH, isLibraryPath } from "../model/limits";
import { isObject } from "../model/program";
import { resolveProgram, validateProgram, validateStore, type Issue } from "../model/validate";
import type { ProgramDoc, SyncBase } from "../store/programStore";
import type { PodClient } from "./client";
import { crcHex } from "./crc32";
import { writeFile } from "./files";
import { PodError, type FileEntry, type ListResponse } from "./protocol";
import { byteLength } from "./utf8";

/** README §9.2. `podOnly`: a pod file without a local copy (nothing to do). */
export type SyncStatus = "inSync" | "localNewer" | "podNewer" | "conflict" | "new" | "podOnly";

export type FileSync = {
  path: string;
  status: SyncStatus;
  /** the local program (not for the menu) */
  doc?: ProgramDoc;
  /** the text the app would upload */
  localText?: string;
  pod?: FileEntry;
};

export type SyncInput = {
  programs: readonly ProgramDoc[];
  /** the saved local menu; `undefined` = the menu follows the pod */
  menu: readonly string[] | undefined;
  list: ListResponse;
  podFiles: Readonly<Record<string, string>>;
  /** last common state per path (SyncState.files) */
  base: Readonly<Record<string, SyncBase>>;
};

/** `/programs.json` in the style of data/programs.json. */
export function formatMenu(menu: readonly string[]): string {
  return `${JSON.stringify({ programs: menu }, null, 2)}\n`;
}

/** The menu of a `/programs.json` text, `undefined` if it is not one. */
export function parseMenu(text: string): string[] | undefined {
  try {
    const doc = JSON.parse(text) as unknown;
    if (isObject(doc) && Array.isArray(doc.programs) && doc.programs.every((p) => typeof p === "string")) return doc.programs as string[];
  } catch {
    // not JSON
  }
  return undefined;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (!isObject(a) || !isObject(b)) return false;
  const keys = Object.keys(a).filter((k) => a[k] !== undefined);
  const other = Object.keys(b).filter((k) => b[k] !== undefined);
  return keys.length === other.length && keys.every((k) => deepEqual(a[k], b[k]));
}

/** Same program, even if the pod's file is formatted differently. */
function sameJson(text: string, json: unknown): boolean {
  try {
    return deepEqual(JSON.parse(text), json);
  } catch {
    return false;
  }
}

/** Last common CRC: remembered, or for an untouched copy of a shipped program the shipped file. */
export function baseCrc(path: string, doc: ProgramDoc | undefined, base: Readonly<Record<string, SyncBase>>): string | undefined {
  const known = base[path]?.crc;
  if (known) return known;
  const shipped = doc?.origin === "default" ? DEFAULT_FILES[path] : undefined;
  return shipped === undefined ? undefined : crcHex(shipped);
}

function decide(same: boolean, localCrc: string, podCrc: string, base: string | undefined): SyncStatus {
  if (same) return "inSync";
  if (base === undefined) return "conflict";
  if (podCrc === base) return "localNewer";
  if (localCrc === base) return "podNewer";
  return "conflict";
}

/** State of every local program, the local menu and every pod file. */
export function syncStates(input: SyncInput): FileSync[] {
  const podByPath = new Map(input.list.files.map((f) => [f.path, f]));
  const out: FileSync[] = [];
  const seen = new Set<string>();

  for (const doc of input.programs) {
    seen.add(doc.path);
    const localText = formatProgram(doc.json);
    const pod = podByPath.get(doc.path);
    if (!pod) {
      out.push({ path: doc.path, status: "new", doc, localText });
      continue;
    }
    const localCrc = crcHex(localText);
    const podCrc = pod.crc.toLowerCase();
    const podText = input.podFiles[doc.path];
    const same = localCrc === podCrc || (podText !== undefined && sameJson(podText, doc.json));
    out.push({ path: doc.path, status: decide(same, localCrc, podCrc, baseCrc(doc.path, doc, input.base)), doc, localText, pod });
  }

  if (input.menu) {
    seen.add(INDEX_PATH);
    const localText = formatMenu(input.menu);
    const pod = podByPath.get(INDEX_PATH);
    if (!pod) {
      out.push({ path: INDEX_PATH, status: "new", localText });
    } else {
      const same = deepEqual([...input.menu], input.list.menu);
      const base = input.base[INDEX_PATH]?.crc;
      const podCrc = pod.crc.toLowerCase();
      // the local menu is the set being built (decision 11): it wins unless the pod's menu changed since the last sync
      const status: SyncStatus = same ? "inSync" : base === undefined || podCrc === base ? "localNewer" : crcHex(localText) === base ? "podNewer" : "conflict";
      out.push({ path: INDEX_PATH, status, localText, pod });
    }
  }

  for (const pod of input.list.files) {
    if (!seen.has(pod.path)) out.push({ path: pod.path, status: pod.path === INDEX_PATH ? "inSync" : "podOnly", pod });
  }
  return out;
}

export function needsPush(state: FileSync): boolean {
  return state.status === "new" || state.status === "localNewer";
}

export type UploadReason = "program" | "menu" | "preset" | "shipped";
export type Upload = { path: string; text: string; reason: UploadReason };

export type PushPlan = {
  /** in upload order: library parts, programs, `/programs.json` last (config-api §7) */
  uploads: Upload[];
  /** programs checked on the pod after the upload: the menu and every uploaded program */
  validate: string[];
  /** local errors per file; any entry blocks the push */
  errors: Map<string, Issue[]>;
  /** local changes that are not pushed (pod newer, conflict) */
  skipped: FileSync[];
};

export type PlanOptions = {
  podFiles: Readonly<Record<string, string>>;
  list: ListResponse;
  supportedTypes?: readonly string[];
  /** paths to push; default: every file that needs a push */
  selected?: ReadonlySet<string>;
};

/** README §9.3 steps 1–2: what to upload, and the local checks. */
export function planPush(states: readonly FileSync[], options: PlanOptions): PushPlan {
  const uploads = new Map<string, Upload>();
  for (const state of states) {
    if (!needsPush(state) || state.localText === undefined) continue;
    if (options.selected && !options.selected.has(state.path)) continue;
    uploads.set(state.path, { path: state.path, text: state.localText, reason: state.path === INDEX_PATH ? "menu" : "program" });
  }
  return completePlan(uploads, states.filter((s) => s.status === "podNewer" || s.status === "conflict"), options);
}

/** Restore defaults (README §9.4): every shipped file that differs on the pod, the shipped menu last. */
export function planRestore(options: PlanOptions): PushPlan {
  const pod = new Map(options.list.files.map((f) => [f.path, f.crc.toLowerCase()]));
  const uploads = new Map<string, Upload>();
  for (const [path, text] of Object.entries(DEFAULT_FILES)) {
    if (pod.get(path) === crcHex(text) && path !== INDEX_PATH) continue;
    const reason: UploadReason = path === INDEX_PATH ? "menu" : isLibraryPath(path) ? "preset" : "shipped";
    uploads.set(path, { path, text, reason });
  }
  // the menu is always written, so the shipped order comes back even if only the order differs
  return completePlan(uploads, [], options);
}

function completePlan(uploads: Map<string, Upload>, skipped: FileSync[], options: PlanOptions): PushPlan {
  const read = (p: string) => uploads.get(p)?.text ?? options.podFiles[p];
  const menuUpload = uploads.get(INDEX_PATH);
  const menu = (menuUpload ? parseMenu(menuUpload.text) : undefined) ?? options.list.menu;

  // menu entries the pod does not have and nobody uploads: the shipped program
  for (const path of menu) {
    if (read(path) === undefined && DEFAULT_FILES[path] !== undefined) uploads.set(path, { path, text: DEFAULT_FILES[path], reason: "shipped" });
  }
  // presets (includes) the pod does not have: from the shipped library
  for (const upload of [...uploads.values()]) {
    if (upload.reason !== "program" && upload.reason !== "shipped") continue;
    for (const file of resolveProgram(upload.path, (p) => read(p) ?? DEFAULT_FILES[p]).files.keys()) {
      if (read(file) === undefined && DEFAULT_FILES[file] !== undefined) uploads.set(file, { path: file, text: DEFAULT_FILES[file], reason: "preset" });
    }
  }

  const programs = [...uploads.values()].filter((u) => u.reason === "program" || u.reason === "shipped");
  const errors = new Map<string, Issue[]>();
  const keep = (path: string, issues: Issue[]) => {
    const found = issues.filter((i) => i.severity === "error");
    if (found.length) errors.set(path, found);
  };
  const validateOptions = { supportedTypes: options.supportedTypes };
  if (menuUpload) {
    for (const [path, issues] of validateStore(read, validateOptions)) keep(path, issues);
  }
  for (const upload of programs) {
    if (!errors.has(upload.path)) keep(upload.path, validateProgram(upload.path, read, validateOptions).issues);
  }

  const rank: Record<UploadReason, number> = { preset: 0, shipped: 1, program: 1, menu: 2 };
  const ordered = [...uploads.values()].sort((a, b) => rank[a.reason] - rank[b.reason] || (a.path < b.path ? -1 : 1));
  const validate = [...new Set([...menu, ...programs.map((u) => u.path)])].filter((p) => read(p) !== undefined);
  return { uploads: ordered, validate, errors, skipped };
}

/** A message of the pod's loader, e.g. "/prog/x.json: block 'Hit' has unknown type 'buton'". */
export type PodIssue = { path: string; file?: string; block?: string; message: string };

export function parsePodMessage(path: string, message: string): PodIssue {
  const file = /^(\/\S+?): /.exec(message)?.[1];
  const block = /block(?: name)? '([^']+)'/.exec(message)?.[1];
  return { path, file, block, message };
}

export type PushStep = { phase: "upload" | "check"; path: string; done: number; total: number };

export type PushOptions = {
  /** `info.features` has `validateInline`: dry run of each program before anything changes */
  dryRun?: boolean;
  maxRequest: number;
  chunkBytes?: number;
  onStep?: (step: PushStep) => void;
  /** after each successful upload (to remember the sync state at once) */
  onUploaded?: (path: string, base: SyncBase) => void | Promise<void>;
};

export type PushResult = {
  uploaded: string[];
  /** `invalid_program` messages of the pod */
  podIssues: PodIssue[];
  /** the dry run failed: no program and no menu was uploaded */
  stopped: boolean;
};

async function check(client: PodClient, path: string, data: string | undefined, issues: PodIssue[]) {
  try {
    await client.validate(path, data);
  } catch (e) {
    if (e instanceof PodError && e.code === "invalid_program") issues.push(parsePodMessage(path, e.message));
    else throw e;
  }
}

/**
 * README §9.3 steps 3–4. Library parts first; with `dryRun` every program is checked by the pod's
 * loader before it is uploaded; the menu last; then `validate` on the pod. Errors other than
 * `invalid_program` (busy, auth_required, disconnected, …) are thrown; files uploaded until then stay.
 */
export async function executePush(client: PodClient, plan: PushPlan, options: PushOptions): Promise<PushResult> {
  const result: PushResult = { uploaded: [], podIssues: [], stopped: false };
  const total = plan.uploads.length;
  let done = 0;
  const upload = async (item: Upload) => {
    options.onStep?.({ phase: "upload", path: item.path, done, total });
    const response = await writeFile(client, item.path, item.text, { chunkBytes: options.chunkBytes, maxRequest: options.maxRequest });
    result.uploaded.push(item.path);
    done++;
    await options.onUploaded?.(item.path, { crc: response.crc ?? crcHex(item.text), size: response.size ?? byteLength(item.text) });
  };

  const presets = plan.uploads.filter((u) => u.reason === "preset");
  const rest = plan.uploads.filter((u) => u.reason !== "preset");
  for (const item of presets) await upload(item);

  if (options.dryRun) {
    for (const item of rest) {
      if (item.reason === "menu") continue;
      const request = { op: "validate", id: 2 ** 31, path: item.path, data: item.text };
      if (byteLength(JSON.stringify(request)) + 1 > options.maxRequest) continue; // too big: checked after the upload
      options.onStep?.({ phase: "check", path: item.path, done, total });
      await check(client, item.path, item.text, result.podIssues);
    }
    if (result.podIssues.length) {
      result.stopped = true;
      return result;
    }
  }

  for (const item of rest) await upload(item);
  for (const path of plan.validate) {
    options.onStep?.({ phase: "check", path, done, total });
    await check(client, path, undefined, result.podIssues);
  }
  return result;
}
