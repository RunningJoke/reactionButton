/**
 * Editing operations on a program file. Pure: every operation returns a new document and
 * leaves the input untouched, so the editor can keep snapshots for undo / redo.
 *
 * Only the program's own blocks are changed. Blocks of included files (presets) are read-only;
 * `flattenIncludes` turns them into own blocks.
 */
import { blockType, type BlockTypeDef } from "@reactpod/program-model";
import { isObject, type Block } from "@reactpod/program-model";
import type { ResolvedProgram } from "@reactpod/program-model";

export type ProgramJson = Record<string, unknown>;

export function ownBlocks(doc: ProgramJson): Block[] {
  return Array.isArray(doc.blocks) ? (doc.blocks.filter((b) => isObject(b) && typeof b.name === "string") as Block[]) : [];
}

function withBlocks(doc: ProgramJson, blocks: Block[]): ProgramJson {
  return { ...doc, blocks };
}

/** Sets or removes (undefined) top-level fields of the program. */
export function setProgramField(doc: ProgramJson, field: string, value: unknown): ProgramJson {
  const next = { ...doc };
  if (value === undefined) delete next[field];
  else next[field] = value;
  return next;
}

/** "remotePress" → "RemotePress1", the first free number. */
export function newBlockName(type: string, taken: ReadonlySet<string>): string {
  const base = type.charAt(0).toUpperCase() + type.slice(1);
  for (let n = 1; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
}

/** A new block with the required fields filled with sensible values. */
export function createBlock(def: BlockTypeDef, name: string): Block {
  const block: Block = { name, type: def.type };
  for (const field of def.fields) {
    if (!field.required) continue;
    switch (field.kind) {
      case "color":
        block[field.name] = "green";
        break;
      case "value":
        block[field.name] = 0;
        break;
      case "metric":
        block[field.name] = "reaction";
        break;
      case "variable":
        block[field.name] = "VALUE";
        break;
      default:
        if (field.default !== undefined) block[field.name] = field.default;
    }
  }
  if (def.type === "delay") block.ms = 1000;
  return block;
}

/**
 * Adds a block of `type`. With `after` (an own block that has a `next` port) the new block is
 * inserted behind it: after → new → the old next. Without blocks yet, the new block is the start.
 */
export function addBlock(doc: ProgramJson, type: string, taken: ReadonlySet<string>, after?: string | null): { doc: ProgramJson; name: string } {
  const def = blockType(type);
  if (!def) throw new Error(`unknown block type ${type}`);
  const name = newBlockName(type, taken);
  const block = createBlock(def, name);
  let blocks = ownBlocks(doc);
  const first = blocks.length === 0 && doc.start === undefined && doc.include === undefined && isProgram(doc);
  const anchor = after ? blocks.find((b) => b.name === after) : undefined;
  const anchorPort = anchor && blockType(anchor.type)?.ports[0] === "next" ? "next" : undefined;

  if (anchor && anchorPort) {
    const oldNext = anchor[anchorPort];
    if (typeof oldNext === "string" && def.ports.includes("next")) block.next = oldNext;
    blocks = blocks.map((b) => (b === anchor ? { ...b, next: name } : b));
    const at = blocks.findIndex((b) => b.name === after);
    blocks.splice(at + 1, 0, block);
  } else {
    blocks = [...blocks, block];
  }
  const next = withBlocks(doc, blocks);
  return { doc: first ? { ...next, start: name } : next, name };
}

function isProgram(doc: ProgramJson) {
  return typeof doc.name === "string";
}

/** Sets (or removes with undefined) one field or port of an own block. */
export function setBlockField(doc: ProgramJson, name: string, field: string, value: unknown): ProgramJson {
  return withBlocks(
    doc,
    ownBlocks(doc).map((b) => {
      if (b.name !== name) return b;
      const next = { ...b };
      if (value === undefined) delete next[field];
      else next[field] = value;
      return next;
    }),
  );
}

/** Changes the type of a block: keeps the fields and ports the new type has. */
export function changeBlockType(doc: ProgramJson, name: string, type: string): ProgramJson {
  const def = blockType(type);
  if (!def) return doc;
  return withBlocks(
    doc,
    ownBlocks(doc).map((b) => {
      if (b.name !== name) return b;
      const fresh = createBlock(def, name);
      for (const key of [...def.fields.map((f) => f.name), ...def.ports]) {
        if (b[key] !== undefined) fresh[key] = b[key];
      }
      return fresh;
    }),
  );
}

/** Renames an own block and every port and the start that point to it. */
export function renameBlock(doc: ProgramJson, from: string, to: string): ProgramJson {
  const blocks = ownBlocks(doc).map((b) => {
    const next: Block = b.name === from ? { ...b, name: to } : { ...b };
    for (const port of blockType(b.type)?.ports ?? []) if (next[port] === from) next[port] = to;
    return next;
  });
  const next = withBlocks(doc, blocks);
  if (doc.start === from) next.start = to;
  return next;
}

/** Removes an own block; ports that pointed to it are cleared, a start on it is removed. */
export function deleteBlock(doc: ProgramJson, name: string): ProgramJson {
  const blocks = ownBlocks(doc)
    .filter((b) => b.name !== name)
    .map((b) => {
      const next = { ...b };
      for (const port of blockType(b.type)?.ports ?? []) if (next[port] === name) delete next[port];
      return next;
    });
  const next = withBlocks(doc, blocks);
  if (doc.start === name) delete next.start;
  return next;
}

/** Copies an own block (without connections) and places it after the original. */
export function duplicateBlock(doc: ProgramJson, name: string, taken: ReadonlySet<string>): { doc: ProgramJson; name: string } {
  const blocks = ownBlocks(doc);
  const at = blocks.findIndex((b) => b.name === name);
  if (at < 0) return { doc, name };
  const source = blocks[at]!;
  const copyName = uniqueName(`${source.name}Copy`, taken);
  const copy: Block = { ...source, name: copyName };
  for (const port of blockType(source.type)?.ports ?? []) delete copy[port];
  const next = [...blocks];
  next.splice(at + 1, 0, copy);
  return { doc: withBlocks(doc, next), name: copyName };
}

export function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
}

/** Block names allowed by the firmware and readable in the trace: letters, digits, "_" and "-". */
export function isValidBlockName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(name);
}

/** Variable names: letters, digits and "_", not starting with a digit. */
export function isValidVariableName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(name);
}

/**
 * "Convert to editable copy": copies the blocks and variables of all included files into the
 * program (in load order) and removes the includes. Program variables keep their values.
 */
export function flattenIncludes(doc: ProgramJson, resolved: ResolvedProgram): ProgramJson {
  const own = ownBlocks(doc);
  const included = resolved.blocks.filter((b) => b.file !== resolved.path && isObject(b.block)).map((b) => ({ ...b.block }));
  const next: ProgramJson = { ...doc, variables: { ...resolved.variables }, blocks: [...included, ...own] };
  delete next.include;
  if (Object.keys(next.variables as object).length === 0) delete next.variables;
  return next;
}

/**
 * Template: copies the blocks and variables of a library fragment into the program. Block names
 * that already exist get a number; references inside the fragment follow the new names.
 * Existing variables keep their values.
 */
export function insertTemplate(doc: ProgramJson, fragment: ProgramJson, taken: ReadonlySet<string>): { doc: ProgramJson; names: string[] } {
  const blocks = ownBlocks(fragment);
  const used = new Set(taken);
  const rename = new Map<string, string>();
  for (const b of blocks) {
    const name = uniqueName(b.name, used);
    used.add(name);
    rename.set(b.name, name);
  }
  const copies = blocks.map((b) => {
    const copy: Block = { ...b, name: rename.get(b.name)! };
    for (const port of blockType(b.type)?.ports ?? []) {
      const target = copy[port];
      if (typeof target === "string" && rename.has(target)) copy[port] = rename.get(target);
    }
    return copy;
  });
  const variables = { ...(isObject(fragment.variables) ? fragment.variables : {}), ...(isObject(doc.variables) ? doc.variables : {}) };
  const next: ProgramJson = { ...doc, blocks: [...ownBlocks(doc), ...copies] };
  if (Object.keys(variables).length > 0) next.variables = variables;
  return { doc: next, names: copies.map((b) => b.name) };
}

/**
 * Own block names that included blocks point to (e.g. `EnterProgram` for loop.json). Renaming or
 * deleting them would break the preset, so the editor locks them.
 */
export function namesUsedByIncludes(resolved: ResolvedProgram): Map<string, string> {
  const used = new Map<string, string>();
  const own = new Set(resolved.blocks.filter((b) => b.file === resolved.path && isObject(b.block)).map((b) => b.block.name));
  for (const { file, block } of resolved.blocks) {
    if (file === resolved.path || !isObject(block)) continue;
    for (const port of blockType(block.type)?.ports ?? []) {
      const target = block[port];
      if (typeof target === "string" && own.has(target)) used.set(target, file);
    }
  }
  return used;
}

/** The empty document of a new program. */
export function newProgram(name: string): ProgramJson {
  return { version: 1, name, peripherals: 0, menu: [], blocks: [] };
}

/** Renames a program variable and every block field that reads or writes it. */
export function renameVariable(doc: ProgramJson, from: string, to: string): ProgramJson {
  const variables = isObject(doc.variables) ? doc.variables : {};
  const renamed = Object.fromEntries(Object.entries(variables).map(([k, v]) => [k === from ? to : k, v]));
  const blocks = ownBlocks(doc).map((b) => {
    const next = { ...b };
    for (const field of blockType(b.type)?.fields ?? []) {
      if ((field.kind === "value" || field.kind === "variable") && next[field.name] === from) next[field.name] = to;
    }
    return next;
  });
  return { ...doc, variables: renamed, blocks };
}
