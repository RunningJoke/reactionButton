import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, Download, EyeOff, Trash2, Undo2, UserRound } from "lucide-react";
import { HoldButton } from "../components/HoldButton";
import { Modal, modalStyles } from "../components/Modal";
import { Named } from "../components/Named";
import { isMsSetting } from "../editor/settingLabels";
import { UndoToast } from "../editor/UndoToast";
import { isSignedIn, usePlatformSettings } from "../platform/settings";
import { csvFilename, csvSeparator, downloadText, resultsCsv } from "../results/csv";
import type { StoredReport } from "../results/report";
import { reportsOfSession, sessionUploadStatus, useResults } from "../results/results";
import { formatMs, mainMetric, reportDuration, summarizeReports, summarizeValues } from "../results/stats";
import { athleteLinkUrl } from "../app/navigation";
import { formatDateTime, StatsTable, UploadBadge, useProgramName } from "./resultsUi";
import page from "./Page.module.css";
import styles from "./Results.module.css";

/** One training: summary first (best, average), then its rounds; technical facts under "Details" (issue #47). */
export function SessionPage() {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { athletes, sessions, reports, loaded, load } = useResults();
  const programName = useProgramName();
  const [deleting, setDeleting] = useState(false);
  const [undo, setUndo] = useState<{ id: string; n: number } | null>(null);
  const platformOn = usePlatformSettings(isSignedIn);
  useEffect(() => void load(), [load]);

  const session = sessions.find((s) => s.id === params.get("id"));
  if (!loaded) return null;
  if (!session) {
    return (
      <div className={page.page}>
        <p className={page.muted}>
          {t("results.sessionMissing")}
        </p>
      </div>
    );
  }
  const list = reportsOfSession(reports, session.id);
  const athlete = athletes.find((a) => a.id === session.athleteId);
  const uploaded = Boolean(session.upload.remoteId);
  const stats = summarizeReports(list);
  const metric = mainMetric(stats.map((m) => m.metric));
  const main = stats.find((m) => m.metric === metric);
  const notCounted = list.filter((r) => r.discarded).length;

  const exportCsv = () => {
    const csv = resultsCsv([session], list, athletes, { separator: csvSeparator(i18n.language) });
    downloadText(csv, csvFilename(`${athlete?.name ?? "results"}-${programName(session.programPath)}`, session.startedAt));
  };

  return (
    <div className={page.page}>
      <section className={page.section}>
        <div className={styles.title}>
          <h2 className={styles.display}>{programName(session.programPath)}</h2>
          <button className={styles.iconButton} onClick={() => setDeleting(true)} aria-label={t("results.deleteSession")} title={t("results.deleteSession")}>
            <Trash2 size={20} aria-hidden />
          </button>
        </div>
        <p className={styles.muted}>{formatDateTime(session.startedAt, i18n.language)}</p>
        <label className={styles.athleteChip}>
          <UserRound size={16} aria-hidden />
          <span className={styles.srOnly}>{t("results.athlete")}</span>
          <select
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
        {platformOn && (
          <p className={styles.muted}>
            <UploadBadge status={sessionUploadStatus(session, athletes, reports)} />
          </p>
        )}
        {platformOn && session.upload.error && <p className={styles.status} data-tone="error">{t("results.uploadError", { code: session.upload.error })}</p>}
        {main && (
          <div className={styles.figures}>
            <div>
              <span className={styles.figureLabel}>{t("results.best")}</span>
              <span className={styles.big}>{formatMs(main.best, i18n.language)}</span>
            </div>
            <div>
              <span className={styles.figureLabel}>{t("results.average")}</span>
              <span className={styles.big}>{formatMs(main.average, i18n.language)}</span>
            </div>
            <span className={`${styles.figureLabel} ${styles.figuresMetric}`}>
              <Named name={main.metric} />
            </span>
          </div>
        )}
      </section>

      <section className={page.section}>
        <h2>{t("results.rounds")}</h2>
        {list.length > 0 && (
          <p className={styles.muted}>
            {t("results.roundCount", { count: list.length })}
            {notCounted > 0 && <> · {t("results.notCountedCount", { count: notCounted })}</>}
          </p>
        )}
        {list.length === 0 ? (
          <p className={styles.muted}>{t("results.noReports")}</p>
        ) : (
          <ul className={styles.rounds}>
            {list.map((r, i) => (
              <ReportItem key={r.id} report={r} n={i + 1} onUncounted={(n) => setUndo({ id: r.id, n })} />
            ))}
          </ul>
        )}
      </section>

      <section className={page.section}>
        <details className={page.details}>
          <summary>{t("results.details")}</summary>
          <dl className={styles.facts}>
            <div>
              <dt>{t("results.program")}</dt>
              <dd className={styles.mono}>{session.programPath}</dd>
            </div>
            <div>
              <dt>{t("pod.setId")}</dt>
              <dd className={styles.mono}>{session.setId}</dd>
            </div>
          </dl>
          <StatsTable stats={stats} caption={t("results.statsCaption")} />
        </details>
      </section>

      <section className={page.section}>
        <button className={styles.button} onClick={exportCsv} disabled={list.length === 0}>
          <Download size={18} aria-hidden /> {t("results.exportTable")}
        </button>
        <p className={styles.muted}>{t("results.exportCaption")}</p>
      </section>

      {undo && (
        <div className={styles.toastHost}>
          <UndoToast
            text={t("results.noLongerCounted", { n: undo.n })}
            onUndo={() => void useResults.getState().setDiscarded(undo.id, false)}
            onClose={() => setUndo(null)}
          />
        </div>
      )}

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
              holdingLabel={t("results.keepHolding")}
              onConfirm={() =>
                void useResults
                  .getState()
                  .deleteSession(session.id)
                  .then(() => navigate(athleteLinkUrl(session.athleteId)))
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

function ReportItem({ report, n, onUncounted }: { report: StoredReport; n: number; onUncounted: (n: number) => void }) {
  const { t, i18n } = useTranslation();
  const duration = reportDuration(report);
  const vars = Object.entries(report.vars);
  const first = report.values[0]?.t ?? report.startMs ?? 0;
  const round = report.cycle ?? n;
  const toggle = (e: React.MouseEvent) => {
    e.preventDefault(); // inside <summary>: do not open / close the round
    void useResults.getState().setDiscarded(report.id, !report.discarded);
    if (!report.discarded) onUncounted(round);
  };
  return (
    <li>
      <details className={styles.round} data-discarded={report.discarded}>
        <summary>
          <ChevronDown size={20} aria-hidden className={styles.roundChevron} />
          <span className={styles.reportTitle}>
            <span>
              {t("results.round", { n: round })}
              {duration !== undefined && <> · {formatMs(duration, i18n.language)}</>} · {t("results.pressCount", { count: report.values.length })}
            </span>
            <span className={styles.meta}>
              <span>{new Intl.DateTimeFormat(i18n.language, { timeStyle: "medium" }).format(report.recordedAt)}</span>
              {report.discarded && <span className={styles.pill}>{t("results.notCounted")}</span>}
            </span>
          </span>
          <button type="button" className={styles.button} onClick={toggle}>
            {report.discarded ? <Undo2 size={18} aria-hidden /> : <EyeOff size={18} aria-hidden />}
            {report.discarded ? t("results.countAgain") : t("results.discard")}
          </button>
        </summary>
        <div className={styles.reportBody}>
          <StatsTable stats={summarizeValues(report.values)} />
          <details className={page.details}>
            <summary>{t("results.details")}</summary>
            {vars.length > 0 && (
              <div className={styles.vars} aria-label={t("results.vars")}>
                {vars.map(([k, v]) => (
                  <span key={k}>
                    <Named name={k} /> = {isMsSetting(k) && typeof v === "number" ? formatMs(v, i18n.language) : v}
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
                        <td>
                          <Named name={v.metric} />
                        </td>
                        <td>{v.pod}</td>
                        <td>{formatMs(v.ms, i18n.language)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
        </div>
      </details>
    </li>
  );
}
