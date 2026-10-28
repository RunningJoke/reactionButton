/**
 * JSON Schema (draft 2020-12) of the program format, generated from the block definitions
 * (docs/firmware/programs.md). The schema describes the structure for other languages and editors;
 * `validateProgram` stays the authority (references between blocks, reachability, limits per pod).
 */
import { BLOCK_TYPES, COMMON_FIELDS, TARGET_KEYWORDS, TIMER_FIELDS, type FieldDef } from "./blockTypes";
import { NAMED_COLORS } from "./colors";
import { LED_COUNT, MAX_PATH, MAX_PERIPHERALS, PROGRAM_FORMAT, PROGRAM_FORMAT_VERSION } from "./limits";

type Schema = Record<string, unknown>;

const ref = (name: string): Schema => ({ $ref: `#/$defs/${name}` });

const DEFS: Record<string, Schema> = {
  value: {
    description: "a number, or the name of a variable read when the block runs",
    oneOf: [{ type: "number" }, ref("variableName")],
  },
  variableName: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]*$" },
  namedColor: {
    description: "write lower case (the firmware also accepts other cases); black = off",
    enum: [...NAMED_COLORS, "black"],
  },
  color: {
    description: "named colour, #rrggbb or [r, g, b]",
    oneOf: [
      ref("namedColor"),
      { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
      { type: "array", items: { type: "integer", minimum: 0, maximum: 255 }, minItems: 3, maxItems: 3 },
    ],
  },
  target: {
    description: "central, all, peripherals, a pod id (number) or a variable holding it",
    anyOf: [{ enum: [...TARGET_KEYWORDS] }, { type: "number" }, ref("variableName")],
  },
  leds: { type: "array", items: { type: "integer", minimum: 0, maximum: LED_COUNT - 1 } },
  blockName: { type: "string", minLength: 1 },
  storePath: { type: "string", maxLength: MAX_PATH, pattern: "^/prog/[A-Za-z0-9_\\-./]+$" },
  variables: {
    description: "initial values (integers); a program overrides values of its includes",
    type: "object",
    additionalProperties: { type: "integer" },
  },
  menuGroup: {
    type: "object",
    required: ["leds", "color"],
    properties: { leds: ref("leds"), color: ref("color") },
  },
};

function fieldSchema(field: FieldDef): Schema {
  const notes = [
    ...(field.default !== undefined ? [`default: ${JSON.stringify(field.default)}`] : []),
    ...(field.onlyMode !== undefined ? [`only in mode ${field.onlyMode}`] : []),
  ];
  const description = notes.length > 0 ? { description: notes.join("; ") } : {};
  switch (field.kind) {
    case "value":
      return { ...ref("value"), ...description };
    case "color":
      return { ...ref("color"), ...description };
    case "remoteColor":
      return { ...ref("namedColor"), ...description };
    case "leds":
      return { ...ref("leds"), ...description };
    case "target":
      return { ...ref("target"), ...description };
    case "enum":
      return { enum: [...(field.options ?? []), ...(field.aliases ?? [])], ...description };
    case "variable":
      return { ...ref("variableName"), ...description };
    case "metric":
      if (TIMER_FIELDS.includes(field)) {
        const when = field.name === "timerStart" ? "when the block is entered" : "when the block is left, recorded as the metric of that name";
        return { type: "string", minLength: 1, description: `timer name (program format ${field.minFormat}): ${when}` };
      }
      return { type: "string", minLength: 1, description: "measurement metric name" };
    case "bool":
      return { type: "boolean", ...description };
    case "colorPair":
      return { type: "array", items: ref("namedColor"), minItems: 2, maxItems: 2, ...description };
  }
}

function blockSchema(def: (typeof BLOCK_TYPES)[number]): Schema {
  const properties: Schema = {
    [COMMON_FIELDS[0]]: ref("blockName"),
    [COMMON_FIELDS[1]]: { const: def.type },
  };
  for (const field of def.fields) properties[field.name] = fieldSchema(field);
  for (const port of def.ports) properties[port] = { ...ref("blockName"), description: "name of the next block" };
  return {
    title: def.type,
    ...(def.minFormat !== undefined ? { description: `needs program format ${def.minFormat}` } : {}),
    type: "object",
    required: [...COMMON_FIELDS, ...def.fields.filter((f) => f.required).map((f) => f.name)],
    properties,
  };
}

export function buildProgramSchema(): Schema {
  const blocks = Object.fromEntries(BLOCK_TYPES.map((def) => [`block_${def.type}`, blockSchema(def)]));
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://runningjoke.github.io/reactionButton/spec/program.schema.json",
    "x-programFormat": PROGRAM_FORMAT,
    title: "ReactPod program",
    description:
      `ReactPod program file (/prog/*.json), program format ${PROGRAM_FORMAT}. Generated from ` +
      "packages/program-model – do not edit. Structure only: references between blocks, reachability and " +
      "pod limits are checked by the validator (docs/firmware/programs.md). Fragments (include files) use $defs/fragment.",
    type: "object",
    required: ["name"],
    properties: {
      version: { const: PROGRAM_FORMAT_VERSION },
      name: { type: "string", minLength: 1, description: "shown in the menu" },
      description: { type: "string" },
      peripherals: { type: "integer", minimum: 0, maximum: MAX_PERIPHERALS, description: "peripherals the central connects" },
      menu: { type: "array", items: ref("menuGroup"), description: "LED pattern of the program in the menu" },
      variables: ref("variables"),
      include: { type: "array", items: ref("storePath"), description: "fragments loaded first, in order" },
      start: { ...ref("blockName"), description: "first block; default: the first block" },
      blocks: { type: "array", items: ref("block") },
    },
    $defs: {
      ...DEFS,
      block: { oneOf: Object.keys(blocks).map(ref) },
      ...blocks,
      fragment: {
        title: "ReactPod include fragment",
        type: "object",
        properties: {
          description: { type: "string" },
          variables: ref("variables"),
          include: { type: "array", items: ref("storePath") },
          blocks: { type: "array", items: ref("block") },
        },
      },
    },
  };
}
