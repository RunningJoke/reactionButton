/**
 * Block types the app knows (doc/programs.md §2). This is the app's own copy, kept separate
 * from the firmware on purpose: a new block type always needs a firmware update and an app update.
 * `info.blockTypes` of the connected pod says which of these it can run.
 */

export type FieldKind =
  | "value" /** number or variable name */
  | "color" /** any colour (central LEDs) */
  | "remoteColor" /** named colour only (sent to peripherals) */
  | "leds" /** list of LED indices 0..17 */
  | "enum"
  | "variable" /** name of a variable that is written */
  | "metric" /** name of a measurement metric */
  | "bool";

export type FieldDef = {
  name: string;
  kind: FieldKind;
  required?: boolean;
  /** firmware default when the field is missing (for display and simulation) */
  default?: unknown;
  /** enum options; the first is the canonical default */
  options?: readonly string[];
  /** further spellings the firmware accepts (validator only, the editor writes `options`) */
  aliases?: readonly string[];
};

export type BlockCategory = "light" | "wait" | "input" | "logic" | "remote" | "stats";

export type BlockTypeDef = {
  type: string;
  category: BlockCategory;
  /** output ports in firmware order; port 0 is the fallback when it is "next" */
  ports: readonly string[];
  fields: readonly FieldDef[];
  /** true if the block can wait (does not finish in the same loop pass) */
  waits: boolean;
};

export const IF_OPS = ["==", "!=", ">", "<", ">=", "<="] as const;
export const SET_OPS = ["=", "+", "-", "random", "randomOther"] as const;

export const BLOCK_TYPES: readonly BlockTypeDef[] = [
  {
    type: "led",
    category: "light",
    ports: ["next"],
    waits: false,
    fields: [
      { name: "color", kind: "color", required: true },
      { name: "leds", kind: "leds" },
    ],
  },
  {
    type: "delay",
    category: "wait",
    ports: ["next"],
    waits: true,
    fields: [
      { name: "ms", kind: "value" },
      { name: "minMs", kind: "value" },
      { name: "maxMs", kind: "value" },
    ],
  },
  {
    type: "button",
    category: "input",
    ports: ["next", "short", "long", "pressed", "timeout"],
    waits: true,
    fields: [
      { name: "shortMs", kind: "value", default: 1000 },
      { name: "timeoutMs", kind: "value" },
      { name: "minTimeoutMs", kind: "value" },
      { name: "maxTimeoutMs", kind: "value" },
      { name: "record", kind: "metric" },
      { name: "storeAs", kind: "variable" },
    ],
  },
  {
    type: "if",
    category: "logic",
    ports: ["true", "false"],
    waits: false,
    fields: [
      { name: "left", kind: "value", required: true },
      { name: "op", kind: "enum", options: IF_OPS, aliases: ["=", "!"], default: "==" },
      { name: "right", kind: "value", required: true },
    ],
  },
  {
    type: "setVariable",
    category: "logic",
    ports: ["next"],
    waits: false,
    fields: [
      { name: "var", kind: "variable", required: true },
      { name: "op", kind: "enum", options: SET_OPS, aliases: ["set", "add", "sub", "?", "!"], default: "=" },
      { name: "value", kind: "value", required: true },
    ],
  },
  {
    type: "remotePress",
    category: "remote",
    ports: ["next", "timeout"],
    waits: true,
    fields: [
      { name: "pod", kind: "value", required: true },
      { name: "mode", kind: "enum", options: ["hit", "avoid"], default: "hit" },
      { name: "color", kind: "remoteColor" },
      { name: "colorAfter", kind: "remoteColor", default: "off" },
      { name: "timeoutMs", kind: "value" },
      { name: "record", kind: "metric" },
      { name: "storeAs", kind: "variable" },
    ],
  },
  {
    type: "remoteMultiPress",
    category: "remote",
    ports: ["next", "avoidHit", "timeout"],
    waits: true,
    fields: [
      { name: "pods", kind: "value" },
      { name: "avoid", kind: "value", default: 0 },
      { name: "includeCentral", kind: "bool", default: true },
      { name: "hitColor", kind: "remoteColor", default: "green" },
      { name: "avoidColor", kind: "remoteColor", default: "red" },
      { name: "syncStartMs", kind: "value", default: 20 },
      { name: "timeoutMs", kind: "value" },
      { name: "record", kind: "metric" },
    ],
  },
  {
    type: "remoteResetAll",
    category: "remote",
    ports: ["next"],
    waits: false,
    fields: [
      { name: "pods", kind: "value" },
      { name: "ledsOff", kind: "bool", default: true },
    ],
  },
  {
    type: "summary",
    category: "stats",
    ports: ["next"],
    waits: false,
    fields: [
      { name: "metric", kind: "metric", required: true },
      { name: "storeAverage", kind: "variable" },
      { name: "storeBest", kind: "variable" },
      { name: "storeWorst", kind: "variable" },
      { name: "storeCount", kind: "variable" },
      { name: "reset", kind: "bool", default: true },
    ],
  },
];

const BY_TYPE = new Map(BLOCK_TYPES.map((def) => [def.type, def]));

export function blockType(type: unknown): BlockTypeDef | undefined {
  return typeof type === "string" ? BY_TYPE.get(type) : undefined;
}

/** Block fields that are neither ports nor parameters. */
export const COMMON_FIELDS = ["name", "type"] as const;
