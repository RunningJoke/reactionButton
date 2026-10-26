/**
 * Labels and units for program variables ("settings"), editor-ux.md §4 F and decision 1: the
 * names stay in the program file, the app shows them in words. Times (`…_MS`) are shown in
 * seconds. Unknown names are shown as they are.
 */
import type { TFunction } from "i18next";
import { blockType, BUILTIN_VARIABLES, isObject } from "@reactpod/program-model";

export type SettingUnit = "s" | "count" | null;

export type SettingLabel = {
  label: string;
  unit: SettingUnit;
  /** stored value → shown value (ms → s) */
  toDisplay(v: number): number;
  /** shown value → stored value (s → whole ms) */
  fromDisplay(v: number): number;
};

/** variable name → key under `settingLabels` and unit */
const KNOWN: Record<string, { key: string; unit: SettingUnit }> = {
  ROUNDS: { key: "rounds", unit: "count" },
  MAX_LOOPS: { key: "rounds", unit: "count" },
  RUNS: { key: "runs", unit: "count" },
  PAUSE_MS: { key: "pause", unit: "s" },
  PAUSE_MIN_MS: { key: "pauseMin", unit: "s" },
  PAUSE_MAX_MS: { key: "pauseMax", unit: "s" },
  TIME_LIMIT_MS: { key: "timeLimit", unit: "s" },
  RED_PODS: { key: "redPods", unit: "count" },
  AVOID_COUNT: { key: "redPods", unit: "count" },
  MISSES: { key: "misses", unit: "count" },
  SELECTED_POD: { key: "selectedPod", unit: null },
  SELECTED_BUZZER: { key: "selectedPod", unit: null },
  AVG_REACTION: { key: "avgReaction", unit: "s" },
  BEST_REACTION: { key: "bestReaction", unit: "s" },
  LAST_REACTION: { key: "lastReaction", unit: "s" },
  REQUIRED_PERIPHERALS: { key: "requiredPeripherals", unit: "count" },
  NODE_COUNT: { key: "nodeCount", unit: "count" },
};

const identity = (v: number) => v;
const msToS = (v: number) => v / 1000;
const sToMs = (v: number) => Math.round(v * 1000);

/** Is `name` a time in ms (shown in seconds)? */
export function isMsSetting(name: string): boolean {
  return KNOWN[name]?.unit === "s" || /_MS$/.test(name);
}

export function settingLabel(name: string, t: TFunction): SettingLabel {
  const known = KNOWN[name];
  const unit: SettingUnit = known ? known.unit : /_MS$/.test(name) ? "s" : null;
  const seconds = unit === "s";
  return {
    label: known ? t(`settingLabels.${known.key}`) : name,
    unit,
    toDisplay: seconds ? msToS : identity,
    fromDisplay: seconds ? sToMs : identity,
  };
}

/** Variables a block writes (`setVariable.var`, `storeAs`, `storeIndex`, `summary.store…`). */
export function writtenVariables(blocks: readonly unknown[]): Set<string> {
  const written = new Set<string>();
  for (const block of blocks) {
    if (!isObject(block) || typeof block.type !== "string") continue;
    for (const field of blockType(block.type)?.fields ?? []) {
      const v = block[field.name];
      if (field.kind === "variable" && typeof v === "string") written.add(v);
    }
  }
  return written;
}

/**
 * The settings a coach can tweak (editor-ux.md §3.5, §4 F): the program's start values that no
 * block changes while it runs. Built-ins and counters (round counter, misses, the selected pod,
 * stored results) are left out; expert mode shows them in the raw table.
 */
export function tweakableSettings(variables: Readonly<Record<string, unknown>>, blocks: readonly unknown[]): string[] {
  const written = writtenVariables(blocks);
  return Object.keys(variables).filter(
    (name) => typeof variables[name] === "number" && !written.has(name) && !(BUILTIN_VARIABLES as readonly string[]).includes(name),
  );
}

export type SettingRange = { min: number; max: number; step: number };

/** Stepper range of a setting, in stored units (ms for times). `peripherals` limits red pods. */
export function settingRange(name: string, peripherals: number): SettingRange {
  const key = KNOWN[name]?.key;
  if (isMsSetting(name)) return { min: 0, max: 60000, step: 500 };
  if (key === "rounds") return { min: 1, max: 999, step: 1 };
  if (key === "redPods") return { min: 0, max: Math.max(0, peripherals), step: 1 };
  return { min: 0, max: 9999, step: 1 };
}

/** One stepper press from `value`; values off the grid snap to it (800 ms + → 1000, − → 500). */
export function stepSetting(value: number, range: SettingRange, direction: 1 | -1): number {
  const { min, max, step } = range;
  const onGrid = Math.abs(value / step - Math.round(value / step)) < 1e-9;
  const next = onGrid ? Math.round(value / step) * step + direction * step : direction > 0 ? Math.ceil(value / step) * step : Math.floor(value / step) * step;
  return Math.min(max, Math.max(min, next));
}
