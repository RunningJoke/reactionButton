/**
 * Game wizard → program (docs/app/editor-ux.md §4 B). The programs are self-contained (no
 * includes), follow the shipped games (solo, lib/star, lib/random, lib/multi, duo) and keep the
 * answers in variables, so the Adjust sheet can change them later.
 *
 * Two loop forms (decision 2): `repeat` for pods with programFormat ≥ 2, the `lib/loop` counter
 * pattern (`setVariable RUNS +1` → `if RUNS >= ROUNDS`) otherwise.
 */
import type { TFunction } from "i18next";
import type { Block } from "@reactpod/program-model";
import type { ProgramJson } from "../editor/ops";
import {
  allAtOnce,
  centralPress,
  chain,
  connect,
  decide,
  falseStartPause,
  light,
  pause,
  pickPod,
  podPress,
  resetAll,
  results,
  setVariable,
  MISSES,
  type Fragment,
  type TimeLimit,
} from "../programs/recipes/fragments";
import { canCountMisses, countsTimeoutMiss, defaultMenuLeds, podsUsed, type WizardAnswers } from "./answers";

export type LoopForm = "repeat" | "counter";

/** The `repeat` block needs programFormat 2; unknown (no pod, old firmware) → the counter pattern. */
export function loopFormFor(programFormat: number | undefined): LoopForm {
  return (programFormat ?? 1) >= 2 ? "repeat" : "counter";
}

/** Variable names the generator writes (also known to settingLabels.ts). */
export const VARS = {
  rounds: "ROUNDS",
  runs: "RUNS",
  pause: "PAUSE_MS",
  pauseMin: "PAUSE_MIN_MS",
  pauseMax: "PAUSE_MAX_MS",
  timeLimit: "TIME_LIMIT_MS",
  redPods: "RED_PODS",
  misses: MISSES,
  pod: "SELECTED_POD",
} as const;

/** Block names of the loop (counter form: the names of lib/loop.json). */
export const LOOP = { counter: "StartLoop", check: "EndLoop", repeat: "Rounds", finish: "StartReset" } as const;

const FINISH_MS = 3000;

export function generateProgram(a: WizardAnswers, form: LoopForm): ProgramJson {
  const variables: Record<string, number> = { [VARS.rounds]: a.rounds, [VARS.runs]: 0 };
  if (a.pause.kind === "fixed") variables[VARS.pause] = a.pause.ms;
  else Object.assign(variables, { [VARS.pauseMin]: a.pause.minMs, [VARS.pauseMax]: a.pause.maxMs });
  if (a.timeLimit) variables[VARS.timeLimit] = a.timeLimit.ms;
  if (a.game === "multi" && a.redPods > 0) variables[VARS.redPods] = a.redPods;
  const countMisses = a.measure.countMisses && canCountMisses(a);
  if (countMisses || countsTimeoutMiss(a)) variables[VARS.misses] = 0;
  if (a.game === "star" || a.game === "random") variables[VARS.pod] = 0;

  const round = roundOf(a, countMisses);
  const head = form === "repeat" ? LOOP.repeat : LOOP.counter;
  const back = form === "repeat" ? LOOP.repeat : LOOP.check;

  const blocks: Block[] = [];
  if (form === "repeat") {
    blocks.push({ name: LOOP.repeat, type: "repeat", count: VARS.rounds, storeIndex: VARS.runs, body: round.entry, done: LOOP.finish });
  } else {
    blocks.push({ name: LOOP.counter, type: "setVariable", var: VARS.runs, op: "+", value: 1, next: round.entry });
  }

  const roundBlocks = round.blocks;
  connect(roundBlocks, round.exits, back);
  const ends = round.roundEnds ?? [];
  if (ends.length && a.game !== "solo") {
    // an early end may leave the central lit (time limit on the central's press)
    const off = light("EndRound", "off");
    connect(roundBlocks, ends, off.entry);
    roundBlocks.push({ ...off.blocks[0]!, next: back });
  } else {
    connect(roundBlocks, ends, back);
  }
  blocks.push(...roundBlocks);

  if (form === "counter") {
    blocks.push({ name: LOOP.check, type: "if", left: VARS.runs, op: ">=", right: VARS.rounds, true: LOOP.finish, false: LOOP.counter });
  }

  const finish = chain(
    light(LOOP.finish, "blue"),
    ...(a.measure.record && a.measure.results ? [results("Summary")] : []),
    pause("ResetDelay", { ms: FINISH_MS }),
    light("ClearLED", "off"),
    ...(form === "counter" ? [setVariable("ResetRuns", VARS.runs, "=", 0)] : []),
    ...(VARS.misses in variables ? [setVariable("ResetMisses", VARS.misses, "=", 0)] : []),
  );
  connect(finish.blocks, finish.exits, head);
  blocks.push(...finish.blocks);

  return {
    version: 1,
    name: a.name.trim() || a.game,
    peripherals: podsUsed(a),
    menu: [{ leds: a.menuLeds?.length ? [...a.menuLeds] : defaultMenuLeds(a.game), color: a.color }],
    variables,
    start: head,
    blocks,
  };
}

/** The steps of one round. Its exits end the round normally, `roundEnds` early. */
function roundOf(a: WizardAnswers, countMisses: boolean): Fragment {
  const record = a.measure.record;
  const color = a.color;
  const time = a.pause.kind === "fixed" ? { ms: VARS.pause } : { minMs: VARS.pauseMin, maxMs: VARS.pauseMax };
  const limit = (): TimeLimit | null =>
    a.timeLimit && {
      ms: VARS.timeLimit,
      // pods of "all at once" stay lit until they are reset, so that game always goes on to the reset
      onTimeout: a.game === "multi" && a.timeLimit.onTimeout === "endRound" ? (countsTimeoutMiss(a) ? "countMiss" : "goOn") : a.timeLimit.onTimeout,
      countMiss: countsTimeoutMiss(a),
    };
  const central = () => chain(light("CentralOn", color), centralPress("CentralPress", { record, timeLimit: limit() }), light("CentralOff", "off"));

  switch (a.game) {
    case "solo":
      return chain(
        light("Ready", "blue"),
        a.measure.falseStart ? falseStartPause("Wait", time, { countMiss: countMisses }) : pause("Wait", time),
        light("Go", color),
        centralPress("Press", { record, timeLimit: limit() }),
      );
    case "star":
      return chain(
        pause("Pause", time),
        central(),
        pickPod("SelectPod", VARS.pod, "random", "REQUIRED_PERIPHERALS"),
        podPress("PodTarget", { pod: VARS.pod, color, record, timeLimit: limit() }),
      );
    case "random":
      return chain(
        pause("Pause", time),
        pickPod("SelectPod", VARS.pod, "randomOther", "NODE_COUNT"),
        decide("IsCentral", VARS.pod, "==", "REQUIRED_PERIPHERALS", central(), podPress("PodTarget", { pod: VARS.pod, color, record, timeLimit: limit() })),
      );
    case "multi":
      return chain(
        pause("Pause", time),
        allAtOnce("AllAtOnce", {
          color,
          pods: "REQUIRED_PERIPHERALS",
          red: a.redPods > 0 ? { count: VARS.redPods, countMiss: countMisses } : null,
          record,
          timeLimit: limit(),
        }),
        resetAll("ResetAll"),
      );
    case "duo":
      return chain(pause("Pause", time), central(), pause("PodPause", time), podPress("PodTarget", { pod: 0, color, record, timeLimit: limit() }));
  }
}

/* ------------------------------------------------------------------ story */

export type Story = { intro: string; steps: string[]; outro: string[] };

/** The program as a short story for the Ready screen. */
export function storyOf(a: WizardAnswers, t: TFunction): Story {
  const nf = new Intl.NumberFormat(t("wizard.numberLocale"), { maximumFractionDigits: 1 });
  const s = (ms: number) => nf.format(ms / 1000);
  const color = t(`colors.${a.color}`);
  const pauseText =
    a.pause.kind === "fixed" ? t("wizard.story.pauseFixed", { s: s(a.pause.ms) }) : t("wizard.story.pauseRandom", { min: s(a.pause.minMs), max: s(a.pause.maxMs) });
  const limit = a.timeLimit ? t("wizard.story.limit", { s: s(a.timeLimit.ms) }) : "";
  const tooSlow = a.timeLimit
    ? t(
        a.timeLimit.onTimeout === "endRound" && a.game === "multi"
          ? countsTimeoutMiss(a)
            ? "wizard.story.tooSlow.countMiss"
            : "wizard.story.tooSlow.goOn"
          : a.timeLimit.onTimeout === "endRound" && countsTimeoutMiss(a)
            ? "wizard.story.tooSlow.endRoundMiss"
            : `wizard.story.tooSlow.${a.timeLimit.onTimeout}`,
      )
    : null;
  const countMisses = a.measure.countMisses && canCountMisses(a);
  const pressCentral = t("wizard.story.pressCentral") + limit;
  const steps: string[] = [];
  switch (a.game) {
    case "solo":
      steps.push(t("wizard.story.ready"));
      steps.push(a.measure.falseStart ? t("wizard.story.falseStart", { pause: pauseText }) + (countMisses ? t("wizard.story.andMiss") : "") : pauseText);
      steps.push(t("wizard.story.lightCentral", { color }));
      steps.push(pressCentral);
      break;
    case "star":
      steps.push(pauseText, t("wizard.story.lightCentral", { color }), pressCentral, t("wizard.story.podRandom", { color }) + limit);
      break;
    case "random":
      steps.push(pauseText, t("wizard.story.podRandomOther", { color }) + limit);
      break;
    case "multi":
      steps.push(pauseText);
      steps.push(
        t("wizard.story.allAtOnce", { count: podsUsed(a) + 1 }) +
          (a.redPods > 0 ? t("wizard.story.redPods", { count: a.redPods }) : "") +
          t("wizard.story.untilPressed", { color }) +
          limit,
      );
      if (a.redPods > 0) steps.push(t("wizard.story.redHit") + (countMisses ? t("wizard.story.andMiss") : ""));
      steps.push(t("wizard.story.allOff"));
      break;
    case "duo":
      steps.push(pauseText, t("wizard.story.lightCentral", { color }), pressCentral, pauseText, t("wizard.story.podDuo", { color }) + limit);
      break;
  }
  if (tooSlow) steps.push(tooSlow);
  const outro: string[] = [];
  if (a.measure.record) outro.push(t("wizard.story.record"));
  if (countMisses || countsTimeoutMiss(a)) outro.push(t("wizard.story.misses"));
  outro.push(a.measure.record && a.measure.results ? t("wizard.story.endResults") : t("wizard.story.endPlain"));
  return { intro: t("wizard.story.rounds", { count: a.rounds }), steps, outro };
}

/** Ready-screen story as one text. */
export function describeAnswers(a: WizardAnswers, t: TFunction): string {
  const story = storyOf(a, t);
  return [story.intro, ...story.steps.map((step, i) => `${i + 1}. ${step}.`), ...story.outro].join(" ");
}
