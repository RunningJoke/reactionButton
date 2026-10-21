/**
 * "Which pod" of a `remotePress` step (editor-ux.md §4 D): a fixed pod, or a pod chosen at random
 * by a `setVariable … random` step right before it ("random pod", "random, never the same twice").
 * Pure: every change returns a new document.
 */
import { blockType, isObject, type Block } from "@reactpod/program-model";
import { ownBlocks, uniqueName, type ProgramJson } from "./ops";

export type PodChoice = { kind: "pod"; pod: number } | { kind: "random" | "randomOther"; pick: string; variable: string } | { kind: "other" };

/** Variable a new random pick writes (the wizard's name). */
export const PICK_VARIABLE = "SELECTED_POD";

const RANDOM_OPS: Record<string, "random" | "randomOther"> = { random: "random", "?": "random", randomOther: "randomOther", "!": "randomOther" };

/** The block that picks the pod: a random setVariable on the pod's variable that leads to the step. */
function pickOf(blocks: readonly Block[], block: Block): Block | undefined {
  if (typeof block.pod !== "string") return undefined;
  return blocks.find((b) => b.type === "setVariable" && b.var === block.pod && RANDOM_OPS[String(b.op)] !== undefined && b.next === block.name);
}

export function podChoice(doc: ProgramJson, name: string): PodChoice {
  const blocks = ownBlocks(doc);
  const block = blocks.find((b) => b.name === name);
  if (!block) return { kind: "other" };
  if (typeof block.pod === "number") return { kind: "pod", pod: block.pod };
  const pick = pickOf(blocks, block);
  return pick ? { kind: RANDOM_OPS[String(pick.op)]!, pick: pick.name, variable: pick.var as string } : { kind: "other" };
}

const portsOf = (b: Block) => blockType(b.type)?.ports ?? [];

/** Points every link (and the start) to `from` at `to` instead. */
function relink(blocks: Block[], doc: ProgramJson, from: string, to: string, except?: string): { blocks: Block[]; start: unknown } {
  const next = blocks.map((b) => {
    if (b.name === except) return b;
    let copy: Block | null = null;
    for (const p of portsOf(b)) {
      if (b[p] !== from) continue;
      copy ??= { ...b };
      copy[p] = to;
    }
    return copy ?? b;
  });
  return { blocks: next, start: doc.start === from ? to : doc.start };
}

function withStart(doc: ProgramJson, blocks: Block[], start: unknown): ProgramJson {
  const next: ProgramJson = { ...doc, blocks };
  if (start === undefined) delete next.start;
  else next.start = start;
  return next;
}

function used(blocks: readonly Block[], variable: string): boolean {
  return blocks.some((b) => Object.entries(b).some(([k, v]) => k !== "name" && k !== "type" && v === variable));
}

/**
 * Sets which pod a step lights. A fixed pod removes the pick step in front of it (when nothing else
 * reads its variable); a random choice adds one (or changes the existing one).
 */
export function setPodChoice(doc: ProgramJson, name: string, choice: { kind: "pod"; pod: number } | { kind: "random" | "randomOther" }): ProgramJson {
  let blocks = ownBlocks(doc);
  const block = blocks.find((b) => b.name === name);
  if (!block) return doc;
  const pick = pickOf(blocks, block);

  if (choice.kind === "pod") {
    blocks = blocks.map((b) => (b.name === name ? { ...b, pod: choice.pod } : b));
    if (!pick) return { ...doc, blocks };
    const variable = pick.var as string;
    const re = relink(blocks.filter((b) => b.name !== pick.name), doc, pick.name, name);
    let next = withStart(doc, re.blocks, re.start);
    if (!used(re.blocks, variable) && isObject(doc.variables) && variable in doc.variables) {
      const vars = { ...(doc.variables as Record<string, number>) };
      delete vars[variable];
      next = { ...next, variables: vars };
      if (Object.keys(vars).length === 0) delete next.variables;
    }
    return next;
  }

  if (pick) {
    // keep the range of the existing pick (random.json draws the central too)
    return { ...doc, blocks: blocks.map((b) => (b.name === pick.name ? { ...b, op: choice.kind } : b)) };
  }
  const variable = PICK_VARIABLE;
  const pickName = uniqueName("SelectPod", new Set(blocks.map((b) => b.name)));
  const re = relink(blocks, doc, name, pickName);
  const at = re.blocks.findIndex((b) => b.name === name);
  const added: Block = { name: pickName, type: "setVariable", var: variable, op: choice.kind, value: "REQUIRED_PERIPHERALS", next: name };
  const list = re.blocks.map((b) => (b.name === name ? { ...b, pod: variable } : b));
  list.splice(at, 0, added);
  const vars = isObject(doc.variables) ? (doc.variables as Record<string, number>) : {};
  return { ...withStart(doc, list, re.start), variables: variable in vars ? vars : { ...vars, [variable]: 0 } };
}
