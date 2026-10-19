/**
 * Writes program files in the style of the shipped files: header fields on their own lines,
 * one block per line. Keeps files small (16 KB limit, BLE upload time) and readable.
 */
import { blockType } from "./blockTypes";
import { isObject } from "./program";

const PROGRAM_KEYS = ["version", "name", "description", "peripherals", "menu", "variables", "include", "start", "blocks"];

/** Block keys in a stable order: name, type, parameters, ports, then anything unknown. */
export function orderBlock(block: Record<string, unknown>): Record<string, unknown> {
  const def = blockType(block.type);
  const order = ["name", "type", ...(def?.fields.map((f) => f.name) ?? []), ...(def?.ports ?? [])];
  return orderKeys(block, order);
}

function orderKeys(obj: Record<string, unknown>, order: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of order) if (obj[key] !== undefined) out[key] = obj[key];
  for (const key of Object.keys(obj)) if (!(key in out) && obj[key] !== undefined) out[key] = obj[key];
  return out;
}

/** Compact JSON with a space after ":" and "," (`{ "a": 1, "b": [1, 2] }`). */
function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
  if (isObject(value)) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(", ")} }`;
  }
  return JSON.stringify(value);
}

/** Formats a program or fragment file. The result ends with "\n". */
export function formatProgram(doc: Record<string, unknown>): string {
  const ordered = orderKeys(doc, PROGRAM_KEYS);
  const lines = Object.entries(ordered).map(([key, value]) => {
    if (key === "blocks" && Array.isArray(value)) {
      if (value.length === 0) return `  "blocks": []`;
      const blocks = value.map((b) => `    ${inline(isObject(b) ? orderBlock(b) : b)}`);
      return `  "blocks": [\n${blocks.join(",\n")}\n  ]`;
    }
    return `  ${JSON.stringify(key)}: ${inline(value)}`;
  });
  return `{\n${lines.join(",\n")}\n}\n`;
}

/** /programs.json: one program per line, like firmware/data/programs.json. */
export function formatIndex(programs: readonly string[]): string {
  if (programs.length === 0) return `{\n  "programs": []\n}\n`;
  return `{\n  "programs": [\n${programs.map((p) => `    ${JSON.stringify(p)}`).join(",\n")}\n  ]\n}\n`;
}
