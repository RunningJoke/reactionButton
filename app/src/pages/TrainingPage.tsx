import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useStore, type StoreApi } from "zustand";
import { ChevronRight, Minus, Pause, Play, Plug, Plus, Repeat, Square, X } from "lucide-react";
import { useConnectDialog } from "../app/connectDialogStore";
import { useScreenWakeLock } from "../app/wakeLock";
import { LED_COUNT } from "@reactpod/program-model";
import { LedRing } from "../components/LedRing";
import { Named } from "../components/Named";
import { Split, useDesktop } from "../components/Split";
import type { PodClient } from "../pod/client";
import { PodError } from "../pod/protocol";
import { hasFeature, setLabel, usePodSessions, type PodSession } from "../pod/session";
import { sendAthlete, sendCommand, sendPause, sendResume, sendStart, sendVariables, type CommandName } from "../results/podReports";
import { reportsOfSession, useResults } from "../results/results";
import type { StoredReport, TrainingSession } from "../results/report";
import { athleteProgress, formatMs, summarizeValues } from "../results/stats";
import { isMsSetting, labelOf } from "../editor/settingLabels";
import { AthleteModal, sessionUrl } from "./ResultsPage";
import { ChangeChip, TrendBars, useProgramName } from "./resultsUi";
import page from "./Page.module.css";
import view from "./TrainingPage.module.css";

/** Error codes with a text under `training.errors` (every firmware code, config-api.md §3, and the app's own). */
export const ERROR_CODES = [
  "bad_request",
  "bad_path",
  "not_found",
  "bad_offset",
  "too_large",
  "crc_mismatch",
  "invalid_json",
  "invalid_program",
  "storage",
  "overflow",
  "busy",
  "not_ready",
  "not_editable",
  "out_of_range",
  "not_running",
  "not_paused",
  "auth_required",
  "auth_failed",
  "low_battery",
  "timeout",
  "disconnected",
  "protocol",
];

/** Athlete chips shown before "More". */
const VISIBLE_ATHLETES = 4;

const HINT_KEY = "reactpod.hint.keepOpen";

type Editable = Record<string, { min: number; max: number; value: number }>;

/**
 * The live training surface (#46, #87, #106): the state of the connected set, who trains, the last round
 * result, the editable variables and the controls, on `/train`. One set at a time (several sets at once are
 * on hold, see connectPod). The screen stays on while a set is connected (wake lock, see wakeLock.ts).
 */
export function TrainingPage() {
  const entries = usePodSessions((s) => s.entries);
  const load = useResults((s) => s.load);
  useEffect(() => void load(), [load]);
  useScreenWakeLock(entries.length > 0);

  return (
    <div className={`${page.page} ${page.wide}`}>
      <div className={view.surface}>
        {entries.length === 0 ? (
          <ConnectGuide />
        ) : (
          entries.map((entry) => <SetCard key={entry.id} store={entry.store} />)
        )}
      </div>
    </div>
  );
}

/** Not connected: the puck, the three steps to connect by Bluetooth, the one primary action. */
function ConnectGuide() {
  const { t } = useTranslation();
  const showConnect = useConnectDialog((s) => s.show);
  return (
    <section className={view.guide} aria-labelledby="guide-title">
      <LedRing size={96} />
      <h2 id="guide-title" className={view.guideTitle}>
        {t("training.guide.title")}
      </h2>
      <p className={view.muted}>{t("training.guide.intro")}</p>
      <ol className={view.steps}>
        {[1, 2, 3].map((n) => (
          <li key={n}>{t(`training.guide.step${n}`)}</li>
        ))}
      </ol>
      <button className={`${view.button} ${view.primary} ${view.big}`} onClick={showConnect}>
        <Plug size={20} aria-hidden /> {t("training.guide.connect")}
      </button>
      <KeepOpenHint />
    </section>
  );
}

/** The "keep the app open" caveat: shown until it is dismissed once (browser storage may be missing). */
function KeepOpenHint() {
  const { t } = useTranslation();
  const [shown, setShown] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) !== "1";
    } catch {
      return true;
    }
  });
  if (!shown) return null;
  const dismiss = () => {
    setShown(false);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      // no storage: the hint comes back next time
    }
  };
  return (
    <div className={view.hint} role="note">
      <p>{t("training.hint.keepOpen")}</p>
      <button className={view.textButton} onClick={dismiss}>
        {t("training.hint.dismiss")}
      </button>
    </div>
  );
}

/** Light colour of the state pill (pod-light colours: running green, waiting blue, paused yellow). */
type Tone = "green" | "blue" | "yellow" | "neutral" | "error";

/** The puck shows the same state colour as the pill (pod colours, see colorToRgb); neutral = dark. */
const TONE_LED: Record<Tone, string | undefined> = { green: "green", blue: "blue", yellow: "yellow", error: "red", neutral: undefined };

function SetCard({ store }: { store: StoreApi<PodSession> }) {
  const { t, i18n } = useTranslation();
  const session = useStore(store, (s) => s);
  const errorText = (e: unknown) => {
    const code = e instanceof PodError ? e.code : "";
    if ((ERROR_CODES as string[]).includes(code)) return t(`training.errors.${code}`);
    return e instanceof Error ? e.message : String(e);
  };
  const { info, client, role, state, status, queued, queueError } = session;
  const athletes = useResults((s) => s.athletes);
  const sessions = useResults((s) => s.sessions);
  const reports = useResults((s) => s.reports);
  const sets = useResults((s) => s.sets);
  const programName = useProgramName();
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // values the user changed, by variable name; they go out together with Continue / Start
  const [draft, setDraft] = useState<Record<string, number>>({});

  const setId = info?.setId.toLowerCase() ?? "";
  const setState = setId ? sets[setId] : undefined;
  const reportSession = setState?.sessionId ? sessions.find((s) => s.id === setState.sessionId) : undefined;
  const kept = reportSession ? reportsOfSession(reports, reportSession.id).filter((r) => !r.discarded) : [];

  const connected = state === "connected" && client !== null;
  const central = role === "central";
  const reportsOn = hasFeature(info, "reports");
  const remote = hasFeature(info, "remote");
  const pauseOn = hasFeature(info, "pause");
  const canCommand = connected && central && remote;
  const waiting = status?.waiting;
  const podState = status?.state;
  const paused = status?.phonePaused === true || podState === "PAUSED";
  const ready = connected && central && podState === "CONFIRM";
  // the start variables exist from firmware 2.17 (feature `startVars`); older firmware: no steppers
  const editable: Editable = (ready ? (hasFeature(info, "startVars") ? status?.ready?.editable : undefined) : waiting?.editable) ?? {};
  const signature = JSON.stringify(editable);
  useEffect(() => setDraft({}), [signature]);
  const changes = Object.fromEntries(Object.entries(draft).filter(([name, n]) => n !== editable[name]?.value));
  const changed = Object.keys(changes).length > 0;

  const assign = async (athleteId: string | null) => {
    setMessage(null);
    if (canCommand && client) {
      try {
        await sendAthlete(client, athleteId ?? "");
      } catch (e) {
        setMessage({ tone: "error", text: errorText(e) });
        return; // the pod keeps the old athlete, so does the app
      }
    }
    if (setId) await useResults.getState().assign(setId, athleteId);
  };

  /**
   * Runs one user command to this set's pod, then reads the status. A timed-out command may have been
   * applied: it is not shown as failed, the status shows the real state (#87).
   */
  const run = async (action: (c: PodClient) => Promise<unknown>, okText?: string) => {
    if (!client) return;
    setBusy(true);
    setMessage(null);
    try {
      await action(client);
      if (okText) setMessage({ tone: "ok", text: okText });
    } catch (e) {
      if (!(e instanceof PodError && e.code === "timeout")) setMessage({ tone: "error", text: errorText(e) });
    } finally {
      await store.getState().refreshStatus();
      setBusy(false);
    }
  };

  const command = (name: CommandName) =>
    run(async (c) => {
      if (name === "continue" && changed) await sendVariables(c, changes);
      await sendCommand(c, name);
      if (name === "repeat") await useResults.getState().discardLast(setId);
    }, t(`training.sent.${name}`));

  /** While a block waits the command is sent now; otherwise it waits for the next block (one pending command). */
  const press = (name: CommandName) => (waiting ? void command(name) : store.getState().queueCommand(name));

  const start = () =>
    run(async (c) => {
      if (changed) await sendVariables(c, changes);
      await sendStart(c);
    });

  // ---- header
  const waitingForYou = connected && !!waiting;
  const [tone, pill]: [Tone, string] =
    state !== "connected"
      ? ["neutral", t(`training.view.state.${state}`)]
      : waitingForYou
        ? ["blue", t("training.view.waiting")]
        : [
            { RUN: "green", PAUSED: "yellow", CONFIRM: "blue", ERROR: "error" }[podState ?? ""] as Tone | undefined ?? "neutral",
            t(`training.view.state.${podState ?? "unknown"}`, { defaultValue: t("training.view.state.unknown") }),
          ];
  const last = kept.at(-1);
  const max = waiting?.editable.MAX_LOOPS?.value ?? last?.vars.MAX_LOOPS;
  const round = last?.cycle !== undefined ? last.cycle + (waiting || podState !== "RUN" ? 0 : 1) : undefined;
  const nowLine =
    state !== "connected"
      ? t("training.view.nowOffline")
      : waiting
        ? t("training.view.waitingFor", { block: waiting.block })
        : paused
          ? t("training.view.nowPaused")
          : podState === "RUN"
            ? t("training.view.nowRun")
            : podState === "CONFIRM"
              ? remote
                ? t("training.view.readyTitle")
                : t("training.view.pressToStart")
              : podState === "ERROR"
                ? t("training.view.nowError")
                : podState === "DISCOVERY"
                  ? t("training.view.nowDiscovery")
                  : t("training.view.nowMenu");

  // ---- athletes: most recent first, the selected one always visible
  const [all, setAll] = useState(false);
  const selected = setState?.athleteId ?? null;
  const ordered = useMemo(() => {
    const used = new Map<string, number>();
    for (const s of sessions) if (s.athleteId) used.set(s.athleteId, Math.max(used.get(s.athleteId) ?? 0, s.startedAt));
    return [...athletes].sort((a, b) => (used.get(b.id) ?? b.createdAt) - (used.get(a.id) ?? a.createdAt));
  }, [athletes, sessions]);
  const visible = all ? ordered : ordered.slice(0, VISIBLE_ATHLETES);
  const shown = selected && !visible.some((a) => a.id === selected) ? [...visible.slice(0, -1), ...ordered.filter((a) => a.id === selected)] : visible;

  const showBar = canCommand && (ready || paused || podState === "RUN" || !!waiting);

  // desktop: the last round and the athlete's progress sit in the right column; phone: the last round stays in the flow
  const desktop = useDesktop();
  const lastSection = (
    <section className={view.block} aria-labelledby="last-title" aria-live="polite">
      <h3 id="last-title" className={view.blockTitle}>
        {t("training.last.title")}
      </h3>
      {last && reportSession ? <LastRound kept={kept} sessionId={reportSession.id} language={i18n.language} /> : <p className={view.muted}>{t("training.last.none")}</p>}
    </section>
  );
  const athleteSessions = sessions.filter((s) => s.athleteId === selected);
  const progressSection = (
    <section className={view.block} aria-labelledby="progress-title">
      <h3 id="progress-title" className={view.blockTitle}>
        {t("training.progress.title")}
      </h3>
      {selected ? <AthleteProgress sessions={athleteSessions} reports={reports} /> : <p className={view.muted}>{t("training.who.hint")}</p>}
    </section>
  );

  return (
    <article className={view.card} data-state={state} aria-label={setLabel(session) ?? t("training.view.connecting")}>
      <Split sideOnPhone={false} side={desktop ? <div className={view.card}>{lastSection}{progressSection}</div> : null}>
        <div className={view.card}>
          <section className={view.stateCard} aria-live="polite">
            <LedRing size={64} colors={TONE_LED[tone] ? Array(LED_COUNT).fill(TONE_LED[tone]) : undefined} />
            <div className={view.stateText}>
              <span className={view.pill} data-tone={tone}>
                <span className={view.dot} aria-hidden />
                {pill}
              </span>
              <h2 className={view.game}>
                {reportSession ? programName(reportSession.programPath) : (setLabel(session) ?? t("training.view.connecting"))}
              </h2>
              <p className={view.now}>{nowLine}</p>
              {round !== undefined && max !== undefined && podState !== "MENU" && (
                <p className={view.round}>{t("training.view.round", { n: round, max })}</p>
              )}
            </div>
          </section>
    
          {connected && !reportsOn && <p className={view.warn}>{t("training.view.oldFirmware")}</p>}
          {connected && reportsOn && !remote && <p className={view.muted}>{t("training.noRemote")}</p>}
          {connected && !hasFeature(info, "liveBle") && <p className={view.muted}>{t("training.view.noLiveBle")}</p>}
    
          <section className={view.block} aria-labelledby="who-title">
            <h3 id="who-title" className={view.blockTitle}>
              {t("training.who.title")}
            </h3>
            <div className={view.chips} role="group" aria-labelledby="who-title">
              {shown.map((a) => (
                <button
                  key={a.id}
                  className={view.chip}
                  aria-pressed={a.id === selected}
                  disabled={!setId || busy}
                  onClick={() => void assign(a.id === selected ? null : a.id)}
                >
                  {a.name}
                </button>
              ))}
              {ordered.length > VISIBLE_ATHLETES && (
                <button className={view.chip} data-quiet aria-expanded={all} onClick={() => setAll(!all)}>
                  {all ? t("training.who.fewer") : t("training.who.more", { count: ordered.length - VISIBLE_ATHLETES })}
                </button>
              )}
              <button className={view.chip} data-add disabled={!setId} onClick={() => setAdding(true)}>
                <Plus size={16} aria-hidden /> {t("results.addAthlete")}
              </button>
            </div>
            {!selected && <p className={view.muted}>{t("training.who.hint")}</p>}
          </section>
    
          {!desktop && lastSection}
    
          {canCommand && Object.keys(editable).length > 0 && (
            <section className={`${view.block} ${view.vars}`} aria-labelledby="vars-title">
              <h3 id="vars-title" className={view.blockTitle}>
                {t("training.vars.title")}
              </h3>
              {Object.entries(editable).map(([name, range]) => (
                <Stepper
                  key={name}
                  name={name}
                  min={range.min}
                  max={range.max}
                  value={draft[name] ?? range.value}
                  changed={name in changes}
                  applyKey={ready ? "Start" : "Continue"}
                  disabled={busy}
                  onChange={(n) => setDraft({ ...draft, [name]: n })}
                />
              ))}
            </section>
          )}
    
          {queued && (
            <div className={view.queued} role="status">
              <span>{t("training.view.queued", { command: t(`training.${queued}`) })}</span>
              <button className={view.button} onClick={() => store.getState().cancelQueued()}>
                <X size={18} aria-hidden /> {t("training.view.cancel")}
              </button>
            </div>
          )}
          {queueError && (
            <p className={view.status} data-tone="error" role="status">
              {errorText(queueError)}
            </p>
          )}
          {message && (
            <p className={view.status} data-tone={message.tone} role="status">
              {message.text}
            </p>
          )}
    
          <KeepOpenHint />
    
          {showBar && (
            <div className={view.bar}>
              {ready ? (
                <button className={`${view.button} ${view.primary} ${view.main}`} disabled={busy} onClick={() => void start()}>
                  <Play size={20} aria-hidden /> {changed ? t("training.view.startWith") : t("training.view.start")}
                </button>
              ) : paused ? (
                <button className={`${view.button} ${view.primary} ${view.main}`} disabled={busy} onClick={() => void run(sendResume, t("training.view.resumedSent"))}>
                  <Play size={20} aria-hidden /> {t("training.view.resume")}
                </button>
              ) : (
                <>
                  <button className={`${view.button} ${view.primary} ${view.main}`} disabled={busy} onClick={() => press("continue")}>
                    <Play size={20} aria-hidden /> {changed ? t("training.continueWith") : t("training.continue")}
                  </button>
                  <div className={view.actions}>
                    <Action id="repeat" caption={t("training.cap.repeat")} title={t("training.cap.repeatLong")}>
                      <button className={view.button} disabled={busy} onClick={() => press("repeat")} aria-describedby="cap-repeat">
                        <Repeat size={18} aria-hidden /> {t("training.repeat")}
                      </button>
                    </Action>
                    {pauseOn && (
                      <Action caption={t("training.cap.pause")} id="pause">
                        <button
                          className={view.button}
                          disabled={busy}
                          aria-describedby="cap-pause"
                          onClick={() => void run(sendPause, t("training.view.pausedSent"))}
                        >
                          <Pause size={18} aria-hidden /> {t("training.view.pause")}
                        </button>
                      </Action>
                    )}
                    <Action caption={t("training.cap.stop")} id="stop">
                      <button className={`${view.button} ${view.danger}`} disabled={busy} onClick={() => press("stop")} aria-describedby="cap-stop">
                        <Square size={18} aria-hidden /> {t("training.stop")}
                      </button>
                    </Action>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </Split>
      <AthleteModal open={adding} onClose={() => setAdding(false)} onSaved={(a) => void assign(a.id)} />
    </article>
  );
}

/** A control with its short caption under it (linked with aria-describedby: `cap-<id>`). */
function Action({ caption, id, title, children }: { caption: string; id: string; title?: string; children: React.ReactNode }) {
  return (
    <div className={view.action} title={title}>
      {children}
      <small id={`cap-${id}`} className={view.caption}>
        {caption}
      </small>
    </div>
  );
}

/** The main metric: `reaction`, else the first recorded metric (not the lap timer). */
function mainMetric(report: StoredReport): string | undefined {
  const metrics = report.values.map((v) => v.metric);
  return metrics.includes("reaction") ? "reaction" : metrics.find((m) => m !== "lap");
}

/** Best and average of the last round's main metric as large figures, the change to the round before, a link to the session. */
function LastRound({ kept, sessionId, language }: { kept: readonly StoredReport[]; sessionId: string; language: string }) {
  const { t } = useTranslation();
  const last = kept.at(-1)!;
  const metric = mainMetric(last);
  const of = (r: StoredReport | undefined) => (r && metric ? summarizeValues(r.values.filter((v) => v.metric === metric))[0] : undefined);
  const now = of(last);
  const before = of(kept.at(-2));
  const diff = now && before ? now.average - before.average : undefined;
  return (
    <>
      {now && metric ? (
        <>
          <p className={view.metric}>{labelOf(metric, t)}</p>
          <div className={view.figures}>
            <div>
              <span className={view.figureLabel}>{t("training.last.best")}</span>
              <span className={view.figure}>{formatMs(now.best, language)}</span>
            </div>
            <div>
              <span className={view.figureLabel}>{t("training.last.average")}</span>
              <span className={view.figure}>{formatMs(now.average, language)}</span>
            </div>
          </div>
          {diff !== undefined && (
            <p className={view.change} data-tone={diff < 0 ? "good" : diff > 0 ? "bad" : undefined}>
              {diff === 0
                ? t("training.last.same")
                : t(diff < 0 ? "training.last.faster" : "training.last.slower", { diff: formatMs(Math.abs(diff), language) })}
            </p>
          )}
        </>
      ) : (
        <p className={view.muted}>{t("training.last.noValues")}</p>
      )}
      <Link to={sessionUrl(sessionId)} className={view.link}>
        {t("training.last.all")} <ChevronRight size={18} aria-hidden />
      </Link>
    </>
  );
}

/** The athlete's average trend over all trainings, the change to the one before, the personal best (as on the athlete page). */
function AthleteProgress({ sessions, reports }: { sessions: readonly TrainingSession[]; reports: readonly StoredReport[] }) {
  const { t, i18n } = useTranslation();
  const progress = athleteProgress(sessions, reports);
  const latest = progress.points.at(-1);
  if (!latest || !progress.metric) return <p className={view.muted}>{t("results.noValues")}</p>;
  return (
    <>
      <span className={view.figureLabel}>
        <Named name={progress.metric} /> · {t("results.latestAverage")}
      </span>
      <span className={view.figure}>{formatMs(latest.average, i18n.language)}</span>
      <ChangeChip change={progress.change} />
      <TrendBars progress={progress} />
      {progress.best && (
        <span className={view.figureLabel}>
          {t("results.personalBest", { value: formatMs(progress.best.ms, i18n.language), date: new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(progress.best.at) })}
        </span>
      )}
    </>
  );
}

/** One editable variable as − value +(times in 0.1 s steps, counts in 1); the new value is sent with Continue / Start. */
function Stepper({
  name,
  min,
  max,
  value,
  changed,
  applyKey,
  disabled,
  onChange,
}: {
  name: string;
  min: number;
  max: number;
  value: number;
  changed: boolean;
  applyKey: "Start" | "Continue";
  disabled: boolean;
  onChange: (n: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const secs = isMsSetting(name);
  const step = secs ? 100 : 1;
  const label = labelOf(name, t);
  const set = (n: number) => onChange(Math.min(max, Math.max(min, n)));
  return (
    <div className={view.field}>
      <span id={`var-${name}`} className={view.fieldLabel}>
        <Named name={name} />
      </span>
      <div className={view.stepper} role="group" aria-labelledby={`var-${name}`}>
        <button className={view.step} disabled={disabled || value <= min} aria-label={t("training.vars.less", { name: label })} onClick={() => set(value - step)}>
          <Minus size={20} aria-hidden />
        </button>
        <output className={view.value} aria-live="polite">
          {secs ? formatMs(value, i18n.language) : value}
        </output>
        <button className={view.step} disabled={disabled || value >= max} aria-label={t("training.vars.more", { name: label })} onClick={() => set(value + step)}>
          <Plus size={20} aria-hidden />
        </button>
        {changed && <span className={view.changed}>{t(`training.vars.changed${applyKey}`)}</span>}
      </div>
    </div>
  );
}
