/**
 * Labels and units for program variables ("settings"), editor-ux.md §4 F and decision 1: the
 * names stay in the program file, the app shows them in words. Times (`…_MS`) are shown in
 * seconds. Unknown names are shown as they are.
 */
import type { TFunction } from "i18next";

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
