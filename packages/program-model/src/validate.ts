/**
 * Program checks. Mirrors tools/validate_programs.py and the firmware loader
 * (src/BlockManager/BlockManager.cpp). Errors stop a push, warnings do not.
 */
import { blockType, COMMON_FIELDS, type BlockTypeDef } from "./blockTypes";
import { isColor, isNamedColor } from "./colors";
import {
  INDEX_PATH,
  isValidPath,
  LED_COUNT,
  MAX_FILE_SIZE,
  MAX_INCLUDE_DEPTH,
  MAX_PATH,
  MAX_PERIPHERALS,
  PROGRAM_FORMAT_VERSION,
} from "./limits";
import { BUILTIN_VARIABLES, isObject, type Block } from "./program";
import { byteLength } from "./utf8";

export const ISSUE_CODES = [
  // files
  "fileNotFound",
  "invalidJson",
  "notAnObject",
  "invalidPath",
  "pathTooLong",
  "fileTooLarge",
  "includeTooDeep",
  "includeInvalid",
  // program
  "nameMissing",
  "versionUnsupported",
  "peripheralsRange",
  "variableNotInteger",
  "startNotFound",
  "noBlocks",
  "menuInvalid",
  "menuInvalidColor",
  "menuInvalidLed",
  // blocks
  "blockNoNameOrType",
  "duplicateBlock",
  "unknownType",
  "unsupportedType",
  "missingField",
  "notValue",
  "notText",
  "notBool",
  "invalidColor",
  "notNamedColor",
  "delayNeedsMs",
  "randomTimeoutPair",
  "unknownOption",
  "ledsNotList",
  "ledOutOfRange",
  "portNotText",
  "portUnknownTarget",
  // warnings
  "noOutgoing",
  "unreachable",
  "unknownVariable",
  "unknownField",
  // index
  "indexInvalid",
  "indexDuplicate",
  "indexNotProgram",
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];

export type Issue = {
  severity: "error" | "warning";
  code: IssueCode;
  /** file the issue is in */
  file: string;
  block?: string;
  field?: string;
  params?: Record<string, string | number>;
};

/** Returns the text of a store file, or undefined if it does not exist. */
export type FileSource = (path: string) => string | undefined;

export type ResolvedBlock = { file: string; block: Block };

export type ResolvedProgram = {
  path: string;
  doc: Record<string, unknown> | null;
  /** blocks in load order: includes first (depth first, in order), then the program's own */
  blocks: ResolvedBlock[];
  /** initial variables: includes first, the program overrides */
  variables: Record<string, number>;
  /** every file that was loaded, with its parsed content */
  files: Map<string, Record<string, unknown>>;
  issues: Issue[];
};

export type ValidateOptions = {
  /** `info.blockTypes` of the connected pod; types outside it are errors */
  supportedTypes?: readonly string[];
};

class Collector {
  issues: Issue[] = [];
  error(code: IssueCode, file: string, extra: Partial<Issue> = {}) {
    this.issues.push({ severity: "error", code, file, ...extra });
  }
  warn(code: IssueCode, file: string, extra: Partial<Issue> = {}) {
    this.issues.push({ severity: "warning", code, file, ...extra });
  }
}

function parseFile(path: string, source: FileSource, out: Collector, from: string): Record<string, unknown> | null {
  const tooLong = path.length > MAX_PATH;
  if (!isValidPath(path)) {
    out.error(tooLong ? "pathTooLong" : "invalidPath", from, { params: { path, max: MAX_PATH } });
  }
  const text = source(path);
  if (text === undefined) {
    out.error("fileNotFound", from, { params: { path } });
    return null;
  }
  const size = byteLength(text);
  if (size > MAX_FILE_SIZE) out.error("fileTooLarge", path, { params: { size, max: MAX_FILE_SIZE } });
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    out.error("invalidJson", path, { params: { detail: e instanceof Error ? e.message : String(e) } });
    return null;
  }
  if (!isObject(doc)) {
    out.error("notAnObject", path);
    return null;
  }
  return doc;
}

/** Loads a program with all includes, like the firmware does. */
export function resolveProgram(path: string, source: FileSource): ResolvedProgram {
  const out = new Collector();
  const result: ResolvedProgram = { path, doc: null, blocks: [], variables: {}, files: new Map(), issues: out.issues };

  const collect = (file: string, depth: number, from: string): Record<string, unknown> | null => {
    if (depth > MAX_INCLUDE_DEPTH) {
      out.error("includeTooDeep", from, { params: { path: file, max: MAX_INCLUDE_DEPTH } });
      return null;
    }
    const doc = parseFile(file, source, out, from);
    if (!doc) return null;
    result.files.set(file, doc);

    if (doc.include !== undefined) {
      if (!Array.isArray(doc.include) || !doc.include.every((p) => typeof p === "string")) {
        out.error("includeInvalid", file);
      } else {
        for (const include of doc.include as string[]) collect(include, depth + 1, file);
      }
    }
    if (doc.variables !== undefined) {
      if (!isObject(doc.variables)) {
        out.error("variableNotInteger", file, { params: { name: "variables" } });
      } else {
        for (const [name, value] of Object.entries(doc.variables)) {
          if (typeof value === "number" && Number.isInteger(value)) result.variables[name] = value;
          else out.error("variableNotInteger", file, { params: { name } });
        }
      }
    }
    if (Array.isArray(doc.blocks)) {
      for (const block of doc.blocks) result.blocks.push({ file, block: block as Block });
    }
    return doc;
  };

  result.doc = collect(path, 0, path);
  return result;
}

/** Checks a program (a file listed in /programs.json) with its includes. */
export function validateProgram(path: string, source: FileSource, options: ValidateOptions = {}): ResolvedProgram {
  const resolved = resolveProgram(path, source);
  const out = new Collector();
  out.issues = resolved.issues;
  const doc = resolved.doc;
  if (!doc) return resolved;

  // program header
  if (typeof doc.name !== "string" || doc.name.trim() === "") out.error("nameMissing", path);
  if (doc.version !== undefined && doc.version !== PROGRAM_FORMAT_VERSION) {
    out.warn("versionUnsupported", path, { params: { version: String(doc.version) } });
  }
  const peripherals = doc.peripherals ?? 0;
  if (typeof peripherals !== "number" || !Number.isInteger(peripherals) || peripherals < 0 || peripherals > MAX_PERIPHERALS) {
    out.error("peripheralsRange", path, { field: "peripherals", params: { max: MAX_PERIPHERALS } });
  }
  checkMenu(doc.menu, path, out);

  // block names
  const names = new Map<string, string>();
  for (const { file, block } of resolved.blocks) {
    if (!isObject(block) || typeof block.name !== "string" || typeof block.type !== "string") continue;
    const other = names.get(block.name);
    if (other !== undefined) {
      out.error("duplicateBlock", file, { block: block.name, params: { name: block.name, other } });
    } else {
      names.set(block.name, file);
    }
  }

  const known = knownVariables(resolved);
  for (const { file, block } of resolved.blocks) {
    checkBlock(file, block, names, known, out, options, file === path);
  }

  if (resolved.blocks.length === 0) out.error("noBlocks", path);
  if (doc.start !== undefined && (typeof doc.start !== "string" || !names.has(doc.start))) {
    out.error("startNotFound", path, { field: "start", params: { start: String(doc.start) } });
  }

  checkReachability(resolved, path, out);
  return resolved;
}

function checkMenu(menu: unknown, path: string, out: Collector) {
  if (menu === undefined) return;
  if (!Array.isArray(menu)) {
    out.error("menuInvalid", path, { field: "menu" });
    return;
  }
  for (const group of menu) {
    if (!isObject(group)) {
      out.error("menuInvalid", path, { field: "menu" });
      continue;
    }
    if (!isColor(group.color)) out.error("menuInvalidColor", path, { field: "menu" });
    const leds = group.leds;
    if (!Array.isArray(leds) || leds.some((led) => !Number.isInteger(led) || led < 0 || led >= LED_COUNT)) {
      out.error("menuInvalidLed", path, { field: "menu", params: { max: LED_COUNT - 1 } });
    }
  }
}

/** Variables that exist before a block reads them: declared, built in, or written by a block. */
function knownVariables(resolved: ResolvedProgram): Set<string> {
  const known = new Set<string>([...Object.keys(resolved.variables), ...BUILTIN_VARIABLES]);
  for (const { block } of resolved.blocks) {
    if (!isObject(block)) continue;
    const def = blockType(block.type);
    for (const field of def?.fields ?? []) {
      if (field.kind === "variable" && typeof block[field.name] === "string") known.add(block[field.name] as string);
    }
  }
  return known;
}

function checkBlock(
  file: string,
  block: unknown,
  names: Map<string, string>,
  knownVars: Set<string>,
  out: Collector,
  options: ValidateOptions,
  ownFile: boolean,
) {
  if (!isObject(block) || typeof block.name !== "string" || typeof block.type !== "string") {
    out.error("blockNoNameOrType", file);
    return;
  }
  const name = block.name;
  const at = (field?: string, params?: Issue["params"]): Partial<Issue> => ({ block: name, field, params });
  const def = blockType(block.type);
  if (!def) {
    out.error("unknownType", file, at("type", { type: block.type }));
    return;
  }
  if (options.supportedTypes && !options.supportedTypes.includes(def.type)) {
    out.error("unsupportedType", file, at("type", { type: def.type }));
  }

  for (const field of def.fields) {
    const value = block[field.name];
    if (value === undefined) {
      if (field.required) out.error("missingField", file, at(field.name));
      continue;
    }
    checkField(def, field.name, value, file, at, out, knownVars);
  }
  checkTypeRules(def, block, file, at, out);

  // ports
  let connected = false;
  for (const port of def.ports) {
    const target = block[port];
    if (target === undefined) continue;
    connected = true;
    if (typeof target !== "string") out.error("portNotText", file, at(port));
    else if (!names.has(target)) out.error("portUnknownTarget", file, at(port, { port, target }));
  }
  if (ownFile) {
    if (!connected) out.warn("noOutgoing", file, at());
    const allowed = new Set<string>([...COMMON_FIELDS, ...def.ports, ...def.fields.map((f) => f.name)]);
    for (const key of Object.keys(block)) {
      if (!allowed.has(key)) out.warn("unknownField", file, at(key, { field: key }));
    }
  }
}

function checkField(
  def: BlockTypeDef,
  name: string,
  value: unknown,
  file: string,
  at: (field?: string, params?: Issue["params"]) => Partial<Issue>,
  out: Collector,
  knownVars: Set<string>,
) {
  const field = def.fields.find((f) => f.name === name)!;
  switch (field.kind) {
    case "value":
      if (typeof value === "string") {
        if (!knownVars.has(value)) out.warn("unknownVariable", file, at(name, { name: value }));
      } else if (typeof value !== "number" || !Number.isInteger(value)) {
        out.error("notValue", file, at(name));
      }
      break;
    case "color":
      if (!isColor(value)) out.error("invalidColor", file, at(name));
      break;
    case "remoteColor":
      if (!isNamedColor(value)) out.error("notNamedColor", file, at(name));
      break;
    case "leds":
      if (!Array.isArray(value)) out.error("ledsNotList", file, at(name));
      else
        for (const led of value) {
          if (!Number.isInteger(led) || led < 0 || led >= LED_COUNT) {
            out.error("ledOutOfRange", file, at(name, { led: String(led), max: LED_COUNT - 1 }));
          }
        }
      break;
    case "enum": {
      const ok = [...(field.options ?? []), ...(field.aliases ?? [])];
      if (typeof value !== "string" || !ok.includes(value)) {
        out.error("unknownOption", file, at(name, { value: String(value), options: (field.options ?? []).join(", ") }));
      }
      break;
    }
    case "variable":
    case "metric":
      if (typeof value !== "string" || value === "") out.error("notText", file, at(name));
      break;
    case "bool":
      if (typeof value !== "boolean") out.error("notBool", file, at(name));
      break;
  }
}

function checkTypeRules(
  def: BlockTypeDef,
  block: Record<string, unknown>,
  file: string,
  at: (field?: string) => Partial<Issue>,
  out: Collector,
) {
  if (def.type === "delay" && block.ms === undefined && (block.minMs === undefined || block.maxMs === undefined)) {
    out.error("delayNeedsMs", file, at("ms"));
  }
  if (def.type === "button" && (block.minTimeoutMs === undefined) !== (block.maxTimeoutMs === undefined)) {
    out.error("randomTimeoutPair", file, at("minTimeoutMs"));
  }
}

/** Warns about own blocks that can never run. */
function checkReachability(resolved: ResolvedProgram, path: string, out: Collector) {
  const byName = new Map<string, Block>();
  for (const { block } of resolved.blocks) {
    if (isObject(block) && typeof block.name === "string" && !byName.has(block.name)) byName.set(block.name, block);
  }
  const doc = resolved.doc!;
  const first = resolved.blocks.find(({ block }) => isObject(block) && typeof block.name === "string");
  const start = typeof doc.start === "string" ? doc.start : first?.block.name;
  if (!start || !byName.has(start)) return;

  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const block = byName.get(queue.pop()!)!;
    for (const port of blockType(block.type)?.ports ?? []) {
      const target = block[port];
      if (typeof target === "string" && byName.has(target) && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  for (const { file, block } of resolved.blocks) {
    if (file === path && isObject(block) && typeof block.name === "string" && !seen.has(block.name)) {
      out.warn("unreachable", file, { block: block.name });
    }
  }
}

/** Checks /programs.json and every program in it. */
export function validateStore(source: FileSource, options: ValidateOptions = {}): Map<string, Issue[]> {
  const result = new Map<string, Issue[]>();
  const indexIssues = new Collector();
  result.set(INDEX_PATH, indexIssues.issues);

  const index = parseFile(INDEX_PATH, source, indexIssues, INDEX_PATH);
  if (!index) return result;
  const programs = index.programs;
  if (!Array.isArray(programs) || !programs.every((p) => typeof p === "string")) {
    indexIssues.error("indexInvalid", INDEX_PATH);
    return result;
  }
  const seen = new Set<string>();
  for (const program of programs as string[]) {
    if (seen.has(program)) {
      indexIssues.warn("indexDuplicate", INDEX_PATH, { params: { path: program } });
      continue;
    }
    seen.add(program);
    const resolved = validateProgram(program, source, options);
    if (resolved.doc && typeof resolved.doc.name !== "string") {
      indexIssues.error("indexNotProgram", INDEX_PATH, { params: { path: program } });
    }
    result.set(program, resolved.issues);
  }
  return result;
}

export function hasErrors(issues: Iterable<Issue>): boolean {
  for (const issue of issues) if (issue.severity === "error") return true;
  return false;
}
