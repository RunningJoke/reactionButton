import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useStore, type StoreApi } from "zustand";
import { FlaskConical, Maximize2, Pause, Play, Repeat, Square, Unplug, UserPlus, X } from "lucide-react";
import { useConnectDialog } from "../app/connectDialogStore";
import { useScreenWakeLock } from "../app/wakeLock";
import type { PodClient } from "../pod/client";
import { PodError } from "../pod/protocol";
import { SimulatedTransport } from "../pod/simulated/SimulatedTransport";
import { disconnectPod, hasFeature, setLabel, usePodSessions, type PodSession } from "../pod/session";
import { sendAthlete, sendCommand, sendPause, sendResume, sendStart, sendVariables, type CommandName } from "../results/podReports";
import { reportsOfSession, useResults } from "../results/results";
import type { StoredReport } from "../results/report";
import { formatMs, reportDuration, summarizeValues } from "../results/stats";
import { AthleteModal, sessionUrl } from "./ResultsPage";
import { useProgramName } from "./resultsUi";
import page from "./Page.module.css";
import styles from "./Results.module.css";
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

/**
 * Training view (#46, #87): a card for the connected set, on its own tab-less route `/training` (linked from
 * the Pod tab). One set at a time (several sets at once are on hold, see connectPod). Each card shows the set's state, athlete, last report and the controls of the game.
 * The screen stays on while the view is open (wake lock, see wakeLock.ts).
 */
export function TrainingPage() {
  const { t } = useTranslation();
  const entries = usePodSessions((s) => s.entries);
  const showConnect = useConnectDialog((s) => s.show);
  const load = useResults((s) => s.load);
  useEffect(() => void load(), [load]);
  useScreenWakeLock(entries.length > 0);

  return (
    <div className={page.page}>
      <section className={page.section} aria-labelledby="training-title">
        <div className={styles.heading}>
          <h2 id="training-title">{t("training.view.title")}</h2>
        </div>
        <p className={styles.muted}>{t("training.view.intro")}</p>
        {entries.length === 0 ? (
          <div className={page.empty}>
            <p>{t("training.view.empty")}</p>
            <button className={`${page.bigButton} ${page.primary}`} onClick={showConnect}>
              {t("training.view.connect")}
            </button>
          </div>
        ) : (
          <div className={view.cards}>
            {entries.map((entry) => (
              <SetCard key={entry.id} store={entry.store} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SetCard({ store }: { store: StoreApi<PodSession> }) {
  const { t, i18n } = useTranslation();
  const session = useStore(store, (s) => s);
  const errorText = (e: unknown) => {
    const code = e instanceof PodError ? e.code : "";
    if ((ERROR_CODES as string[]).includes(code)) return t(`training.errors.${code}`);
    return e instanceof Error ? e.message : String(e);
  };
  const { id, info, client, role, state, status, queued, queueError } = session;
  const athletes = useResults((s) => s.athletes);
  const sessions = useResults((s) => s.sessions);
  const reports = useResults((s) => s.reports);
  const sets = useResults((s) => s.sets);
  const programName = useProgramName();
  const [adding, setAdding] = useState(false);
  const [big, setBig] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const setId = info?.setId.toLowerCase() ?? "";
  const setState = setId ? sets[setId] : undefined;
  const reportSession = setState?.sessionId ? sessions.find((s) => s.id === setState.sessionId) : undefined;
  const list = reportSession ? reportsOfSession(reports, reportSession.id) : [];
  const kept = list.filter((r) => !r.discarded);
  const last = list.at(-1);

  const connected = state === "connected" && client !== null;
  const central = role === "central";
  const reportsOn = hasFeature(info, "reports");
  const remote = hasFeature(info, "remote");
  const pauseOn = hasFeature(info, "pause");
  const canCommand = connected && central && remote;
  const waiting = status?.waiting;
  // the start variables exist from firmware 2.17 (feature `startVars`); older firmware: no steppers
  const startEditable = hasFeature(info, "startVars") ? (status?.ready?.editable ?? {}) : {};

  const stateLabel =
    state === "connected"
      ? t(`training.view.state.${status?.state ?? "unknown"}`, { defaultValue: t("training.view.state.unknown") })
      : t(`training.view.state.${state}`);

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
      await sendCommand(c, name);
      if (name === "repeat") await useResults.getState().discardLast(setId);
    }, t(`training.sent.${name}`));

  /** While a block waits the command is sent now; otherwise it waits for the next block (one pending command). */
  const press = (name: CommandName) => (waiting ? void command(name) : store.getState().queueCommand(name));

  const start = (changes: Record<string, number>) =>
    run(async (c) => {
      if (Object.keys(changes).length > 0) await sendVariables(c, changes);
      await sendStart(c);
    });

  const demoPod = client?.transport instanceof SimulatedTransport ? client.transport.pod : null;

  return (
    <article className={view.card} data-state={state} aria-labelledby={`card-${id}`}>
      <header className={view.header}>
        <h3 id={`card-${id}`} className={view.title}>
          {setLabel(session) ?? t("training.view.connecting")}
        </h3>
        <div className={view.badges}>
          <span className={view.badge} data-tone={state === "connected" ? "ok" : "pending"}>
            {stateLabel}
          </span>
          {waiting && <span className={view.badge} data-tone="accent">{t("training.view.waiting")}</span>}
        </div>
      </header>

      {connected && !reportsOn && <p className={styles.warn}>{t("training.view.oldFirmware")}</p>}
      {connected && reportsOn && !remote && <p className={styles.muted}>{t("training.noRemote")}</p>}
      {connected && !hasFeature(info, "liveBle") && <p className={styles.muted}>{t("training.view.noLiveBle")}</p>}

      <label className={styles.field}>
        {t("training.athlete")}
        <select
          className={styles.select}
          value={setState?.athleteId ?? ""}
          disabled={!setId || busy}
          onChange={(e) => void assign(e.target.value || null)}
        >
          <option value="">{t("results.nobody")}</option>
          {athletes.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <button className={styles.button} onClick={() => setAdding(true)} disabled={!setId}>
        <UserPlus size={18} aria-hidden /> {t("results.addAthlete")}
      </button>

      {connected && central && status?.state === "CONFIRM" && (
        <StartCard editable={startEditable} canStart={remote} busy={busy} onStart={(changes) => void start(changes)} />
      )}

      <div className={view.last} aria-live="polite">
        {last && reportSession ? (
          <>
            <span className={styles.name}>
              {programName(reportSession.programPath)} · {t("results.reportCount", { count: kept.length })}
            </span>
            <span className={styles.meta}>
              <span>{last.cycle !== undefined ? t("results.cycle", { cycle: last.cycle }) : t("training.lastReport")}</span>
              {reportDuration(last) !== undefined && <span>{formatMs(reportDuration(last)!, i18n.language)}</span>}
              {summarizeValues(last.values)
                .filter((m) => m.metric !== "lap")
                .slice(0, 2)
                .map((m) => (
                  <span key={m.metric}>
                    {t("training.bestAverage", { metric: m.metric, best: formatMs(m.best, i18n.language), average: formatMs(m.average, i18n.language) })}
                  </span>
                ))}
            </span>
            <Link to={sessionUrl(reportSession.id)} className={view.link}>
              {t("training.openSession")}
            </Link>
            <button className={styles.button} aria-pressed={big} onClick={() => setBig(!big)}>
              <Maximize2 size={18} aria-hidden /> {t("training.view.bigNumbers")}
            </button>
            {big && <BigNumbers reports={kept} />}
          </>
        ) : (
          <span className={styles.muted}>{t("training.waiting")}</span>
        )}
      </div>

      {canCommand && waiting && (
        <div className={view.panel}>
          <p className={view.panelTitle}>{t("training.view.waitingFor", { block: waiting.block })}</p>
          {Object.entries(waiting.editable).map(([name, range]) => (
            <VariableInput
              key={name}
              name={name}
              min={range.min}
              max={range.max}
              value={range.value}
              disabled={busy}
              onSet={(n) => void run((c) => sendVariables(c, { [name]: n }), t("training.view.variablesSent"))}
            />
          ))}
        </div>
      )}

      {canCommand && (waiting || status?.state === "RUN") && (
        <div className={styles.row}>
          <button className={`${styles.button} ${styles.primary}`} disabled={busy} onClick={() => press("continue")}>
            <Play size={18} aria-hidden /> {t("training.continue")}
          </button>
          <button className={styles.button} disabled={busy} onClick={() => press("repeat")}>
            <Repeat size={18} aria-hidden /> {t("training.repeat")}
          </button>
          <button className={styles.button} disabled={busy} onClick={() => press("stop")}>
            <Square size={18} aria-hidden /> {t("training.stop")}
          </button>
        </div>
      )}
      {queued && (
        <div className={view.queued} role="status">
          <span>{t("training.view.queued", { command: t(`training.${queued}`) })}</span>
          <button className={styles.button} onClick={() => store.getState().cancelQueued()}>
            <X size={18} aria-hidden /> {t("training.view.cancel")}
          </button>
        </div>
      )}
      {queueError && (
        <p className={styles.status} data-tone="error" role="status">
          {errorText(queueError)}
        </p>
      )}

      {canCommand && pauseOn && (status?.phonePaused || status?.state === "RUN") && (
        <div className={styles.row}>
          {status?.phonePaused ? (
            <button className={`${styles.button} ${styles.primary}`} disabled={busy} onClick={() => void run(sendResume, t("training.view.resumedSent"))}>
              <Play size={18} aria-hidden /> {t("training.view.resume")}
            </button>
          ) : (
            <button className={styles.button} disabled={busy} onClick={() => void run(sendPause, t("training.view.pausedSent"))}>
              <Pause size={18} aria-hidden /> {t("training.view.pause")}
            </button>
          )}
        </div>
      )}

      {demoPod && connected && (
        <div className={styles.row}>
          {status?.state === "MENU" && (
            <button className={styles.button} disabled={busy} onClick={() => void run(async () => void demoPod.emitReady())}>
              <FlaskConical size={18} aria-hidden /> {t("training.demoReady")}
            </button>
          )}
          <button className={styles.button} disabled={busy} onClick={() => void run(async () => void demoPod.emitSampleReport())}>
            <FlaskConical size={18} aria-hidden /> {t("training.demoReport")}
          </button>
        </div>
      )}

      <div className={styles.row}>
        <button className={`${styles.button} ${styles.danger}`} onClick={() => void disconnectPod(id)}>
          <Unplug size={18} aria-hidden /> {t("pod.disconnect")}
        </button>
      </div>

      {message && (
        <p className={styles.status} data-tone={message.tone} role="status">
          {message.text}
        </p>
      )}
      <AthleteModal open={adding} onClose={() => setAdding(false)} onSaved={(a) => void assign(a.id)} />
    </article>
  );
}

/** The main metric of the athlete's view: `reaction`, else the first recorded metric (not the lap timer). */
function mainMetric(reports: readonly StoredReport[]): string | undefined {
  const metrics = reports.flatMap((r) => r.values.map((v) => v.metric));
  return metrics.includes("reaction") ? "reaction" : metrics.find((m) => m !== "lap");
}

/** The last value and the average of the main metric, in large figures for the athlete at 2 m (#87). */
function BigNumbers({ reports }: { reports: readonly StoredReport[] }) {
  const { t } = useTranslation();
  const metric = mainMetric(reports);
  const values = reports.flatMap((r) => r.values.filter((v) => v.metric === metric).map((v) => v.ms));
  if (!metric || values.length === 0) return <p className={styles.muted}>{t("training.view.noValues")}</p>;
  const average = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  return (
    <div className={view.big}>
      <span className={view.bigMetric}>{metric}</span>
      <div className={view.bigPair}>
        <span className={view.bigLabel}>{t("training.view.bigLast")}</span>
        <span className={view.bigValue}>
          {values.at(-1)} <small>{t("training.view.ms")}</small>
        </span>
      </div>
      <div className={view.bigPair}>
        <span className={view.bigLabel}>{t("training.view.bigAverage")}</span>
        <span className={view.bigValue}>
          {average} <small>{t("training.view.ms")}</small>
        </span>
      </div>
    </div>
  );
}

/** A whole number within the range, or null (the draft of a stepper). */
function wholeIn(draft: string, min: number, max: number): number | null {
  const n = Number(draft);
  return draft.trim() !== "" && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** The start card in CONFIRM (#87): the editable variables as steppers, then Start (`setVariables` if changed, `start`). */
function StartCard({
  editable,
  canStart,
  busy,
  onStart,
}: {
  editable: Record<string, { min: number; max: number; value: number }>;
  canStart: boolean;
  busy: boolean;
  onStart: (changes: Record<string, number>) => void;
}) {
  const { t } = useTranslation();
  const names = Object.keys(editable);
  const [drafts, setDrafts] = useState(() => Object.fromEntries(names.map((n) => [n, String(editable[n]!.value)])));
  const [invalid, setInvalid] = useState<string[]>([]);

  if (!canStart) return <p className={styles.muted}>{t("training.view.pressToStart")}</p>;

  const start = () => {
    const changes: Record<string, number> = {};
    const bad: string[] = [];
    for (const name of names) {
      const range = editable[name]!;
      const n = wholeIn(drafts[name] ?? "", range.min, range.max);
      if (n === null) bad.push(name);
      else if (n !== range.value) changes[name] = n;
    }
    setInvalid(bad);
    if (bad.length === 0) onStart(changes);
  };

  return (
    <div className={view.panel}>
      <p className={view.panelTitle}>{t("training.view.readyTitle")}</p>
      {names.map((name) => (
        <div key={name} className={view.field}>
          <VariableField
            name={name}
            min={editable[name]!.min}
            max={editable[name]!.max}
            draft={drafts[name] ?? ""}
            invalid={invalid.includes(name)}
            onDraft={(draft) => setDrafts({ ...drafts, [name]: draft })}
          />
        </div>
      ))}
      <button className={`${styles.button} ${styles.primary}`} disabled={busy} onClick={start}>
        <Play size={18} aria-hidden /> {t("training.view.start")}
      </button>
    </div>
  );
}

/** One editable variable: a whole number input with its range; the error text when the draft is refused. */
function VariableField({
  name,
  min,
  max,
  draft,
  invalid,
  onDraft,
}: {
  name: string;
  min: number;
  max: number;
  draft: string;
  invalid: boolean;
  onDraft: (draft: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <label className={styles.field}>
        <span>
          {name} <span className={styles.muted}>{t("training.view.range", { min, max })}</span>
        </span>
        <input
          className={styles.input}
          type="number"
          inputMode="numeric"
          step={1}
          min={min}
          max={max}
          value={draft}
          aria-invalid={invalid || undefined}
          onChange={(e) => onDraft(e.target.value)}
        />
      </label>
      {invalid && (
        <p className={view.error} role="alert">
          {t("training.view.invalid", { min, max })}
        </p>
      )}
    </>
  );
}

/** One editable variable of a waiting `communicate` block: sent with its own Set button (range checked first). */
function VariableInput({
  name,
  min,
  max,
  value,
  disabled,
  onSet,
}: {
  name: string;
  min: number;
  max: number;
  value: number;
  disabled: boolean;
  onSet: (n: number) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setDraft(String(value)), [value]);

  const submit = () => {
    const n = wholeIn(draft, min, max);
    setInvalid(n === null);
    if (n !== null) onSet(n);
  };

  return (
    <div className={view.variable}>
      <VariableField name={name} min={min} max={max} draft={draft} invalid={invalid} onDraft={setDraft} />
      <button className={styles.button} disabled={disabled} onClick={submit}>
        {t("training.view.setVariable")}
      </button>
    </div>
  );
}
