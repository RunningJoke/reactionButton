/**
 * The game wizard's answers (docs/app/editor-ux.md §4 B). Plain data: `generate.ts` turns them
 * into a program, the wizard page edits them one question per screen.
 */
import { MAX_PERIPHERALS, NAMED_COLORS, type NamedColor } from "@reactpod/program-model";

export type GameId = "solo" | "star" | "random" | "multi" | "duo";
export const GAMES: readonly GameId[] = ["solo", "star", "random", "multi", "duo"];

export type Pause = { kind: "fixed"; ms: number } | { kind: "random"; minMs: number; maxMs: number };
export type OnTimeout = "goOn" | "countMiss" | "endRound";

export type WizardAnswers = {
  game: GameId;
  /** pods besides the central (peripherals) the user has */
  pods: number;
  rounds: number;
  pause: Pause;
  timeLimit: null | { ms: number; onTimeout: OnTimeout };
  /** named colour of the light to hit (pods can show only the named colours) */
  color: string;
  /** red "don't touch" pods per round, multi only (0 = off) */
  redPods: number;
  measure: { record: boolean; countMisses: boolean; results: boolean; falseStart: boolean /* solo */ };
  /** "" = the game's name, filled in by the UI in the user's language */
  name: string;
  /** LEDs of the menu pattern (shown in `color`); undefined = the game's default pattern */
  menuLeds?: number[];
};

/** Limits of the wizard's controls (seconds shown in the UI, ms stored). */
export const LIMITS = {
  rounds: { min: 1, max: 99 },
  pauseMs: { min: 500, max: 30000, step: 500 },
  timeLimitMs: { min: 500, max: 30000, step: 500 },
  redPods: { min: 1, max: MAX_PERIPHERALS },
} as const;

/** Colours the target may have (pods cannot show "off"). */
export const TARGET_COLORS: readonly NamedColor[] = NAMED_COLORS.filter((c) => c !== "off");

const MIN_PODS: Record<GameId, number> = { solo: 0, star: 1, random: 1, multi: 2, duo: 1 };

export function gameNeeds(game: GameId): { minPods: number } {
  return { minPods: MIN_PODS[game] };
}

/** Pods besides the central the generated program uses (its `peripherals`). */
export function podsUsed(a: Pick<WizardAnswers, "game" | "pods">): number {
  if (a.game === "solo") return 0;
  if (a.game === "duo") return 1;
  return clamp(Math.max(a.pods, MIN_PODS[a.game]), 0, MAX_PERIPHERALS);
}

/** The menu pattern a game gets unless the user picks LEDs. */
export function defaultMenuLeds(game: GameId): number[] {
  switch (game) {
    case "solo":
      return [0];
    case "star":
      return [0, 6, 12];
    case "random":
      return [0, 4, 8, 13];
    case "multi":
      return [0, 3, 6, 9, 12, 15];
    case "duo":
      return [0, 9];
  }
}

export function defaultAnswers(game: GameId, pods: number): WizardAnswers {
  const timeLimit = game === "duo" ? { ms: 5000, onTimeout: "countMiss" as const } : null;
  const pause: Pause =
    game === "multi"
      ? { kind: "fixed", ms: 3000 }
      : game === "solo"
        ? { kind: "random", minMs: 1000, maxMs: 3000 }
        : { kind: "random", minMs: 500, maxMs: 2000 };
  return {
    game,
    pods: clamp(Math.trunc(pods), 0, MAX_PERIPHERALS),
    rounds: game === "solo" || game === "duo" ? 10 : 12,
    pause,
    timeLimit,
    color: "green",
    redPods: game === "multi" ? 1 : 0,
    measure: { record: true, countMisses: timeLimit !== null, results: true, falseStart: game === "solo" },
    name: "",
  };
}

/** A new game keeps the pod count, everything else starts from the game's defaults. */
export function withGame(a: WizardAnswers, game: GameId): WizardAnswers {
  return game === a.game ? a : defaultAnswers(game, a.pods);
}

/** Something can be counted as a miss: too slow, a red pod hit, a false start. */
export function canCountMisses(a: WizardAnswers): boolean {
  return a.timeLimit !== null || (a.game === "multi" && a.redPods > 0) || (a.game === "solo" && a.measure.falseStart);
}

/** A timeout is counted as a miss. */
export function countsTimeoutMiss(a: WizardAnswers): boolean {
  return a.timeLimit !== null && (a.timeLimit.onTimeout === "countMiss" || (a.timeLimit.onTimeout === "endRound" && a.measure.countMisses));
}

/** The "Count misses" switch; keeps "If too slow" in step with it. */
export function setCountMisses(a: WizardAnswers, on: boolean): WizardAnswers {
  let timeLimit = a.timeLimit;
  if (timeLimit && on && timeLimit.onTimeout === "goOn") timeLimit = { ...timeLimit, onTimeout: "countMiss" };
  if (timeLimit && !on && timeLimit.onTimeout === "countMiss") timeLimit = { ...timeLimit, onTimeout: "goOn" };
  return { ...a, timeLimit, measure: { ...a.measure, countMisses: on } };
}

/** The "Time limit" switch: on counts misses by default (editor-ux.md §4 B 5). */
export function setTimeLimit(a: WizardAnswers, on: boolean): WizardAnswers {
  if (on === (a.timeLimit !== null)) return a;
  if (!on) return normalizeAnswers({ ...a, timeLimit: null });
  return normalizeAnswers({ ...a, timeLimit: { ms: 2000, onTimeout: "countMiss" }, measure: { ...a.measure, countMisses: true } });
}

/** "If too slow"; choosing "count a miss" turns the miss counter on. */
export function setOnTimeout(a: WizardAnswers, onTimeout: OnTimeout): WizardAnswers {
  if (!a.timeLimit) return a;
  const countMisses = onTimeout === "countMiss" ? true : onTimeout === "goOn" ? false : a.measure.countMisses;
  return normalizeAnswers({ ...a, timeLimit: { ...a.timeLimit, onTimeout }, measure: { ...a.measure, countMisses } });
}

/** Problems that keep the wizard from going on (message keys under `wizard.problems`). */
export function answerProblems(a: WizardAnswers): string[] {
  const problems: string[] = [];
  if (a.pods < MIN_PODS[a.game]) problems.push("notEnoughPods");
  if (a.pause.kind === "random" && a.pause.minMs >= a.pause.maxMs) problems.push("pauseOrder");
  if (a.game === "multi" && a.redPods > 0 && a.color === "red") problems.push("redTarget");
  return problems;
}

/** Clamps every number and drops answers that do not apply to the game. */
export function normalizeAnswers(a: WizardAnswers): WizardAnswers {
  const ms = (v: number, l: { min: number; max: number }) => clamp(Math.round(v), l.min, l.max);
  const pause: Pause =
    a.pause.kind === "fixed"
      ? { kind: "fixed", ms: ms(a.pause.ms, LIMITS.pauseMs) }
      : { kind: "random", minMs: ms(a.pause.minMs, LIMITS.pauseMs), maxMs: ms(a.pause.maxMs, LIMITS.pauseMs) };
  const next: WizardAnswers = {
    ...a,
    pods: clamp(Math.trunc(a.pods), 0, MAX_PERIPHERALS),
    rounds: clamp(Math.trunc(a.rounds), LIMITS.rounds.min, LIMITS.rounds.max),
    pause,
    timeLimit: a.timeLimit && { ...a.timeLimit, ms: ms(a.timeLimit.ms, LIMITS.timeLimitMs) },
    color: (TARGET_COLORS as readonly string[]).includes(a.color) ? a.color : "green",
    redPods: a.game === "multi" ? clamp(Math.trunc(a.redPods), 0, LIMITS.redPods.max) : 0,
    measure: { ...a.measure, falseStart: a.game === "solo" && a.measure.falseStart },
  };
  if (!canCountMisses(next)) next.measure.countMisses = false;
  if (next.timeLimit?.onTimeout === "countMiss") next.measure.countMisses = true;
  return next;
}

function clamp(v: number, min: number, max: number): number {
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min;
}
