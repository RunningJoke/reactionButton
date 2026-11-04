/** Try mode of the game page (docs/app/spec.md §8): one card with the pods, what happens now, results so far; details folded away. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Copy, FastForward, Pause, Play, RotateCcw, StepForward } from "lucide-react";
import { isMsSetting, labelOf } from "../editor/settingLabels";
import { useExpertMode } from "../editor/expertMode";
import { formatMs, mainMetric } from "../results/stats";
import { LedRing } from "../components/LedRing";
import { Named } from "../components/Named";
import { sentenceOptions, stepSentence, type SentenceOptions } from "../editor/sentence";
import { flatProgram, stepList, type Step } from "../editor/structure";
import { ProgramColumnView } from "../editor/ProgramColumnView";
import { buildGraph } from "../model/graph";
import { hasErrors, isObject, labelsOf, validateProgram, type Block } from "@reactpod/program-model";
import { editorUrl, useProgramSource, type SourceId } from "../programs/sources";
import type { CommunicateView, PodView, Snapshot, StopReason } from "../simulator/engine";
import { SPEEDS, useSimulation, type SimulationControls } from "../simulator/useSimulation";
import page from "./Page.module.css";
import view from "./TrainingPage.module.css";
import styles from "./SimulatePage.module.css";

export type SimulateTarget = { source: SourceId; path: string; id?: string };

type TFn = (key: string, options?: Record<string, unknown>) => string;

/** What the page knows about the game besides the simulator: words for blocks, variables and metrics. */
type Words = { steps: Step[]; blocks: Map<string, Block>; options: SentenceOptions; labels: Record<string, string> };

/** How long a result chip stays on a pod. */
const CHIP_MS = 3500;
type Chip = { text: string; early: boolean; key: number };

/** `value`, once it has stopped changing for `ms` (0: at once). */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (!ms) return;
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return ms ? settled : value;
}

/** `restartAfterMs`: the side simulator in Edit restarts this long after the last edit of the game. */
export function SimulatePage({ target, restartAfterMs = 0 }: { target: SimulateTarget; restartAfterMs?: number }) {
  const { t, i18n } = useTranslation();
  const source = useProgramSource(target?.source ?? "local");
  const read = source.read;

  // keyed by the program text: `read` changes with every local edit of any program
  const text = useSettled(target ? read(target.path) : undefined, restartAfterMs);
  const readRef = useRef(read);
  readRef.current = read;
  const path = target?.path;
  const { programFormat } = source;
  const model = useMemo(() => {
    if (!path || text === undefined) return null;
    // checked against the connected pod's format; the simulator itself runs every block type the app knows
    const resolved = validateProgram(path, readRef.current, { programFormat });
    const blocking = resolved.issues.filter((i) => i.code !== "unsupportedType");
    return { resolved, graph: buildGraph(resolved), ok: !hasErrors(blocking) && resolved.doc !== null };
  }, [path, text, programFormat]);

  const words = useMemo<Words | null>(() => {
    if (!model?.ok || !model.resolved.doc) return null;
    const { resolved, graph } = model;
    const blocks = resolved.blocks.filter((b) => isObject(b.block) && typeof b.block.name === "string").map((b) => b.block as Block);
    const labels = labelsOf(resolved.doc, i18n.language);
    const steps = stepList(flatProgram(resolved.doc as never, blocks, graph.start));
    return { steps, blocks: new Map(blocks.map((b) => [b.name, b])), labels, options: sentenceOptions(blocks, resolved.variables, (n) => labelOf(n, t, labels)) };
  }, [model, t, i18n.language]);

  const sim = useSimulation(model?.ok ? model.resolved : null);

  return (
    <div className={`${page.page} ${styles.page}`}>
      {!target || !model ? (
        <p className={page.muted}>{t("simulate.noProgram")}</p>
      ) : !model.ok || !sim || !words ? (
        <div className={styles.blocked} role="alert">
          <p>{t("simulate.hasErrors")}</p>
          {target.id && <Link to={editorUrl(target.id)}>{t("simulate.openEditor")}</Link>}
        </div>
      ) : (
        <Try sim={sim} words={words} graph={model.graph} />
      )}
    </div>
  );
}

function Try({ sim, words, graph }: { sim: SimulationControls; words: Words; graph: ReturnType<typeof buildGraph> }) {
  const { t, i18n } = useTranslation();
  const [expert] = useExpertMode();
  const { snapshot } = sim;
  const [open, setOpen] = useState(expert);
  useEffect(() => setOpen(expert), [expert]);

  // result chips: a press that brings a measurement shows its time on that pod; one that changes the block without one was too early
  const [chips, setChips] = useState<Record<number, Chip>>({});
  const [falseStarts, setFalseStarts] = useState(0);
  const pending = useRef<{ pod: number; block: string | null } | null>(null);
  const seen = useRef({ measurements: 0, time: 0, key: 0 });
  useEffect(() => {
    const s = seen.current;
    if (snapshot.time < s.time) {
      setChips({});
      setFalseStarts(0);
    }
    s.time = snapshot.time;
    const fresh = snapshot.measurements.slice(snapshot.measurements.length < s.measurements ? 0 : s.measurements);
    s.measurements = snapshot.measurements.length;
    const press = pending.current;
    if (!press) return;
    const hit = fresh.find((m) => m.pod === press.pod) ?? fresh[0];
    if (!hit && snapshot.current === press.block) return;
    pending.current = null;
    const chip: Chip = hit ? { text: formatMs(hit.ms, i18n.language), early: false, key: ++s.key } : { text: t("simulate.tooEarly"), early: true, key: ++s.key };
    if (!hit) setFalseStarts((n) => n + 1);
    const pod = hit?.pod ?? press.pod;
    setChips((c) => ({ ...c, [pod]: chip }));
    setTimeout(() => setChips((c) => (c[pod]?.key === chip.key ? Object.fromEntries(Object.entries(c).filter(([k]) => Number(k) !== pod)) : c)), CHIP_MS);
  }, [snapshot, i18n.language, t]);
  const press = (pod: number) => {
    pending.current = { pod, block: snapshot.current };
    sim.press(pod);
  };

  const state = stateOf(sim);
  const round = snapshot.variables.RUNS ?? 0;
  const max = snapshot.variables.MAX_LOOPS ?? 0;
  const pill = [round > 0 && max > 0 ? t("training.view.round", { n: round, max }) : null, t(`simulate.state.${state}`)].filter(Boolean).join(" · ");

  return (
    <>
      <section className={`${page.section} ${styles.card}`} aria-label={t("simulate.pods")}>
        <div className={styles.head} aria-live="polite">
          <span className={view.pill} data-tone={TONE[state]}>
            <span className={view.dot} aria-hidden />
            {pill}
          </span>
          <p className={styles.now}>{nowLine(sim, words, t)}</p>
          {expert && snapshot.current && (
            <p className={styles.secondary}>
              <code>{snapshot.current}</code> · {t("simulate.time", { seconds: new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(snapshot.time / 1000) })}
            </p>
          )}
        </div>
        <Pods sim={sim} chips={chips} onPress={press} />
        <p className={styles.hint}>{t("simulate.podsHint")}</p>
      </section>

      {snapshot.waiting && <WaitingPanel sim={sim} view={snapshot.waiting} labels={words.labels} />}

      <SoFar snapshot={snapshot} falseStarts={falseStarts} labels={words.labels} />

      <details className={`${page.section} ${styles.details}`} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>{t("simulate.details")}</summary>
        {open && <Details sim={sim} graph={graph} />}
      </details>

      <div className={styles.bar} role="group" aria-label={t("simulate.controls")}>
        {sim.playing ? (
          <button className={`${styles.control} ${styles.primary}`} onClick={sim.pause}>
            <Pause size={20} aria-hidden /> {t("simulate.pause")}
          </button>
        ) : (
          <button className={`${styles.control} ${styles.primary}`} onClick={sim.play} disabled={!snapshot.running}>
            <Play size={20} aria-hidden /> {t("simulate.run")}
          </button>
        )}
        <button className={styles.control} onClick={sim.skipWait} disabled={!snapshot.running}>
          <FastForward size={20} aria-hidden /> {t("simulate.skipWait")}
        </button>
        <button className={styles.control} onClick={() => sim.reset()}>
          <RotateCcw size={20} aria-hidden /> {t("simulate.reset")}
        </button>
      </div>
    </>
  );
}

type State = "ready" | "running" | "paused" | "waitingPress" | "app" | "ended";
const TONE: Record<State, string> = { ready: "blue", running: "green", paused: "yellow", waitingPress: "blue", app: "blue", ended: "neutral" };
const STOP: Record<StopReason, State> = { paused: "paused", waiting: "waitingPress", ended: "ended", time: "paused" };

function stateOf(sim: SimulationControls): State {
  if (!sim.snapshot.running) return "ended";
  if (sim.snapshot.waiting) return "app";
  return sim.playing ? "running" : sim.stop ? STOP[sim.stop] : "ready";
}

/** "Step 3 of 4: Light pod 2 green, wait for the press": the step list's sentence for the current block. */
function nowLine(sim: SimulationControls, words: Words, t: TFn): string {
  const { snapshot } = sim;
  if (!snapshot.running) return t("simulate.now.ended");
  if (snapshot.waiting) return t("simulate.now.app");
  if (!snapshot.current || (!sim.playing && !sim.stop && snapshot.time === 0)) return t("simulate.now.ready");
  const block = words.blocks.get(snapshot.current);
  const sentence = block ? stepSentence(block, t, words.options) : snapshot.current;
  const step = words.steps.find((s) => !s.loop && s.block === snapshot.current);
  const total = words.steps.filter((s) => !s.loop && !s.branchOf).length;
  // a step of a branch is numbered "3.1" like in the editor, with no total
  if (!step) return sentence;
  return t(step.number.includes(".") ? "simulate.now.branch" : "simulate.now.step", { n: step.number, total, text: sentence });
}

/** Every pod as a small puck in one row (two rows from five pods): press = button down, press and hold = long press. */
function Pods({ sim, chips, onPress }: { sim: SimulationControls; chips: Record<number, Chip>; onPress: (pod: number) => void }) {
  const { t } = useTranslation();
  const count = sim.snapshot.pods.length;
  return (
    <ul className={styles.pods} style={{ "--cols": count <= 4 ? count : Math.ceil(count / 2) } as React.CSSProperties}>
      {[...sim.snapshot.pods].sort((a, b) => Number(b.central) - Number(a.central)).map((pod) => (
        <li key={pod.id}>
          <PodButton pod={pod} size={count <= 3 ? 72 : 64} onPress={() => onPress(pod.id)} onRelease={() => sim.release(pod.id)} onToggleHold={() => (pod.held ? sim.release(pod.id) : sim.press(pod.id))} />
          <span className={styles.podName}>
            {podName(pod, t)}
            {pod.toggle && ` · ${toggleText(pod.toggle, t)}`}
          </span>
          <span className={styles.chipSlot}>
            {chips[pod.id] && (
              <span key={chips[pod.id]!.key} className={styles.chip} data-early={chips[pod.id]!.early || undefined}>
                {chips[pod.id]!.text}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** "So far": the main metric's best and average in big figures, and the false starts. */
function SoFar({ snapshot, falseStarts, labels }: { snapshot: Snapshot; falseStarts: number; labels: Record<string, string> }) {
  const { t, i18n } = useTranslation();
  const name = mainMetric(snapshot.metrics.map((m) => m.metric));
  const main = snapshot.metrics.find((m) => m.metric === name);
  if (!main && falseStarts === 0) return null;
  const figures: [string, string][] = [];
  if (main) figures.push([t("simulate.best"), formatMs(main.best, i18n.language)], [t("simulate.average"), formatMs(main.average, i18n.language)]);
  figures.push([t("simulate.falseStarts"), String(falseStarts)]);
  return (
    <section className={`${page.section} ${styles.card}`} aria-label={t("simulate.soFar")}>
      <h2>
        {t("simulate.soFar")}
        {name && <span className={page.muted}> · {labelOf(name, t, labels)}</span>}
      </h2>
      <dl className={styles.figures}>
        {figures.map(([label, value]) => (
          <div key={label}>
            <dd>{value}</dd>
            <dt>{label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * A communicate block waits (programs.md §7.16): its last report, the answers of the client (continue,
 * repeat, stop) and the editable variables. Behaves like the phone app would.
 */
function WaitingPanel({ sim, view: waiting, labels }: { sim: SimulationControls; view: CommunicateView; labels: Record<string, string> }) {
  const { t, i18n } = useTranslation();
  const stats = Object.entries(waiting.report.stats);
  const vars = Object.entries(waiting.report.vars).filter(([name]) => !(name in waiting.editable));
  const editable = Object.entries(waiting.editable);
  return (
    <section className={`${page.section} ${styles.card} ${styles.waiting}`} aria-label={t("simulate.report.title")}>
      <h2>{t("simulate.report.title")}</h2>
      {stats.length === 0 ? (
        <p className={page.muted}>{t("simulate.noMetrics")}</p>
      ) : (
        <ul className={styles.results}>
          {stats.map(([metric, s]) => (
            <li key={metric}>
              <span>{labelOf(metric, t, labels)}</span>
              <span>
                {t("simulate.best")} <strong>{formatMs(s.best, i18n.language)}</strong>
              </span>
              <span>
                {t("simulate.average")} <strong>{formatMs(s.average, i18n.language)}</strong>
              </span>
            </li>
          ))}
        </ul>
      )}
      {vars.length > 0 && (
        <p className={page.muted}>
          {vars.map(([name, value]) => `${labelOf(name, t, labels)}: ${isMsSetting(name) ? formatMs(value, i18n.language) : value}`).join(" · ")}
        </p>
      )}
      {editable.length > 0 && (
        <div className={styles.editable}>
          {editable.map(([name, range]) => (
            <EditableField key={name} name={labelOf(name, t, labels)} id={name} min={range.min} max={range.max} value={range.value} onChange={(n) => sim.setVariables({ [name]: n })} />
          ))}
        </div>
      )}
      <div className={styles.buttons}>
        <button className={`${styles.control} ${styles.primary}`} onClick={() => sim.command("continue")}>
          {t("simulate.report.continue")}
        </button>
        <button className={styles.control} onClick={() => sim.command("repeat")}>
          {t("simulate.report.repeat")}
        </button>
        <button className={styles.control} onClick={() => sim.command("stop")}>
          {t("simulate.report.stop")}
        </button>
      </div>
    </section>
  );
}

/** A number input for an editable variable: applied while it holds a whole number within min … max. */
function EditableField({ name, id: key, min, max, value, onChange }: { name: string; id: string; min: number; max: number; value: number; onChange: (n: number) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const id = `editable-${key}`;
  return (
    <div className={styles.editableField}>
      <label htmlFor={id}>{name}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isInteger(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={() => setDraft(String(value))}
      />
      <span className={page.muted}>{t("simulate.report.range", { min, max })}</span>
    </div>
  );
}

/** "Main pod", "Pod 1": peripherals count from 1 like the step sentences. */
const podName = (pod: PodView, t: TFn) => (pod.central ? t("simulate.central") : t("simulate.peripheral", { id: pod.id + 1 }));

/** "A · 3": the team of a pod in the domination game and its flips (OWNER_A = 0, OWNER_B = 1, nobody = 2). */
function toggleText(toggle: NonNullable<PodView["toggle"]>, t: TFn): string {
  const team = toggle.owner === 0 ? t("simulate.teamA") : toggle.owner === 1 ? t("simulate.teamB") : "–";
  return `${team} · ${toggle.flips}`;
}

/**
 * The puck is the button: pointer down = press, up = release, so holding the finger down is the long press.
 * Without a long touch (keyboard, screen reader): Shift+Enter or Shift+Space latches the hold, the same again lets go.
 */
function PodButton({ pod, size, onPress, onRelease, onToggleHold }: { pod: PodView; size: number; onPress: () => void; onRelease: () => void; onToggleHold: () => void }) {
  const { t } = useTranslation();
  const down = useRef(false);
  const label = podName(pod, t);
  const start = () => {
    if (down.current) return;
    down.current = true;
    onPress();
  };
  const end = () => {
    if (!down.current) return;
    down.current = false;
    onRelease();
  };
  return (
    <div className={styles.pod} data-state={pod.state}>
      <button
        type="button"
        className={styles.podButton}
        data-held={pod.held || undefined}
        aria-label={t("simulate.press", { pod: label })}
        aria-keyshortcuts="Shift+Enter"
        title={t("simulate.holdKey")}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          start();
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            if (e.shiftKey) onToggleHold();
            else start();
          }
        }}
        onKeyUp={(e) => (e.key === " " || e.key === "Enter") && end()}
        onBlur={end}
      >
        <LedRing colors={pod.leds} size={size} title={pod.central ? undefined : String(pod.id + 1)} subtitle={pod.state === "active" ? t("simulate.pressNow") : undefined} pressed={pod.held} />
      </button>
    </div>
  );
}

/** Behind "Details": step, speed, random pattern, variables, measurements, log, block graph. */
function Details({ sim, graph }: { sim: SimulationControls; graph: ReturnType<typeof buildGraph> }) {
  const { t, i18n } = useTranslation();
  const { snapshot } = sim;
  const [seedText, setSeedText] = useState(String(sim.seed));
  useEffect(() => setSeedText(String(sim.seed)), [sim.seed]);
  const [copied, setCopied] = useState(false);
  const previous = useRef<Record<string, number>>({});
  const changed = new Set(Object.entries(snapshot.variables).filter(([k, v]) => previous.current[k] !== undefined && previous.current[k] !== v).map(([k]) => k));
  useEffect(() => {
    previous.current = snapshot.variables;
  });
  const log = snapshot.log.slice(-80);

  return (
    <div className={styles.detailsBody}>
      <div className={styles.settings}>
        <button className={styles.control} onClick={sim.step} disabled={!snapshot.running}>
          <StepForward size={20} aria-hidden /> {t("simulate.step")}
        </button>
        <label>
          {t("simulate.speed")}
          <select value={sim.speed} onChange={(e) => sim.setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                ×{s}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("simulate.seed")}
          <input
            inputMode="numeric"
            value={seedText}
            onChange={(e) => setSeedText(e.target.value.replace(/\D/g, ""))}
            onBlur={() => seedText && Number(seedText) !== sim.seed && sim.reset(Number(seedText))}
            onKeyDown={(e) => e.key === "Enter" && seedText && sim.reset(Number(seedText))}
          />
        </label>
        <button className={styles.control} onClick={() => sim.reset(1 + Math.floor(Math.random() * 999999))}>
          {t("simulate.newSeed")}
        </button>
      </div>

      <h3>{t("simulate.variables")}</h3>
      <dl className={styles.variables}>
        {Object.entries(snapshot.variables).map(([name, value]) => (
          <div key={name} className={styles.variable}>
            <dt>{name}</dt>
            <dd key={`${name}:${value}`} data-changed={changed.has(name) || undefined}>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <h3>{t("simulate.metrics")}</h3>
      {snapshot.metrics.length === 0 ? (
        <p className={page.muted}>{t("simulate.noMetrics")}</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.metrics}>
            <thead>
              <tr>
                <th>{t("simulate.metric")}</th>
                <th>{t("simulate.count")}</th>
                <th>{t("simulate.average")}</th>
                <th>{t("simulate.best")}</th>
                <th>{t("simulate.worst")}</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.metrics.map((m) => (
                <tr key={m.metric}>
                  <td><Named name={m.metric} /></td>
                  <td>{m.count}</td>
                  <td>{formatMs(m.average, i18n.language)}</td>
                  <td>{formatMs(m.best, i18n.language)}</td>
                  <td>{formatMs(m.worst, i18n.language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {snapshot.measurements.length > 0 && (
        <p className={page.muted}>
          {t("simulate.last", {
            values: snapshot.measurements
              .slice(-5)
              .map((m) => `${formatMs(m.ms, i18n.language)} (${m.pod})`)
              .join(", "),
          })}
        </p>
      )}

      <div className={styles.logHeader}>
        <h3>{t("simulate.log")}</h3>
        <button
          className={page.textButton}
          onClick={() => {
            void navigator.clipboard?.writeText(sim.trace()).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          <Copy size={14} aria-hidden /> {copied ? t("simulate.copied") : t("simulate.copyTrace")}
        </button>
      </div>
      <ol className={styles.log}>
        {log.map((entry, i) => (
          <li key={i} data-kind={entry.kind}>
            <span className={styles.logTime}>{(entry.t / 1000).toFixed(3)}</span> {entry.text}
          </li>
        ))}
      </ol>

      <h3>{t("simulate.graph")}</h3>
      <section className={styles.graph} aria-label={t("simulate.graph")} data-scroll-follow>
        <p className={page.muted}>{t("simulate.breakpointHint")}</p>
        <ProgramColumnView graph={graph} active={snapshot.current} previous={snapshot.previous} breakpoints={sim.breakpoints} onSelect={(id) => id && sim.toggleBreakpoint(id)} />
      </section>
    </div>
  );
}
