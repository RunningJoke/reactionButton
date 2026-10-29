import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useStore, type StoreApi } from "zustand";
import { Pause, Play, Repeat, Square, Unplug, UserPlus } from "lucide-react";
import { useConnectDialog } from "../app/connectDialogStore";
import { useScreenWakeLock } from "../app/wakeLock";
import type { PodClient } from "../pod/client";
import { PodError } from "../pod/protocol";
import { disconnectPod, hasFeature, setLabel, usePodSessions, type PodSession } from "../pod/session";
import { sendAthlete, sendCommand, sendPause, sendResume, sendVariables, type CommandName } from "../results/podReports";
import { reportsOfSession, useResults } from "../results/results";
import { formatMs, reportDuration, summarizeValues } from "../results/stats";
import { AthleteModal, sessionUrl } from "./ResultsPage";
import { useProgramName } from "./resultsUi";
import page from "./Page.module.css";
import styles from "./Results.module.css";
import view from "./TrainingPage.module.css";

/**
 * Training view (#46): a card for the connected set, on its own tab-less route `/training` (linked from
 * the Pod tab). One set at a time (several sets at once are on hold, see connectPod). Each card shows the set's state, athlete, last report and, while a `communicate` block
 * waits, the controls for it. The screen stays on while the view is open (wake lock, see wakeLock.ts).
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
    if (["busy", "not_ready", "timeout", "disconnected", "not_running", "not_paused", "out_of_range"].includes(code)) {
      return t(`training.errors.${code}`);
    }
    return e instanceof Error ? e.message : String(e);
  };
  const { id, info, client, role, state, status } = session;
  const athletes = useResults((s) => s.athletes);
  const sessions = useResults((s) => s.sessions);
  const reports = useResults((s) => s.reports);
  const sets = useResults((s) => s.sets);
  const programName = useProgramName();
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const setId = info?.setId.toLowerCase() ?? "";
  const setState = setId ? sets[setId] : undefined;
  const reportSession = setState?.sessionId ? sessions.find((s) => s.id === setState.sessionId) : undefined;
  const list = reportSession ? reportsOfSession(reports, reportSession.id) : [];
  const last = list.at(-1);

  const connected = state === "connected" && client !== null;
  const central = role === "central";
  const reportsOn = hasFeature(info, "reports");
  const remote = hasFeature(info, "remote");
  const pauseOn = hasFeature(info, "pause");
  const canCommand = connected && central && remote;
  const waiting = status?.waiting;

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

  /** Runs one request to this set's pod and refreshes the status afterwards. */
  const run = async (action: (c: PodClient) => Promise<unknown>, okText?: string) => {
    if (!client) return;
    setBusy(true);
    setMessage(null);
    try {
      await action(client);
      await store.getState().refreshStatus();
      if (okText) setMessage({ tone: "ok", text: okText });
    } catch (e) {
      setMessage({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const command = (name: CommandName) =>
    run(async (c) => {
      await sendCommand(c, name);
      if (name === "repeat") await useResults.getState().discardLast(setId);
    }, t(`training.sent.${name}`));

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

      <div className={view.last} aria-live="polite">
        {last && reportSession ? (
          <>
            <span className={styles.name}>
              {programName(reportSession.programPath)} · {t("results.reportCount", { count: list.filter((r) => !r.discarded).length })}
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
          </>
        ) : (
          <span className={styles.muted}>{t("training.waiting")}</span>
        )}
      </div>

      {canCommand && waiting && (
        <div className={view.waiting}>
          <p className={view.waitingTitle}>{t("training.view.waitingFor", { block: waiting.block })}</p>
          <div className={styles.row}>
            <button className={`${styles.button} ${styles.primary}`} disabled={busy} onClick={() => void command("continue")}>
              <Play size={18} aria-hidden /> {t("training.continue")}
            </button>
            <button className={styles.button} disabled={busy} onClick={() => void command("repeat")}>
              <Repeat size={18} aria-hidden /> {t("training.repeat")}
            </button>
            <button className={styles.button} disabled={busy} onClick={() => void command("stop")}>
              <Square size={18} aria-hidden /> {t("training.stop")}
            </button>
          </div>
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

/** One editable variable of a waiting `communicate` block: a whole number within the block's range. */
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
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isInteger(n) || n < min || n > max) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onSet(n);
  };

  return (
    <div className={view.variable}>
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
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      <button className={styles.button} disabled={disabled} onClick={submit}>
        {t("training.view.setVariable")}
      </button>
      {invalid && (
        <p className={view.error} role="alert">
          {t("training.view.invalid", { min, max })}
        </p>
      )}
    </div>
  );
}
