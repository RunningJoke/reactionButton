import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Download, Eye, EyeOff, Trash2 } from "lucide-react";
import { HoldButton } from "../components/HoldButton";
import { Modal, modalStyles } from "../components/Modal";
import { csvFilename, csvSeparator, downloadText, resultsCsv } from "../results/csv";
import type { StoredReport } from "../results/report";
import { reportsOfSession, sessionUploadStatus, useResults } from "../results/results";
import { formatMs, reportDuration, summarizeReports, summarizeValues } from "../results/stats";
import { athleteUrl } from "./ResultsPage";
import { formatDateTime, StatsTable, UploadBadge, useProgramName } from "./resultsUi";
import page from "./Page.module.css";
import styles from "./Results.module.css";

/** One training session: athlete, program, its reports with single values (issue #47). */
export function SessionPage() {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { athletes, sessions, reports, loaded, load } = useResults();
  const programName = useProgramName();
  const [deleting, setDeleting] = useState(false);
  useEffect(() => void load(), [load]);

  const session = sessions.find((s) => s.id === params.get("id"));
  if (!loaded) return null;
  if (!session) {
    return (
      <div className={page.page}>
        <p className={page.muted}>
          {t("results.sessionMissing")} <Link to="/results">{t("results.back")}</Link>
        </p>
      </div>
    );
  }
  const list = reportsOfSession(reports, session.id);
  const athlete = athletes.find((a) => a.id === session.athleteId);
  const uploaded = Boolean(session.upload.remoteId);

  const exportCsv = () => {
    const csv = resultsCsv([session], list, athletes, { separator: csvSeparator(i18n.language) });
    downloadText(csv, csvFilename(`${athlete?.name ?? "results"}-${programName(session.programPath)}`, session.startedAt));
  };

  return (
    <div className={page.page}>
      <Link to={athleteUrl(session.athleteId)} className={styles.back}>
        <ChevronLeft size={20} aria-hidden /> {athlete?.name ?? t("results.unassigned")}
      </Link>
      <section className={page.section}>
        <div className={styles.title}>
          <h2>{programName(session.programPath)}</h2>
          <button className={styles.iconButton} onClick={() => setDeleting(true)} aria-label={t("results.deleteSession")} title={t("results.deleteSession")}>
            <Trash2 size={20} aria-hidden />
          </button>
        </div>
        <dl className={styles.facts}>
          <div>
            <dt>{t("results.started")}</dt>
            <dd>{formatDateTime(session.startedAt, i18n.language)}</dd>
          </div>
          <div>
            <dt>{t("results.program")}</dt>
            <dd className={styles.mono}>{session.programPath}</dd>
          </div>
          <div>
            <dt>{t("pod.setId")}</dt>
            <dd className={styles.mono}>{session.setId}</dd>
          </div>
          <div>
            <dt>{t("results.uploadState")}</dt>
            <dd>
              <UploadBadge status={sessionUploadStatus(session, athletes, reports)} />
            </dd>
          </div>
        </dl>
        <label className={styles.field}>
          {t("results.athlete")}
          <select
            className={styles.select}
            value={session.athleteId ?? ""}
            disabled={uploaded}
            onChange={(e) => void useResults.getState().setSessionAthlete(session.id, e.target.value || null)}
          >
            <option value="">{t("results.nobody")}</option>
            {athletes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {uploaded && <p className={styles.muted}>{t("results.athleteFixed")}</p>}
        {session.upload.error && <p className={styles.status} data-tone="error">{t("results.uploadError", { code: session.upload.error })}</p>}
        <StatsTable stats={summarizeReports(list)} caption={t("results.statsCaption")} />
        <div className={styles.row}>
          <button className={styles.button} onClick={exportCsv} disabled={list.length === 0}>
            <Download size={18} aria-hidden /> {t("results.exportCsv")}
          </button>
        </div>
      </section>

      <section className={page.section}>
        <h2>{t("results.reports", { count: list.length })}</h2>
        {list.length === 0 ? (
          <p className={styles.muted}>{t("results.noReports")}</p>
        ) : (
          <ul className={styles.list}>
            {list.map((r, i) => (
              <ReportItem key={r.id} report={r} n={i + 1} />
            ))}
          </ul>
        )}
      </section>

      <Modal
        open={deleting}
        title={t("results.deleteSession")}
        onClose={() => setDeleting(false)}
        actions={
          <>
            <button className={modalStyles.button} onClick={() => setDeleting(false)}>
              {t("common.cancel")}
            </button>
            <HoldButton
              onConfirm={() =>
                void useResults
                  .getState()
                  .deleteSession(session.id)
                  .then(() => navigate(athleteUrl(session.athleteId)))
              }
            >
              {t("settings.holdToDelete")}
            </HoldButton>
          </>
        }
      >
        <p>{t("results.deleteSessionText", { count: list.length })}</p>
        {uploaded && <p className={styles.muted}>{t("results.deleteSessionRemote")}</p>}
      </Modal>
    </div>
  );
}

function ReportItem({ report, n }: { report: StoredReport; n: number }) {
  const { t, i18n } = useTranslation();
  const duration = reportDuration(report);
  const vars = Object.entries(report.vars);
  const first = report.values[0]?.t ?? report.startMs ?? 0;
  return (
    <li>
      <details className={styles.report} data-discarded={report.discarded}>
        <summary>
          <span className={styles.reportTitle}>
            <span>{report.cycle !== undefined ? t("results.cycle", { cycle: report.cycle }) : t("results.reportN", { n })}</span>
            <span className={styles.meta}>
              <span>{new Intl.DateTimeFormat(i18n.language, { timeStyle: "medium" }).format(report.recordedAt)}</span>
              {duration !== undefined && <span>{formatMs(duration, i18n.language)}</span>}
              <span>{t("results.valueCount", { count: report.values.length })}</span>
              {report.discarded && <span>{t("results.discarded")}</span>}
            </span>
          </span>
          <button
            className={styles.iconButton}
            onClick={(e) => {
              e.preventDefault();
              void useResults.getState().setDiscarded(report.id, !report.discarded);
            }}
            aria-label={report.discarded ? t("results.countAgain") : t("results.discard")}
            title={report.discarded ? t("results.countAgain") : t("results.discard")}
          >
            {report.discarded ? <Eye size={20} aria-hidden /> : <EyeOff size={20} aria-hidden />}
          </button>
        </summary>
        <div className={styles.reportBody}>
          <StatsTable stats={summarizeValues(report.values)} />
          {vars.length > 0 && (
            <div className={styles.vars} aria-label={t("results.vars")}>
              {vars.map(([k, v]) => (
                <span key={k}>
                  {k} = {v}
                </span>
              ))}
            </div>
          )}
          {report.values.length > 0 && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <caption>{t("results.values")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("results.time")}</th>
                    <th scope="col">{t("results.metric")}</th>
                    <th scope="col">{t("results.pod")}</th>
                    <th scope="col">{t("results.value")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.values.map((v, i) => (
                    <tr key={i}>
                      <td>{formatMs(Math.max(0, v.t - first), i18n.language)}</td>
                      <td>{v.metric}</td>
                      <td>{v.pod}</td>
                      <td>{formatMs(v.ms, i18n.language)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>
    </li>
  );
}
