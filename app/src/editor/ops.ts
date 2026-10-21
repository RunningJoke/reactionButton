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
import { entryOf, mainPort, portsOf, stepFamily, stepList, stepNeighbours } from "./structure";

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

/**
 * Moves a step of the step list one place up or down within its list (the round, a branch, the
 * steps after the last round). The step's branch steps move with it, and the links are rewired so
 * the flow follows the new order: what came before the pair now leads to the other step, a branch
 * that rejoined "after this step" still does. `flat` is the program with the blocks of its includes
 * (default: `doc`); only own blocks are changed. Returns `doc` unchanged when the move is not
 * possible (first / last in its list, past a Repeat bracket, or a library block would have to change).
 */
export function moveStep(doc: ProgramJson, name: string, direction: "up" | "down", flat: ProgramJson = doc): ProgramJson {
  const steps = stepList(flat);
  const { step, before, after } = stepNeighbours(steps, name);
  if (!step) return doc;
  const other = direction === "down" ? after : before;
  if (!other || other.loop) return doc;
  // always move the upper step (b) down past the lower one (c)
  const [b, c] = direction === "down" ? [step, other] : [other, step];
  const all = new Map(flatBlocks(flat).map((x) => [x.name, x]));
  const B = all.get(b.block);
  const C = all.get(c.block);
  if (!B || !C) return doc;
  const mainB = mainPort(B);
  if (!mainB || B[mainB] !== c.block) return doc;
  const mainC = mainPort(C);
  const { after: afterC } = stepNeighbours(steps, c.block);
  const D = mainC ? (C[mainC] as string) : afterC ? entryOf(afterC) : undefined;
  const groupB = new Set(stepFamily(steps, b.block));
  const groupC = new Set(stepFamily(steps, c.block));

  const own = new Set(ownBlocks(doc).map((x) => x.name));
  const rewire = (x: Block, port: string, t: string): string | undefined | typeof KEEP => {
    if (x.name === B.name && port === mainB) return D;
    if (x.name === C.name && port === mainC) return B.name;
    if (groupB.has(x.name) && t === C.name) return D;
    if (groupC.has(x.name) && t === D) return B.name;
    if (!groupB.has(x.name) && !groupC.has(x.name)) {
      if (t === B.name) return C.name;
      if (t === C.name) return B.name;
    }
    return KEEP;
  };

  let blocked = false;
  const blocks = ownBlocks(doc).map((x) => ({ ...x }));
  for (const x of flatBlocks(flat)) {
    const target = own.has(x.name) ? blocks.find((y) => y.name === x.name)! : null;
    for (const port of portsOf(x)) {
      const t = x[port];
      if (typeof t !== "string") continue;
      const to = rewire(x, port, t);
      if (to === KEEP || to === t) continue;
      if (!target) blocked = true;
      else if (to === undefined) delete target[port];
      else target[port] = to;
    }
  }
  if (blocked) return doc;
  const next = withBlocks(doc, blocks);
  if (doc.start === B.name) next.start = C.name;
  else if (doc.start === C.name) next.start = B.name;
  return next;
}

const KEEP = Symbol("keep");

function flatBlocks(flat: ProgramJson): Block[] {
  return ownBlocks(flat);
}

/**
 * Deletes a step and the steps of its branches; links into the step continue with the step after
 * it, so the flow stays connected. Returns `doc` unchanged if a library block points into it.
 */
export function deleteStep(doc: ProgramJson, name: string, flat: ProgramJson = doc): ProgramJson {
  const steps = stepList(flat);
  const { step, after } = stepNeighbours(steps, name);
  const all = flatBlocks(flat);
  const B = all.find((x) => x.name === name);
  if (!B) return doc;
  const main = mainPort(B);
  const D = main ? (B[main] as string) : after ? entryOf(after) : undefined;
  const group = new Set(step ? stepFamily(steps, name) : [name]);
  const own = new Set(ownBlocks(doc).map((x) => x.name));
  if ([...group].some((g) => !own.has(g))) return doc;
  for (const x of all) {
    if (own.has(x.name) || group.has(x.name)) continue;
    if (portsOf(x).some((p) => typeof x[p] === "string" && group.has(x[p] as string))) return doc;
  }
  const blocks = ownBlocks(doc)
    .filter((x) => !group.has(x.name))
    .map((x) => {
      const next = { ...x };
      for (const port of portsOf(x)) {
        const t = next[port];
        if (typeof t !== "string" || !group.has(t)) continue;
        if (t === name && D !== undefined && !group.has(D)) next[port] = D;
        else delete next[port];
      }
      return next;
    });
  const next = withBlocks(doc, blocks);
  if (typeof doc.start === "string" && group.has(doc.start)) {
    if (D !== undefined && !group.has(D)) next.start = D;
    else delete next.start;
  }
  return next;
}

/**
 * Adds a step of `type` after the step `after` (on the port that leads to the next step), or
 * unconnected at the end when `after` is missing or a library block. Like `addBlock`, but knows
 * that a press continues at `pressed` and a pause that catches early presses at `timeout`.
 */
export function addStep(doc: ProgramJson, type: string, taken: ReadonlySet<string>, after?: string | null): { doc: ProgramJson; name: string } {
  const anchor = after ? ownBlocks(doc).find((b) => b.name === after) : undefined;
  const port = anchor ? (mainPort(anchor) ?? (portsOf(anchor)[0] === "next" ? "next" : undefined)) : undefined;
  if (!anchor || !port || port === "next") return addBlock(doc, type, taken, anchor && port ? after : null);
  const def = blockType(type);
  if (!def) throw new Error(`unknown block type ${type}`);
  const name = newBlockName(type, taken);
  const block = createBlock(def, name);
  const oldNext = anchor[port];
  if (typeof oldNext === "string" && def.ports.includes("next")) block.next = oldNext;
  const blocks = ownBlocks(doc).map((b) => (b === anchor ? { ...b, [port]: name } : b));
  blocks.splice(blocks.findIndex((b) => b.name === after) + 1, 0, block);
  return { doc: withBlocks(doc, blocks), name };
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
