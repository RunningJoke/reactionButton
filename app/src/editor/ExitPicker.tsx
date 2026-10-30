/**
 * The exit picker (issue #88 §4): one second page of the step sheet for every exit of a step. A radio list:
 * next step, count a miss (failure exits), next round / leave the loop (inside a Repeat), a step (named by
 * number and sentence, instant loops greyed out with the reason) and a new step. `ExitRow` is the row that opens it.
 */
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { Block } from "@reactpod/program-model";
import { exitChoices, exitValue, instantLoop, loopOf, naturalNext, setExit, type ExitChoice, type ExitValue } from "./exits";
import type { ProgramJson } from "./ops";
import { stepSentence, type SentenceOptions } from "./sentence";
import { entryOf, portRole, type Step } from "./structure";
import type { Apply } from "./sheetParts";
import styles from "./StepSheet.module.css";

/** What the exit rows and the picker need to know about the program. */
export type ExitEnv = {
  doc: ProgramJson;
  steps: readonly Step[];
  /** every block of the program and its includes */
  blocks: ReadonlyMap<string, Block>;
  sentence: SentenceOptions;
  apply: Apply;
  /** opens the picker page for this exit */
  open: (port: string) => void;
  /** "a new step here…": the editor's Add a step, connected to this exit */
  addConnected: (from: string, port: string) => void;
};

/** "If too slow", "Then", ...: the exit's words (editor-ux.md §5 "Port names"); the row adds the arrow. */
export function exitLabel(block: Block, port: string, t: TFunction): string {
  return t(`editor.exit.role.${portRole(block, port)}`, { defaultValue: t(`editor.step.role.${portRole(block, port)}`, { defaultValue: port }) });
}

/** A step as the picker names it: "Step 3 · Wait for a press ...". */
export function stepLabel(env: ExitEnv, name: string, t: TFunction): string {
  const step = env.steps.find((s) => s.block === name && !s.loop);
  const block = env.blocks.get(name);
  if (step && block) return `${t("editor.exit.stepN", { n: step.number })} · ${stepSentence(block, t, env.sentence)}`;
  if (env.steps.some((s) => s.loop?.hidden.includes(name))) return t("editor.exit.rounds");
  return name;
}

export function exitValueText(env: ExitEnv, block: Block, port: string, t: TFunction): string {
  const v = exitValue(env.blocks, env.steps, block, port);
  switch (v.kind) {
    case "next":
      return t("editor.exit.next");
    case "countMiss":
      return t("editor.exit.countMiss");
    case "nextRound":
      return t("editor.exit.nextRound");
    case "leave":
      return t("editor.exit.leave");
    case "step":
      return stepLabel(env, v.target, t);
    case "none":
      return t(block.type === "toggle" ? "editor.exit.goesOn" : "editor.exit.ends");
  }
}

/** A row "If too slow → Count a miss"; a tap opens the picker. */
export function ExitRow({ env, block, port }: { env: ExitEnv; block: Block; port: string }) {
  const { t } = useTranslation();
  const label = exitLabel(block, port, t);
  const value = exitValueText(env, block, port, t);
  return (
    <button type="button" className={styles.exitRow} aria-label={`${label}: ${value}`} onClick={() => env.open(port)}>
      <span className={styles.exitLabel}>{label} →</span>
      <span className={styles.exitValue}>{value}</span>
      <ChevronRight size={18} aria-hidden className={styles.chevron} />
    </button>
  );
}

const sameChoice = (v: ExitValue, c: ExitChoice) => v.kind === c.kind && (v.kind !== "step" || (c.kind === "step" && v.target === c.target));

export function ExitPickerPage({ env, block, port, onBack }: { env: ExitEnv; block: Block; port: string; onBack: () => void }) {
  const { t } = useTranslation();
  const { doc, steps } = env;
  const value = exitValue(env.blocks, steps, block, port);
  const choices = exitChoices(block, steps, port);
  const loop = loopOf(steps, block.name);
  const label = exitLabel(block, port, t);
  const pick = (choice: ExitChoice) => {
    env.apply(setExit(doc, steps, block.name, port, choice));
    onBack();
  };
  const next = naturalNext(steps, block.name);
  const option = (key: string, text: string, choice: ExitChoice, extra?: { hint?: string; reason?: string }) => (
    <button key={key} type="button" role="radio" aria-checked={sameChoice(value, choice)} className={styles.option} disabled={!!extra?.reason} onClick={() => pick(choice)}>
      <span className={styles.radioDot} aria-hidden />
      <span>
        <strong>{text}</strong>
        {(extra?.reason ?? extra?.hint) && <span className={styles.muted}>{extra.reason ?? extra.hint}</span>}
      </span>
    </button>
  );
  const targets = steps.filter((s) => !s.loop && env.blocks.has(s.block));
  return (
    <div className={styles.addPage}>
      <button type="button" className={styles.back} onClick={onBack}>
        <ChevronLeft size={18} aria-hidden /> {t("editor.sprinkle.back")}
      </button>
      <h4 className={styles.sectionTitle}>{label} →</h4>
      <div role="radiogroup" aria-label={label} className={styles.options}>
        {choices.none && option("none", t("editor.exit.goesOn"), { kind: "none" })}
        {option("next", t("editor.exit.next"), { kind: "next" }, { hint: next && env.blocks.has(next) ? stepLabel(env, next, t) : undefined })}
        {choices.countMiss && option("miss", t("editor.exit.countMissThen"), { kind: "countMiss" })}
        {choices.loop && option("round", t("editor.exit.nextRound"), { kind: "nextRound" })}
        {choices.loop && option("leave", t("editor.exit.leave"), { kind: "leave" }, { reason: loop?.after === undefined ? t("editor.exit.noAfter") : undefined })}
        <h5 className={styles.optionsTitle}>{t("editor.exit.aStep")}</h5>
        {targets.map((s) => {
          const to = entryOf(s);
          const reason = instantLoop(doc, block.name, to) ? t("editor.exit.instant") : undefined;
          return option(s.block, stepLabel(env, s.block, t), { kind: "step", target: to }, { reason });
        })}
      </div>
      <button type="button" className={styles.addButton} onClick={() => env.addConnected(block.name, port)}>
        <Plus size={18} aria-hidden /> {t("editor.exit.newStep")}
      </button>
    </div>
  );
}
