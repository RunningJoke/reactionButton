/** Simulator (docs/app/spec.md §8): all pods of a program, the graph with the current block, controls, panels. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Copy, FastForward, Pause, Pencil, Play, RotateCcw, StepForward } from "lucide-react";
import { LedRing } from "../components/LedRing";
import { useEditor } from "../editor/editorStore";
import { ProgramColumnView } from "../editor/ProgramColumnView";
import { buildGraph } from "../model/graph";
import { INDEX_PATH, isLibraryPath } from "@reactpod/program-model";
import { isProgramFile } from "@reactpod/program-model";
import { hasErrors, validateProgram } from "@reactpod/program-model";
import { editorUrl, simulateUrl, useLocalMenu, useProgramSource, type SourceId } from "../programs/sources";
import type { PodView, Snapshot, StopReason } from "../simulator/engine";
import { SPEEDS, useSimulation, type SimulationControls } from "../simulator/useSimulation";
import { useWorkspace } from "../store/workspace";
import page from "./Page.module.css";
import styles from "./SimulatePage.module.css";

type Target = { source: SourceId; path: string; id?: string };

/** The program to simulate: `?id=` (local), `?source=&path=`, else the program open in the editor, else the first in the menu. */
function useTarget(): Target | null {
  const [params] = useSearchParams();
  const programs = useWorkspace((s) => s.programs);
  const editorDoc = useEditor((s) => s.doc);
  const { menu } = useLocalMenu();
  const id = params.get("id");
  const source = params.get("source");
  const path = params.get("path");
  if (id) {
    const doc = programs.find((p) => p.id === id);
    return doc ? { source: "local", path: doc.path, id } : null;
  }
  if (path && (source === "pod" || source === "shipped" || source === "local")) return { source, path };
  if (editorDoc) return { source: "local", path: editorDoc.path, id: editorDoc.id };
  return menu[0] ? { source: "local", path: menu[0] } : null;
}

export function SimulatePage() {
  const { t } = useTranslation();
  const target = useTarget();
  const source = useProgramSource(target?.source ?? "local");
  const read = source.read;

  // keyed by the program text: `read` changes with every local edit of any program
  const text = target ? read(target.path) : undefined;
  const readRef = useRef(read);
  readRef.current = read;
  const path = target?.path;
  const model = useMemo(() => {
    if (!path || text === undefined) return null;
    const resolved = validateProgram(path, readRef.current);
    return { resolved, graph: buildGraph(resolved), ok: !hasErrors(resolved.issues) && resolved.doc !== null };
  }, [path, text]);

  const sim = useSimulation(model?.ok ? model.resolved : null);

  return (
    <div className={`${page.page} ${styles.page}`}>
      <ProgramPicker target={target} />
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

function ProgramPicker({ target }: { target: Target | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const programs = useWorkspace((s) => s.programs);
  const { menu } = useLocalMenu();
  const local = useProgramSource("local");
  const name = (path: string) => {
    try {
      const doc = JSON.parse(local.read(path) ?? "") as unknown;
      return isProgramFile(doc) ? doc.name : path;
    } catch {
      return path;
    }
  };
  const own = programs.map((p) => ({ value: `id:${p.id}`, label: String(p.json.name ?? p.path) }));
  const inMenu = menu.filter((p) => p !== INDEX_PATH && !isLibraryPath(p) && !programs.some((d) => d.path === p)).map((p) => ({ value: `path:${p}`, label: name(p) }));
  const current = target?.id ? `id:${target.id}` : target ? `path:${target.path}` : "";
  const known = [...own, ...inMenu].some((o) => o.value === current);

  return (
    <div className={styles.picker}>
      <label htmlFor="sim-program">{t("simulate.program")}</label>
      <select
        id="sim-program"
        value={current}
        onChange={(e) => {
          const [kind, rest] = [e.target.value.slice(0, e.target.value.indexOf(":")), e.target.value.slice(e.target.value.indexOf(":") + 1)];
          navigate(kind === "id" ? simulateUrl({ id: rest }) : simulateUrl({ source: "local", path: rest }), { replace: true });
        }}
      >
        {!known && target && <option value={current}>{name(target.path)}</option>}
        {own.length > 0 && (
          <optgroup label={t("programs.mine")}>
            {own.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        )}
        {inMenu.length > 0 && (
          <optgroup label={t("nav.menu")}>
            {inMenu.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {target?.id && (
        <Link className={styles.iconLink} to={editorUrl(target.id)} aria-label={t("simulate.openEditor")} title={t("simulate.openEditor")}>
          <Pencil size={18} aria-hidden />
        </Link>
      )}
    </div>
  );
}

/** Every pod of the program: an 18-LED ring with a big button (press and hold = long press). */
function Pods({ sim }: { sim: SimulationControls }) {
  const { t } = useTranslation();
  return (
    <section className={page.section} aria-label={t("simulate.pods")}>
      <ul className={styles.pods}>
        {sim.snapshot.pods.map((pod) => (
          <li key={pod.id}>
            <PodButton pod={pod} onPress={() => sim.press(pod.id)} onRelease={() => sim.release(pod.id)} />
          </li>
        ))}
      </ul>
      <p className={styles.hint}>{t("simulate.podsHint")}</p>
    </section>
  );
}

function PodButton({ pod, onPress, onRelease }: { pod: PodView; onPress: () => void; onRelease: () => void }) {
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
      <div className={styles.ring}>
        <LedRing colors={pod.leds} size={104} label={label} />
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
        />
      </div>
      <span className={styles.podLabel}>{label}</span>
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
  const { t } = useTranslation();
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
                  <td>{m.metric}</td>
                  <td>{m.count}</td>
                  <td>{m.average}</td>
                  <td>{m.best}</td>
                  <td>{m.worst}</td>
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
                .map((m) => `${m.ms} ms (${m.pod})`)
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
