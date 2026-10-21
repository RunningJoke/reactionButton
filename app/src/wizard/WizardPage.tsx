/**
 * Game wizard (docs/app/editor-ux.md §4 B): one question per screen, everything prefilled,
 * then the Ready screen with name, menu pattern, the program as a story and three ways on.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Info, ListPlus, Pencil, Play, X } from "lucide-react";
import { LED_COUNT, MAX_FILE_SIZE, byteLength, formatProgram } from "@reactpod/program-model";
import { LedRingPicker } from "../components/LedRingPicker";
import { usePodSession } from "../pod/session";
import { useTakenPaths } from "../programs/actions";
import { editorUrl, simulateUrl, useLocalMenu } from "../programs/sources";
import { useWorkspace } from "../store/workspace";
import {
  GAMES,
  LIMITS,
  TARGET_COLORS,
  answerProblems,
  canCountMisses,
  defaultMenuLeds,
  gameNeeds,
  podsUsed,
  setCountMisses,
  setOnTimeout,
  setTimeLimit,
  withGame,
  type GameId,
  type OnTimeout,
  type WizardAnswers,
} from "./answers";
import { generateProgram, loopFormFor, storyOf } from "./generate";
import { OptionList, Segmented, SetDrawing, Stepper, Swatches, SwitchRow, useTick } from "./controls";
import { READY_STEP, WIZARD_STEPS, useWizard } from "./wizardStore";
import styles from "./Wizard.module.css";

export function WizardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { answers: a, step, update, setStep } = useWizard();
  const problems = answerProblems(a);
  // problems that belong to the current screen keep "Next" off
  const blocking = problems.filter((p) => (step === 1 && p === "notEnoughPods") || (step === 2 && p === "pauseOrder") || (step === 3 && p === "redTarget"));

  if (step >= READY_STEP) return <ReadyScreen />;

  const title = t(`wizard.steps.${WIZARD_STEPS[step]}`);
  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <button type="button" className={styles.iconButton} aria-label={t("wizard.cancel")} title={t("wizard.cancel")} onClick={() => navigate("/programs")}>
          <X size={22} aria-hidden />
        </button>
        <div className={styles.topText}>
          <span className={styles.stepOf}>{t("wizard.stepOf", { n: step + 1, total: WIZARD_STEPS.length })}</span>
          <h2 className={styles.title}>{title}</h2>
        </div>
      </div>
      <div className={styles.progress} aria-hidden>
        {WIZARD_STEPS.map((s, i) => (
          <i key={s} data-on={i <= step || undefined} />
        ))}
      </div>

      <div className={styles.body}>
        {step === 0 && <GameStep a={a} onPick={(game) => update((x) => withGame(x, game))} />}
        {step === 1 && <PodsStep a={a} update={update} />}
        {step === 2 && <TimingStep a={a} update={update} />}
        {step === 3 && <ColorsStep a={a} update={update} />}
        {step === 4 && <MeasureStep a={a} update={update} />}
        {blocking.map((p) => (
          <p key={p} className={styles.problem} role="alert">
            <AlertTriangle size={18} aria-hidden /> {t(`wizard.problems.${p}`, { game: t(`wizard.games.${a.game}.name`), count: gameNeeds(a.game).minPods })}
          </p>
        ))}
      </div>

      <div className={styles.bar}>
        <button type="button" className={styles.button} onClick={() => (step === 0 ? navigate("/programs") : setStep(step - 1))}>
          <ArrowLeft size={18} aria-hidden /> {t("wizard.back")}
        </button>
        <button type="button" className={`${styles.button} ${styles.primary}`} disabled={blocking.length > 0} onClick={() => setStep(step + 1)}>
          {step === WIZARD_STEPS.length - 1 ? t("wizard.build") : t("wizard.next")}
          {step < WIZARD_STEPS.length - 1 && <ArrowRight size={18} aria-hidden />}
        </button>
      </div>
    </div>
  );
}

type StepProps = { a: WizardAnswers; update: (change: (a: WizardAnswers) => WizardAnswers) => void };

/* ------------------------------------------------------------------ 1 game */

/** Which pods are lit in frame `tick` of a game's little animation. */
function gameFrame(game: GameId, pods: number, tick: number, color = "green"): Record<string, string> {
  switch (game) {
    case "solo":
      return { c: tick % 2 ? color : "blue" };
    case "star":
      return tick % 2 ? { [String([0, 2, 1][Math.floor(tick / 2) % 3]! % Math.max(pods, 1))]: color } : { c: color };
    case "random": {
      const order = ["1", "c", "2", "0", "c", "1", "2", "0"];
      return { [order[tick % order.length]!]: color };
    }
    case "multi": {
      if (tick % 3 === 2) return {};
      const lit: Record<string, string> = { c: color };
      for (let i = 0; i < pods; i++) lit[String(i)] = i === tick % pods ? "red" : color;
      return lit;
    }
    case "duo":
      return tick % 2 ? { 0: color } : { c: color };
  }
}

function artPods(game: GameId, pods: number): number {
  return game === "solo" ? 0 : game === "duo" ? 1 : pods;
}

function GameStep({ a, onPick }: { a: WizardAnswers; onPick: (game: GameId) => void }) {
  const { t } = useTranslation();
  const tick = useTick();
  return (
    <>
      <p className={styles.lead}>{t("wizard.game.question")}</p>
      <div className={styles.cards} role="radiogroup" aria-label={t("wizard.steps.game")}>
        {GAMES.map((game) => {
          const min = gameNeeds(game).minPods;
          return (
            <button key={game} type="button" role="radio" aria-checked={a.game === game} className={styles.choice} onClick={() => onPick(game)}>
              <span className={styles.art}>
                <SetDrawing pods={artPods(game, 3)} lit={gameFrame(game, 3, tick)} width={88} />
              </span>
              <span className={styles.choiceText}>
                <strong>{t(`wizard.games.${game}.name`)}</strong>
                <span>{t(`wizard.games.${game}.line`)}</span>
                <span className={styles.tag}>{min === 0 ? t("wizard.game.centralOnly") : t("wizard.game.needs", { count: min })}</span>
              </span>
              {a.game === game && <Check size={22} aria-hidden className={styles.checkMark} />}
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ 2 pods */

function PodsStep({ a, update }: StepProps) {
  const { t } = useTranslation();
  const used = podsUsed(a);
  const note = a.game === "solo" ? "soloUses" : a.game === "duo" ? "duoUses" : null;
  return (
    <>
      <p className={styles.lead}>{t("wizard.pods.question")}</p>
      <p className={styles.muted}>{t("wizard.pods.hint")}</p>
      <div className={styles.card}>
        <div className={styles.center}>
          <SetDrawing pods={a.pods} lit={{ c: "blue", ...Object.fromEntries(Array.from({ length: a.pods }, (_, i) => [String(i), "blue"])) }} width={200} label={t("wizard.pods.total", { count: a.pods })} />
        </div>
        <Stepper label={t("wizard.pods.label")} value={a.pods} min={0} max={7} onChange={(pods) => update((x) => ({ ...x, pods }))} />
        <p className={`${styles.muted} ${styles.centerText}`}>{t("wizard.pods.total", { count: a.pods })}</p>
      </div>
      {note && a.pods >= gameNeeds(a.game).minPods && (
        <p className={styles.note}>
          <Info size={18} aria-hidden /> {t(`wizard.pods.${note}`, { count: used })}
        </p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ 3 timing */

const seconds = (ms: number, locale: string) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(ms / 1000)} s`;

function TimingStep({ a, update }: StepProps) {
  const { t } = useTranslation();
  const locale = t("wizard.numberLocale");
  const sec = (ms: number) => seconds(ms, locale);
  const p = LIMITS.pauseMs;
  return (
    <>
      <Stepper label={t("wizard.timing.rounds")} value={a.rounds} min={LIMITS.rounds.min} max={LIMITS.rounds.max} onChange={(rounds) => update((x) => ({ ...x, rounds }))} />
      <Segmented
        label={t("wizard.timing.pause")}
        value={a.pause.kind}
        options={[
          { value: "fixed", label: t("wizard.timing.fixed") },
          { value: "random", label: t("wizard.timing.random") },
        ]}
        onChange={(kind) =>
          update((x) => {
            if (kind === x.pause.kind) return x;
            if (kind === "fixed") return { ...x, pause: { kind, ms: x.pause.kind === "random" ? x.pause.minMs : 2000 } };
            const ms = x.pause.kind === "fixed" ? x.pause.ms : 1000;
            return { ...x, pause: { kind, minMs: Math.min(ms, p.max - p.step), maxMs: Math.min(ms + 2000, p.max) } };
          })
        }
      />
      {a.pause.kind === "fixed" ? (
        <Stepper label={t("wizard.timing.pauseFixed")} value={a.pause.ms} min={p.min} max={p.max} step={p.step} format={sec} onChange={(ms) => update((x) => ({ ...x, pause: { kind: "fixed", ms } }))} />
      ) : (
        <div className={styles.pair}>
          <Stepper
            label={t("wizard.timing.shortest")}
            value={a.pause.minMs}
            min={p.min}
            max={p.max}
            step={p.step}
            format={sec}
            onChange={(minMs) => update((x) => (x.pause.kind === "random" ? { ...x, pause: { ...x.pause, minMs } } : x))}
          />
          <Stepper
            label={t("wizard.timing.longest")}
            value={a.pause.maxMs}
            min={p.min}
            max={p.max}
            step={p.step}
            format={sec}
            onChange={(maxMs) => update((x) => (x.pause.kind === "random" ? { ...x, pause: { ...x.pause, maxMs } } : x))}
          />
        </div>
      )}
      <SwitchRow
        label={t("wizard.timing.timeLimit")}
        hint={a.timeLimit ? t("wizard.timing.timeLimitOn", { s: sec(a.timeLimit.ms) }) : t("wizard.timing.timeLimitOff")}
        checked={a.timeLimit !== null}
        onChange={(on) => update((x) => setTimeLimit(x, on))}
      >
        {a.timeLimit && (
          <>
            <Stepper
              label={t("wizard.timing.secondsToPress")}
              value={a.timeLimit.ms}
              min={LIMITS.timeLimitMs.min}
              max={LIMITS.timeLimitMs.max}
              step={LIMITS.timeLimitMs.step}
              format={sec}
              onChange={(ms) => update((x) => (x.timeLimit ? { ...x, timeLimit: { ...x.timeLimit, ms } } : x))}
            />
            <OptionList<OnTimeout>
              label={t("wizard.timing.tooSlow")}
              value={a.timeLimit.onTimeout}
              options={(["goOn", "countMiss", "endRound"] as const).map((v) => ({ value: v, label: t(`wizard.timing.onTimeout.${v}`) }))}
              onChange={(v) => update((x) => setOnTimeout(x, v))}
            />
          </>
        )}
      </SwitchRow>
    </>
  );
}

/* ------------------------------------------------------------------ 4 colours */

function ColorsStep({ a, update }: StepProps) {
  const { t } = useTranslation();
  const tick = useTick();
  const pods = artPods(a.game, Math.max(a.pods, gameNeeds(a.game).minPods));
  return (
    <>
      <Swatches
        label={t("wizard.colors.target")}
        value={a.color}
        colors={TARGET_COLORS}
        disabled={a.game === "multi" && a.redPods > 0 ? ["red"] : []}
        onChange={(color) => update((x) => ({ ...x, color }))}
      />
      {a.game === "multi" ? (
        <SwitchRow
          label={t("wizard.colors.redPods")}
          hint={a.redPods > 0 ? t("wizard.colors.redPodsOn", { count: a.redPods }) : t("wizard.colors.redPodsOff")}
          checked={a.redPods > 0}
          onChange={(on) => update((x) => ({ ...x, redPods: on ? 1 : 0, color: on && x.color === "red" ? "green" : x.color }))}
        >
          <Stepper label={t("wizard.colors.redCount")} value={a.redPods} min={LIMITS.redPods.min} max={Math.max(1, podsUsed(a))} onChange={(redPods) => update((x) => ({ ...x, redPods }))} />
        </SwitchRow>
      ) : (
        <p className={styles.muted}>{t("wizard.colors.hint")}</p>
      )}
      <div className={`${styles.card} ${styles.center}`}>
        <SetDrawing pods={pods} lit={a.game === "multi" && a.redPods === 0 ? gameFrame("star", pods, tick, a.color) : gameFrame(a.game, pods, tick, a.color)} width={200} label={t("wizard.colors.preview")} />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ 5 measure */

function MeasureStep({ a, update }: StepProps) {
  const { t } = useTranslation();
  const canMiss = canCountMisses(a);
  const sources = [
    a.timeLimit && t("wizard.measure.missTooSlow"),
    a.game === "multi" && a.redPods > 0 && t("wizard.measure.missRed"),
    a.game === "solo" && a.measure.falseStart && t("wizard.measure.missFalseStart"),
  ].filter(Boolean);
  return (
    <>
      <p className={styles.lead}>{t("wizard.measure.question")}</p>
      <p className={styles.muted}>{t("wizard.measure.hint")}</p>
      <SwitchRow
        label={t("wizard.measure.record")}
        hint={t("wizard.measure.recordHint")}
        checked={a.measure.record}
        onChange={(record) => update((x) => ({ ...x, measure: { ...x.measure, record } }))}
      />
      {a.game === "solo" && (
        <SwitchRow
          label={t("wizard.measure.falseStart")}
          hint={t("wizard.measure.falseStartHint")}
          checked={a.measure.falseStart}
          onChange={(falseStart) => update((x) => ({ ...x, measure: { ...x.measure, falseStart } }))}
        />
      )}
      <SwitchRow
        label={t("wizard.measure.countMisses")}
        hint={canMiss ? t("wizard.measure.countMissesHint", { what: sources.join(", ") }) : t("wizard.measure.countMissesOff")}
        checked={a.measure.countMisses && canMiss}
        disabled={!canMiss}
        onChange={(on) => update((x) => setCountMisses(x, on))}
      />
      <SwitchRow
        label={t("wizard.measure.results")}
        hint={a.measure.record ? t("wizard.measure.resultsHint") : t("wizard.measure.resultsOff")}
        checked={a.measure.results && a.measure.record}
        disabled={!a.measure.record}
        onChange={(results) => update((x) => ({ ...x, measure: { ...x.measure, results } }))}
      />
    </>
  );
}

/* ------------------------------------------------------------------ ready */

function ReadyScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { answers, update, setStep, savedId, setSavedId } = useWizard();
  const programFormat = usePodSession((s) => (s.state === "connected" ? s.info?.programFormat : undefined));
  const form = loopFormFor(programFormat);
  const programs = useWorkspace((s) => s.programs);
  const add = useWorkspace((s) => s.add);
  const save = useWorkspace((s) => s.save);
  const setMenu = useWorkspace((s) => s.setMenu);
  const { menu } = useLocalMenu();
  const taken = useTakenPaths();
  const [busy, setBusy] = useState(false);

  const gameName = t(`wizard.games.${answers.game}.name`);
  const a = answers;
  // the name is prefilled in the user's language, and stays editable
  useEffect(() => {
    if (!answers.name) update((x) => ({ ...x, name: gameName }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const json = useMemo(
    () => ({ ...generateProgram({ ...a, name: a.name.trim() || gameName }, form), description: t(`wizard.games.${a.game}.line`) }),
    [a, gameName, form, t],
  );
  const size = byteLength(formatProgram(json));
  const story = storyOf(a, t);
  const leds = a.menuLeds ?? defaultMenuLeds(a.game);
  const ringColors = Array.from({ length: LED_COUNT }, (_, i) => (leds.includes(i) ? a.color : undefined));

  /** Saves the program as a local program (the same one again on a second call). */
  const persist = async () => {
    const existing = savedId ? programs.find((p) => p.id === savedId) : undefined;
    if (existing) {
      await save({ ...existing, json });
      return existing;
    }
    const doc = await add(json, "local", { taken });
    setSavedId(doc.id);
    return doc;
  };
  const run = (action: () => Promise<void>) => async () => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <button type="button" className={styles.iconButton} aria-label={t("wizard.back")} title={t("wizard.back")} onClick={() => setStep(READY_STEP - 1)}>
          <ArrowLeft size={22} aria-hidden />
        </button>
        <div className={styles.topText}>
          <span className={styles.stepOf}>{gameName}</span>
          <h2 className={styles.title}>{t("wizard.ready.title")}</h2>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="wizard-name">
            {t("wizard.ready.name")}
          </label>
          <input id="wizard-name" className={styles.input} value={a.name} placeholder={gameName} maxLength={40} onChange={(e) => update((x) => ({ ...x, name: e.target.value }))} />
        </div>

        <div className={styles.card}>
          <span className={styles.fieldLabel}>{t("wizard.ready.menu")}</span>
          <div className={styles.menuRow}>
            <LedRingPicker
              colors={ringColors}
              size={150}
              label={t("wizard.ready.menu")}
              onToggle={(i) =>
                update((x) => {
                  const current = x.menuLeds ?? defaultMenuLeds(x.game);
                  const next = current.includes(i) ? current.filter((l) => l !== i) : [...current, i].sort((p, q) => p - q);
                  return { ...x, menuLeds: next.length ? next : current };
                })
              }
            />
            <p className={styles.muted}>
              {t("wizard.ready.menuHint")} {podsUsed(a) === 0 ? t("wizard.ready.centralOnly") : `${t("wizard.pods.total", { count: podsUsed(a) })}.`} {t("wizard.ready.size", { percent: Math.max(1, Math.round((size / MAX_FILE_SIZE) * 100)) })}
            </p>
          </div>
        </div>

        <div className={styles.card}>
          <strong>{t("wizard.ready.story")}</strong>
          <p className={styles.storyIntro}>{story.intro}</p>
          <ol className={styles.story}>
            {story.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {story.outro.map((s, i) => (
            <p key={i} className={styles.muted}>
              {s}
            </p>
          ))}
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.button} ${styles.primary} ${styles.wide}`}
            disabled={busy}
            onClick={run(async () => {
              const doc = await persist();
              navigate(simulateUrl({ id: doc.id }));
            })}
          >
            <Play size={18} aria-hidden /> {t("wizard.ready.try")}
          </button>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              disabled={busy}
              onClick={run(async () => {
                const doc = await persist();
                navigate(editorUrl(doc.id));
              })}
            >
              <Pencil size={18} aria-hidden /> {t("wizard.ready.change")}
            </button>
            <button
              type="button"
              className={styles.button}
              disabled={busy}
              onClick={run(async () => {
                const doc = await persist();
                if (!menu.includes(doc.path)) await setMenu([...menu, doc.path]);
                useWizard.getState().start();
                navigate("/menu");
              })}
            >
              <ListPlus size={18} aria-hidden /> {t("wizard.ready.saveToMenu")}
            </button>
          </div>
          {savedId && <p className={styles.muted}>{t("wizard.ready.saved")}</p>}
        </div>
      </div>
    </div>
  );
}
