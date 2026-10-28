/**
 * Block types the app knows (docs/firmware/programs.md §2). This is the app's own copy, kept separate
 * from the firmware on purpose: a new block type always needs a firmware update and an app update.
 * `info.blockTypes` of the connected pod says which of these it can run.
 */

export type FieldKind =
  | "value" /** number or variable name */
  | "color" /** any colour (central LEDs) */
  | "remoteColor" /** named colour only (sent to peripherals) */
  | "leds" /** list of LED indices 0..17 */
  | "target" /** "central", "all", "peripherals", a pod id or a variable (programFormat 3) */
  | "enum"
  | "variable" /** name of a variable that is written */
  | "metric" /** name of a measurement metric */
  | "bool"
  | "colorPair"; /** exactly two named colours (toggle `colors`, programFormat 4) */

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
  /** where the step sheet shows the field (docs/app/editor-ux.md §5); default "essential" */
  level?: FieldLevel;
  /** the feature switch that reveals the field (level "switch") */
  group?: SwitchId;
  /** program format revision that introduced the field (programs.md §6); default 1 */
  minFormat?: number;
  /**
   * true: a pod with an older program format rejects the program (validator error `fieldFormatTooOld`)
   * instead of ignoring the field (warning `fieldNeedsFormat`)
   */
  rejectedByOlder?: boolean;
  /**
   * The field only applies in this mode of the block (`BlockTypeDef.modes`); in another mode the
   * validator reports `fieldWrongMode`. Fields without it apply in every mode.
   */
  onlyMode?: string;
};

/**
 * Where a field shows in the step sheet (docs/app/editor-ux.md §5): essential in the sheet, switch
 * behind its feature switch (`group`), more under "More options", expert only in expert mode.
 */
export type FieldLevel = "essential" | "switch" | "more" | "expert";

/** Feature switches of the step sheet (editor-ux.md §4 D). */
export type SwitchId = "randomPause" | "timeLimit" | "record" | "longPress" | "avoid" | "falseStart";

/** What a port means, in words (editor-ux.md §5 "Port names"); the app translates `portRoles.<role>`. */
export type PortRole =
  | "then"
  | "ifTooSlow"
  | "ifLeftAlone"
  | "shortPress"
  | "longPress"
  | "ifRedHit"
  | "ifYes"
  | "ifNo"
  | "eachRound"
  | "afterLast"
  | "ifReleasedEarly" /** charge: released before the onset */
  | "ifFull" /** charge: full charge reached */
  | "ifNoHold" /** release: nobody held the pod */
  | "ifFalseStart" /** release (signal): released before the switch */
  | "ifAllA" /** toggle: every pod has team A */
  | "ifAllB" /** toggle: every pod has team B */
  | "whenTimeOver"; /** toggle: the game time is over */

export type BlockCategory = "light" | "wait" | "input" | "logic" | "remote" | "stats";

export type BlockTypeDef = {
  type: string;
  category: BlockCategory;
  /** output ports in firmware order; port 0 is the fallback when it is "next" */
  ports: readonly string[];
  fields: readonly FieldDef[];
  /** true if the block can wait (does not finish in the same loop pass) */
  waits: boolean;
  /** port → its meaning in words; use `portRole()`, which also handles block-dependent roles */
  portRoles?: Partial<Record<string, PortRole>>;
  /** program format revision that introduced the block type (programs.md §6); default 1 */
  minFormat?: number;
  /** blocks with modes: the enum field that selects the mode and the mode that applies when it is missing */
  modes?: { field: string; default: string };
  /** port → the only mode it exists in (other modes: validator error `fieldWrongMode`) */
  portOnlyMode?: Partial<Record<string, string>>;
};

/**
 * `timerStart` / `timerStop`: fields of every block type (programFormat 2, programs.md §2 "Timers",
 * §7.9). The value is a timer name; `timerStop` records the time as the metric of that name.
 */
export const TIMER_FIELDS: readonly FieldDef[] = [
  { name: "timerStart", kind: "metric", level: "more", minFormat: 2 },
  { name: "timerStop", kind: "metric", level: "more", minFormat: 2 },
];

/** Different timer names a program (with its includes) may use (BlockManager::MAX_TIMERS). */
export const MAX_TIMERS = 16;

/** Values of a `target` field besides a pod id (effect `target`, delay `countdownTarget`). */
export const TARGET_KEYWORDS = ["central", "all", "peripherals"] as const;

/** `effect` of the effect block (programs.md §2, programFormat 3). */
export const EFFECTS = ["solid", "fill", "drain", "dim", "colorShift", "trafficLight", "blink", "pulse", "spin", "off"] as const;
/** Effects that repeat every `periodMs` (endless without a `durationMs` > 0). */
export const PERIODIC_EFFECTS: readonly string[] = ["blink", "pulse", "spin"];

/** `countdown` of timed blocks; "secret" shows nothing (= before format 3). */
export const COUNTDOWNS = ["secret", "drain", "fill", "dim", "colorShift", "trafficLight"] as const;

/**
 * Countdown over the time limit of a block (programFormat 3, issue #56). "delay": always has a time
 * limit and alone has `countdownTarget` (which pods show it). "timeout": the fields sit behind the
 * time-limit switch of blocks with `timeoutMs`.
 */
function countdownFields(kind: "delay" | "timeout" | "game", from = false): readonly FieldDef[] {
  const level: Pick<FieldDef, "level" | "group"> = kind === "timeout" ? { level: "switch", group: "timeLimit" } : { level: "more" };
  return [
    { name: "countdown", kind: "enum", options: COUNTDOWNS, default: "secret", ...level, minFormat: 3, rejectedByOlder: true },
    { name: "countdownColor", kind: "remoteColor", default: "red", level: "more", minFormat: 3, rejectedByOlder: true },
    // delay and button have no lit colour of their own: the countdown starts with this one
    ...(from
      ? ([{ name: "countdownFrom", kind: "remoteColor", default: "green", level: "more", minFormat: 3, rejectedByOlder: true }] as const)
      : []),
    ...(kind === "delay"
      ? ([{ name: "countdownTarget", kind: "target", default: "central", level: "more", minFormat: 3, rejectedByOlder: true }] as const)
      : []),
  ];
}

/** `start` of the toggle block (programs.md §2, programFormat 4). */
export const TOGGLE_STARTS = ["alternate", "a", "b", "random", "off"] as const;
/** The variables a toggle block can write at the end. */
export const TOGGLE_STORES = ["storeA", "storeB", "storeTimeA", "storeTimeB", "storeFlips"] as const;

/** Block types with a time limit besides `delay`, which always has one. */
export const TIMEOUT_TYPES = ["button", "remotePress", "remoteMultiPress", "charge", "release"] as const;

/** `style` and `mode` of the charge block, `mode` of the release block (programs.md §2, programFormat 3). */
export const CHARGE_STYLES = ["fill", "brightness", "trafficLight", "colorShift"] as const;
export const CHARGE_MODES = ["release", "accumulate"] as const;
export const RELEASE_MODES = ["trigger", "signal"] as const;

/**
 * The block fields that give a block its time limit, as alternatives: the limit exists when every
 * field of one alternative is set. Empty for blocks without a time limit (delay always has one).
 * `mode` is the block's mode (undefined: the default mode).
 */
export function timeLimitFields(type: string, mode?: unknown): readonly (readonly string[])[] {
  switch (type) {
    case "button":
    case "charge":
      return [["timeoutMs"], ["minTimeoutMs", "maxTimeoutMs"]];
    case "remotePress":
    case "remoteMultiPress":
      return [["timeoutMs"]];
    case "release":
      return mode === "signal" ? [["timeoutMs"]] : [["maxHoldMs"]];
    default:
      return [];
  }
}

const withTimers = (fields: readonly FieldDef[]): readonly FieldDef[] => [...fields, ...TIMER_FIELDS];

export const IF_OPS = ["==", "!=", ">", "<", ">=", "<="] as const;
export const SET_OPS = ["=", "+", "-", "random", "randomOther"] as const;

export const BLOCK_TYPES: readonly BlockTypeDef[] = [
  {
    type: "led",
    category: "light",
    ports: ["next"],
    portRoles: { next: "then" },
    waits: false,
    fields: withTimers([
      { name: "color", kind: "color", required: true },
      { name: "leds", kind: "leds" },
    ]),
  },
  {
    type: "delay",
    category: "wait",
    ports: ["next"],
    portRoles: { next: "then" },
    waits: true,
    fields: withTimers([
      { name: "ms", kind: "value" },
      { name: "minMs", kind: "value" },
      { name: "maxMs", kind: "value" },
      ...countdownFields("delay", true),
    ]),
  },
  {
    type: "button",
    category: "input",
    ports: ["next", "short", "long", "pressed", "timeout"],
    portRoles: { next: "then", pressed: "then", timeout: "ifTooSlow", short: "shortPress", long: "longPress" },
    waits: true,
    fields: withTimers([
      { name: "shortMs", kind: "value", default: 1000, level: "switch", group: "longPress" },
      { name: "timeoutMs", kind: "value", level: "switch", group: "timeLimit" },
      { name: "minTimeoutMs", kind: "value", level: "switch", group: "timeLimit" },
      { name: "maxTimeoutMs", kind: "value", level: "switch", group: "timeLimit" },
      ...countdownFields("timeout", true),
      { name: "record", kind: "metric", level: "switch", group: "record" },
      { name: "storeAs", kind: "variable", level: "more" },
    ]),
  },
  {
    type: "if",
    category: "logic",
    ports: ["true", "false"],
    portRoles: { true: "ifYes", false: "ifNo" },
    waits: false,
    fields: withTimers([
      { name: "left", kind: "value", required: true },
      { name: "op", kind: "enum", options: IF_OPS, aliases: ["=", "!"], default: "==" },
      { name: "right", kind: "value", required: true },
    ]),
  },
  {
    type: "setVariable",
    category: "logic",
    ports: ["next"],
    portRoles: { next: "then" },
    waits: false,
    fields: withTimers([
      { name: "var", kind: "variable", required: true },
      { name: "op", kind: "enum", options: SET_OPS, aliases: ["set", "add", "sub", "?", "!"], default: "=" },
      { name: "value", kind: "value", required: true },
    ]),
  },
  {
    type: "remotePress",
    category: "remote",
    ports: ["next", "timeout"],
    portRoles: { next: "then", timeout: "ifTooSlow" },
    waits: true,
    fields: withTimers([
      { name: "pod", kind: "value", required: true },
      { name: "mode", kind: "enum", options: ["hit", "avoid"], default: "hit", level: "switch", group: "avoid" },
      { name: "color", kind: "remoteColor" },
      { name: "colorAfter", kind: "remoteColor", default: "off", level: "more" },
      { name: "timeoutMs", kind: "value", level: "switch", group: "timeLimit" },
      ...countdownFields("timeout"),
      { name: "record", kind: "metric", level: "switch", group: "record" },
      { name: "storeAs", kind: "variable", level: "more" },
    ]),
  },
  {
    type: "remoteMultiPress",
    category: "remote",
    ports: ["next", "avoidHit", "timeout"],
    portRoles: { next: "then", avoidHit: "ifRedHit", timeout: "ifTooSlow" },
    waits: true,
    fields: withTimers([
      { name: "pods", kind: "value" },
      { name: "avoid", kind: "value", default: 0, level: "switch", group: "avoid" },
      { name: "includeCentral", kind: "bool", default: true, level: "more" },
      { name: "hitColor", kind: "remoteColor", default: "green" },
      { name: "avoidColor", kind: "remoteColor", default: "red", level: "switch", group: "avoid" },
      { name: "syncStartMs", kind: "value", default: 20, level: "more" },
      { name: "timeoutMs", kind: "value", level: "switch", group: "timeLimit" },
      ...countdownFields("timeout"),
      { name: "record", kind: "metric", level: "switch", group: "record" },
    ]),
  },
  {
    type: "remoteResetAll",
    category: "remote",
    ports: ["next"],
    portRoles: { next: "then" },
    waits: false,
    fields: withTimers([
      { name: "pods", kind: "value", level: "more" },
      { name: "ledsOff", kind: "bool", default: true, level: "more" },
    ]),
  },
  {
    type: "summary",
    category: "stats",
    ports: ["next"],
    portRoles: { next: "then" },
    waits: false,
    fields: withTimers([
      { name: "metric", kind: "metric", required: true, level: "expert" },
      { name: "storeAverage", kind: "variable" },
      { name: "storeBest", kind: "variable" },
      { name: "storeWorst", kind: "variable" },
      { name: "storeCount", kind: "variable" },
      { name: "reset", kind: "bool", default: true, level: "more" },
    ]),
  },
  {
    type: "repeat",
    category: "logic",
    ports: ["next", "body", "done"],
    portRoles: { next: "then", body: "eachRound", done: "afterLast" },
    waits: false,
    minFormat: 2,
    fields: withTimers([
      { name: "count", kind: "value", required: true },
      { name: "storeIndex", kind: "variable", level: "more" },
    ]),
  },
  {
    type: "effect",
    category: "light",
    ports: ["next"],
    portRoles: { next: "then" },
    waits: true,
    minFormat: 3,
    fields: withTimers([
      { name: "target", kind: "target", default: "central" },
      { name: "effect", kind: "enum", options: EFFECTS, required: true },
      { name: "color", kind: "remoteColor", default: "white" },
      { name: "color2", kind: "remoteColor", default: "off", level: "more" },
      { name: "durationMs", kind: "value" },
      { name: "periodMs", kind: "value", default: 500, level: "more" },
      { name: "brightness", kind: "value", default: 255, level: "more" },
      { name: "leds", kind: "leds", level: "more" },
      { name: "syncStartMs", kind: "value", default: 20, level: "more" },
      { name: "wait", kind: "bool", default: false },
    ]),
  },
  {
    // hold to charge (issue #57); the ring shows the charge, releasing ends the block (mode release)
    type: "charge",
    category: "input",
    ports: ["next", "released", "early", "full", "timeout"],
    portRoles: { next: "then", released: "then", early: "ifReleasedEarly", full: "ifFull", timeout: "ifTooSlow" },
    waits: true,
    minFormat: 3,
    modes: { field: "mode", default: "release" },
    fields: withTimers([
      { name: "pod", kind: "target", default: "central" },
      { name: "maxMs", kind: "value", required: true },
      { name: "style", kind: "enum", options: CHARGE_STYLES, default: "fill" },
      { name: "color", kind: "remoteColor", default: "green" },
      { name: "color2", kind: "remoteColor", default: "red", level: "more" }, // colorShift only
      { name: "onsetMs", kind: "value", default: 0, level: "more" },
      { name: "mode", kind: "enum", options: CHARGE_MODES, default: "release", level: "more" },
      { name: "decayMs", kind: "value", default: 0, level: "more", onlyMode: "accumulate" },
      { name: "timeoutMs", kind: "value", level: "switch", group: "timeLimit" },
      { name: "minTimeoutMs", kind: "value", level: "switch", group: "timeLimit" },
      { name: "maxTimeoutMs", kind: "value", level: "switch", group: "timeLimit" },
      ...countdownFields("timeout"),
      { name: "record", kind: "metric", level: "switch", group: "record" },
      { name: "storeAs", kind: "variable", level: "more" },
      { name: "storePercent", kind: "variable", level: "more" },
    ]),
  },
  {
    // pods flip between two team colours on every press (issue #59, "domination")
    type: "toggle",
    category: "remote",
    ports: ["next", "allA", "allB"],
    portRoles: { next: "whenTimeOver", allA: "ifAllA", allB: "ifAllB" },
    waits: true,
    minFormat: 4,
    fields: withTimers([
      { name: "colors", kind: "colorPair", default: ["red", "blue"] },
      { name: "durationMs", kind: "value" },
      { name: "minDurationMs", kind: "value" },
      { name: "maxDurationMs", kind: "value" },
      { name: "start", kind: "enum", options: TOGGLE_STARTS, default: "alternate" },
      { name: "cooldownMs", kind: "value", default: 300 },
      { name: "pods", kind: "value", level: "more" },
      { name: "includeCentral", kind: "bool", default: true, level: "more" },
      { name: "syncStartMs", kind: "value", default: 20, level: "more" },
      ...countdownFields("game"),
      { name: "storeA", kind: "variable", level: "more" },
      { name: "storeB", kind: "variable", level: "more" },
      { name: "storeTimeA", kind: "variable", level: "more" },
      { name: "storeTimeB", kind: "variable", level: "more" },
      { name: "storeFlips", kind: "variable", level: "more" },
    ]),
  },
  {
    // release as trigger, or release on a colour switch (issue #58)
    type: "release",
    category: "input",
    ports: ["next", "noHold", "falseStart", "timeout"],
    portRoles: { next: "then", noHold: "ifNoHold", falseStart: "ifFalseStart", timeout: "ifTooSlow" },
    portOnlyMode: { falseStart: "signal" },
    waits: true,
    minFormat: 3,
    modes: { field: "mode", default: "trigger" },
    fields: withTimers([
      { name: "mode", kind: "enum", options: RELEASE_MODES, default: "trigger" },
      { name: "pod", kind: "target", default: "central" },
      { name: "holdColor", kind: "remoteColor", default: "yellow" },
      { name: "goColor", kind: "remoteColor", default: "green", onlyMode: "signal" },
      { name: "goMs", kind: "value", onlyMode: "signal" },
      { name: "minGoMs", kind: "value", onlyMode: "signal" },
      { name: "maxGoMs", kind: "value", onlyMode: "signal" },
      { name: "heldColor", kind: "remoteColor", level: "more" }, // default: holdColor
      { name: "allowHeld", kind: "bool", level: "more" }, // default: true in trigger mode, false in signal mode
      { name: "holdTimeoutMs", kind: "value", level: "more" },
      { name: "maxHoldMs", kind: "value", level: "switch", group: "timeLimit", onlyMode: "trigger" },
      { name: "timeoutMs", kind: "value", level: "switch", group: "timeLimit", onlyMode: "signal" },
      ...countdownFields("timeout"),
      { name: "record", kind: "metric", level: "switch", group: "record", onlyMode: "signal" },
      { name: "storeAs", kind: "variable", level: "more" },
    ]),
  },
];

const BY_TYPE = new Map(BLOCK_TYPES.map((def) => [def.type, def]));

export function blockType(type: unknown): BlockTypeDef | undefined {
  return typeof type === "string" ? BY_TYPE.get(type) : undefined;
}

/** The level of a field, "essential" when the definition does not say. */
export function fieldLevel(field: FieldDef): FieldLevel {
  return field.level ?? "essential";
}

/**
 * What a port of a block means. Like `portRoles`, but per block: the time-out of a remotePress
 * in avoid mode means the pod was left alone, not that the player was too slow.
 */
export function portRole(block: { type?: unknown; mode?: unknown }, port: string): PortRole | undefined {
  const role = blockType(block.type)?.portRoles?.[port];
  return role === "ifTooSlow" && block.type === "remotePress" && block.mode === "avoid" ? "ifLeftAlone" : role;
}

/** Block fields that are neither ports nor parameters. */
export const COMMON_FIELDS = ["name", "type"] as const;

/** The format revision a block needs: its type's, or a newer one for the fields it uses. */
export function blockFormatOf(block: unknown): number {
  if (typeof block !== "object" || block === null || Array.isArray(block)) return 1;
  const raw = block as Record<string, unknown>;
  const def = blockType(raw.type);
  let format = def?.minFormat ?? 1;
  for (const field of def?.fields ?? TIMER_FIELDS) {
    if (raw[field.name] !== undefined) format = Math.max(format, field.minFormat ?? 1);
  }
  return format;
}

/**
 * The smallest program format revision (programs.md §6) a pod needs to run the program: 1 to 4.
 * Takes a program or fragment file (its own `blocks`), or a resolved program (`blocks` of
 * `{ file, block }`, includes too). Anything else needs revision 1.
 */
export function programFormatOf(program: unknown): number {
  if (typeof program !== "object" || program === null) return 1;
  const blocks = (program as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return 1;
  let format = 1;
  for (const entry of blocks) {
    const resolved = typeof entry === "object" && entry !== null && "file" in entry && "block" in entry;
    format = Math.max(format, blockFormatOf(resolved ? (entry as { block: unknown }).block : entry));
  }
  return format;
}
