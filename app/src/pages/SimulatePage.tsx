/** Simulator (docs/app/spec.md §8): all pods of a program, the graph with the current block, controls, panels. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Copy, FastForward, Hand, Pause, Play, RotateCcw, StepForward } from "lucide-react";
import { Named } from "../components/Named";
import { isMsSetting } from "../editor/settingLabels";
import { formatMs } from "../results/stats";
import { LedRing } from "../components/LedRing";
import { ProgramColumnView } from "../editor/ProgramColumnView";
import { buildGraph } from "../model/graph";
import { hasErrors, validateProgram } from "@reactpod/program-model";
import { editorUrl, useProgramSource, type SourceId } from "../programs/sources";
import type { CommunicateView, PodView, Snapshot, StopReason } from "../simulator/engine";
import { SPEEDS, useSimulation, type SimulationControls } from "../simulator/useSimulation";
import page from "./Page.module.css";
import styles from "./SimulatePage.module.css";

export type SimulateTarget = { source: SourceId; path: string; id?: string };

/** Try mode of the game page: the simulator for one game. */
export function SimulatePage({ target }: { target: SimulateTarget }) {
  const { t } = useTranslation();
  const source = useProgramSource(target?.source ?? "local");
  const read = source.read;

  // keyed by the program text: `read` changes with every local edit of any program
  const text = target ? read(target.path) : undefined;
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

  const sim = useSimulation(model?.ok ? model.resolved : null);

  return (
    <div className={`${page.page} ${styles.page}`}>
      {!target || !model ? (
        <p className={page.muted}>{t("simulate.noProgram")}</p>
      ) : !model.ok || !sim ? (
        <div className={styles.blocked} role="alert">
          <p>{t("simulate.hasErrors")}</p>
          {target.id && <Link to={editorUrl(target.id)}>{t("simulate.openEditor")}</Link>}
        </div>
      ) : (
        <div className={styles.layout}>
          <div className={styles.main}>
            <Pods sim={sim} />
            {sim.snapshot.waiting && <WaitingPanel sim={sim} view={sim.snapshot.waiting} />}
            <Controls sim={sim} />
            <Panels snapshot={sim.snapshot} trace={sim.trace} />
          </div>
          <section className={`${page.section} ${styles.graph}`} aria-label={t("simulate.graph")} data-scroll-follow>
            <p className={page.muted}>{t("simulate.breakpointHint")}</p>
            <ProgramColumnView
              graph={model.graph}
              active={sim.snapshot.current}
              previous={sim.snapshot.previous}
              breakpoints={sim.breakpoints}
              onSelect={(id) => id && sim.toggleBreakpoint(id)}
            />
          </section>
        </div>
      )}
    </div>
  );
}

/** Every pod of the program as a raised puck; the whole puck is the button (press and hold = long press). */
function Pods({ sim }: { sim: SimulationControls }) {
  const { t } = useTranslation();
  // the pods fill the stage: the fewer pods, the bigger the target
  const count = sim.snapshot.pods.length;
  const size = count <= 2 ? 140 : count <= 4 ? 116 : 96;
  return (
    <section className={page.section} aria-label={t("simulate.pods")}>
      <ul className={styles.pods}>
        {sim.snapshot.pods.map((pod) => (
          <li key={pod.id}>
            <PodButton pod={pod} size={size} onPress={() => sim.press(pod.id)} onRelease={() => sim.release(pod.id)} />
            <button type="button" className={styles.holdToggle} aria-pressed={pod.held} onClick={() => (pod.held ? sim.release(pod.id) : sim.press(pod.id))}>
              <Hand size={18} aria-hidden /> {t("simulate.hold")}
            </button>
          </li>
        ))}
      </ul>
      <p className={styles.hint}>{t("simulate.podsHint")}</p>
    </section>
  );
}

/**
 * A communicate block waits (programs.md §7.16): its last report, the answers of the client (continue,
 * repeat, stop) and the editable variables. Behaves like the phone app would.
 */
function WaitingPanel({ sim, view }: { sim: SimulationControls; view: CommunicateView }) {
  const { t, i18n } = useTranslation();
  const stats = Object.entries(view.report.stats);
  const vars = Object.entries(view.report.vars);
  const editable = Object.entries(view.editable);
  return (
    <section className={`${page.section} ${styles.waiting}`} aria-label={t("simulate.report.title")}>
      <h2>{t("simulate.report.title")}</h2>
      <p className={page.muted}>{t("simulate.report.number", { id: view.report.id, cycle: view.report.cycle })}</p>
      {stats.length === 0 ? (
        <p className={page.muted}>{t("simulate.noMetrics")}</p>
      ) : (
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
            {stats.map(([metric, s]) => (
              <tr key={metric}>
                <td><Named name={metric} /></td>
                <td>{s.count}</td>
                <td>{formatMs(s.average, i18n.language)}</td>
                <td>{formatMs(s.best, i18n.language)}</td>
                <td>{formatMs(s.worst, i18n.language)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {vars.length > 0 && (
        <dl className={styles.variables}>
          {vars.map(([name, value]) => (
            <div key={name} className={styles.variable}>
              <dt><Named name={name} /></dt>
              <dd>{isMsSetting(name) ? formatMs(value, i18n.language) : value}</dd>
            </div>
          ))}
        </dl>
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
      {editable.length > 0 && (
        <div className={styles.editable}>
          {editable.map(([name, range]) => (
            <EditableField key={name} name={name} min={range.min} max={range.max} value={range.value} onChange={(n) => sim.setVariables({ [name]: n })} />
          ))}
        </div>
      )}
    </section>
  );
}

/** A number input for an editable variable: applied while it holds a whole number within min … max. */
function EditableField({ name, min, max, value, onChange }: { name: string; min: number; max: number; value: number; onChange: (n: number) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const id = `editable-${name}`;
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

/** "A · 3": the team of a pod in the domination game and its flips (OWNER_A = 0, OWNER_B = 1, nobody = 2). */
function toggleText(toggle: NonNullable<PodView["toggle"]>, t: (key: string) => string): string {
  const team = toggle.owner === 0 ? t("simulate.teamA") : toggle.owner === 1 ? t("simulate.teamB") : "–";
  return `${team} · ${toggle.flips}`;
}

function PodButton({ pod, size, onPress, onRelease }: { pod: PodView; size: number; onPress: () => void; onRelease: () => void }) {
  const { t } = useTranslation();
  const down = useRef(false);
  const label = pod.central ? t("simulate.central", { id: pod.id }) : t("simulate.peripheral", { id: pod.id });
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
            start();
          }
        }}
        onKeyUp={(e) => (e.key === " " || e.key === "Enter") && end()}
        onBlur={end}
      >
        <LedRing colors={pod.leds} size={size} title={label} subtitle={pod.toggle ? toggleText(pod.toggle, t) : pod.state === "active" ? t("simulate.pressNow") : undefined} pressed={pod.held} />
      </button>
    </div>
  );
}

const STATUS: Record<StopReason, string> = { paused: "simulate.status.paused", waiting: "simulate.status.waiting", ended: "simulate.status.ended", time: "simulate.status.paused" };

function Controls({ sim }: { sim: SimulationControls }) {
  const { t, i18n } = useTranslation();
  const [seedText, setSeedText] = useState(String(sim.seed));
  useEffect(() => setSeedText(String(sim.seed)), [sim.seed]);
  const { snapshot } = sim;
  const status = !snapshot.running ? t("simulate.status.ended") : sim.playing ? t("simulate.status.running") : sim.stop ? t(STATUS[sim.stop]) : t("simulate.status.ready");
  const seconds = new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(snapshot.time / 1000);

  return (
    <section className={`${page.section} ${styles.controls}`} aria-label={t("simulate.controls")}>
      <div className={styles.status} aria-live="polite">
        <strong>{status}</strong>
        <span>
          {snapshot.current && (
            <>
              <code>{snapshot.current}</code> ·{" "}
            </>
          )}
          {t("simulate.time", { seconds })}
        </span>
      </div>
      <div className={styles.buttons}>
        {sim.playing ? (
          <button className={`${styles.control} ${styles.primary}`} onClick={sim.pause}>
            <Pause size={20} aria-hidden /> {t("simulate.pause")}
          </button>
        ) : (
          <button className={`${styles.control} ${styles.primary}`} onClick={sim.play} disabled={!snapshot.running}>
            <Play size={20} aria-hidden /> {t("simulate.run")}
          </button>
        )}
        <button className={styles.control} onClick={sim.step} disabled={!snapshot.running}>
          <StepForward size={20} aria-hidden /> {t("simulate.step")}
        </button>
        <button className={styles.control} onClick={sim.skipWait} disabled={!snapshot.running}>
          <FastForward size={20} aria-hidden /> {t("simulate.skipWait")}
        </button>
        <button className={styles.control} onClick={() => sim.reset()}>
          <RotateCcw size={20} aria-hidden /> {t("simulate.reset")}
        </button>
      </div>
      <div className={styles.settings}>
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
      </div>
    </section>
  );
}

function Panels({ snapshot, trace }: { snapshot: Snapshot; trace: () => string }) {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  const previous = useRef<Record<string, number>>({});
  const changed = new Set(Object.entries(snapshot.variables).filter(([k, v]) => previous.current[k] !== undefined && previous.current[k] !== v).map(([k]) => k));
  useEffect(() => {
    previous.current = snapshot.variables;
  });
  const log = snapshot.log.slice(-80);

  return (
    <>
      <section className={page.section}>
        <h2>{t("simulate.variables")}</h2>
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
      </section>

      <section className={page.section}>
        <h2>{t("simulate.metrics")}</h2>
        {snapshot.metrics.length === 0 ? (
          <p className={page.muted}>{t("simulate.noMetrics")}</p>
        ) : (
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
        <p className={styles.hint}>{t("simulate.metricsHint")}</p>
      </section>

      <section className={page.section}>
        <div className={styles.logHeader}>
          <h2>{t("simulate.log")}</h2>
          <button
            className={page.textButton}
            onClick={() => {
              void navigator.clipboard?.writeText(trace()).then(() => {
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
      </section>
    </>
  );
}
