import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { FlaskConical, Play, Repeat, Square, UserPlus } from "lucide-react";
import { PodError } from "../pod/protocol";
import { usePodSession } from "../pod/session";
import { SimulatedTransport } from "../pod/simulated/SimulatedTransport";
import { sendAthlete, sendCommand, supportsRemote, supportsReports, type CommandName } from "../results/podReports";
import { reportsOfSession, useResults } from "../results/results";
import { formatMs, reportDuration, summarizeValues } from "../results/stats";
import { AthleteModal, sessionUrl } from "./ResultsPage";
import { useProgramName } from "./resultsUi";
import page from "./Page.module.css";
import styles from "./Results.module.css";

/** Pod tab, connected central: who trains now, live reports and remote control (#37, #41, #42). */
export function PodTraining() {
  const { t, i18n } = useTranslation();
  const { info, client, role } = usePodSession();
  const { athletes, sessions, reports, sets, load } = useResults();
  const programName = useProgramName();
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void load(), [load]);
  if (!info || role !== "central") return null;

  const setId = info.setId.toLowerCase();
  const state = sets[setId];
  const reportsOn = supportsReports(info);
  const remote = supportsRemote(info);
  const session = state?.sessionId ? sessions.find((s) => s.id === state.sessionId) : undefined;
  const list = session ? reportsOfSession(reports, session.id) : [];
  const last = list.at(-1);
  const demoPod = client?.transport instanceof SimulatedTransport ? client.transport.pod : null;

  const errorText = (e: unknown) => {
    const code = e instanceof PodError ? e.code : "";
    return ["busy", "not_ready", "timeout", "disconnected"].includes(code) ? t(`training.errors.${code}`) : e instanceof Error ? e.message : String(e);
  };

  const assign = async (athleteId: string | null) => {
    setMessage(null);
    if (remote && client) {
      try {
        await sendAthlete(client, athleteId ?? "");
      } catch (e) {
        setMessage({ tone: "error", text: errorText(e) });
        return; // the pod keeps the old athlete, so does the app
      }
    }
    await useResults.getState().assign(setId, athleteId);
  };

  const command = async (name: CommandName) => {
    if (!client) return;
    setBusy(true);
    setMessage(null);
    try {
      await sendCommand(client, name);
      if (name === "repeat") await useResults.getState().discardLast(setId);
      setMessage({ tone: "ok", text: t(`training.sent.${name}`) });
    } catch (e) {
      setMessage({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={page.section} aria-labelledby="training-title">
      <h2 id="training-title">{t("training.title")}</h2>
      <div className={styles.title}>
        <label className={`${styles.field} ${styles.grow}`}>
          {t("training.athlete")}
          <select className={styles.select} value={state?.athleteId ?? ""} onChange={(e) => void assign(e.target.value || null)}>
            <option value="">{t("results.nobody")}</option>
            {athletes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <button className={styles.iconButton} onClick={() => setAdding(true)} aria-label={t("results.addAthlete")} title={t("results.addAthlete")}>
          <UserPlus size={20} aria-hidden />
        </button>
      </div>

      {!reportsOn ? (
        <p className={styles.muted}>{t("training.noReports")}</p>
      ) : (
        <>
          {!remote && <p className={styles.muted}>{t("training.noRemote")}</p>}
          <div className={styles.live} aria-live="polite">
            {last && session ? (
              <>
                <span className={styles.name}>
                  {programName(session.programPath)} · {t("results.reportCount", { count: list.filter((r) => !r.discarded).length })}
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
                  {last.discarded && <span>{t("results.discarded")}</span>}
                </span>
                <Link to={sessionUrl(session.id)}>{t("training.openSession")}</Link>
              </>
            ) : (
              <span className={styles.muted}>{t("training.waiting")}</span>
            )}
          </div>
          {remote && (
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
          )}
          {demoPod && (
            <div className={styles.row}>
              <button className={styles.button} onClick={() => demoPod.emitSampleReport()}>
                <FlaskConical size={18} aria-hidden /> {t("training.demoReport")}
              </button>
            </div>
          )}
        </>
      )}
      {message && (
        <p className={styles.status} data-tone={message.tone} role="status">
          {message.text}
        </p>
      )}
      <AthleteModal open={adding} onClose={() => setAdding(false)} onSaved={(a) => void assign(a.id)} />
    </section>
  );
}
