import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ChevronRight, CloudUpload, Trophy, UserPlus, UserRound } from "lucide-react";
import { Modal, modalStyles } from "../components/Modal";
import { sessionUploadStatus, useResults } from "../results/results";
import type { Athlete } from "../results/report";
import { formatDateTime } from "./resultsUi";
import page from "./Page.module.css";
import styles from "./Results.module.css";

export const athleteUrl = (id: string | null) => `/results/athlete?id=${id ?? "none"}`;
export const sessionUrl = (id: string) => `/results/session?id=${id}`;

/** Results tab: the athletes on this phone and their result history (issue #47). */
export function ResultsPage() {
  const { t, i18n } = useTranslation();
  const { athletes, sessions, reports, durable, load } = useResults();
  const [adding, setAdding] = useState(false);
  useEffect(() => void load(), [load]);

  const unassigned = sessions.filter((s) => s.athleteId === null && reports.some((r) => r.sessionId === s.id));
  const waiting = sessions.filter((s) => {
    const status = sessionUploadStatus(s, athletes, reports);
    return status === "pending" || status === "failed";
  }).length;

  return (
    <div className={page.page}>
      {!durable && (
        <p className={styles.warn} role="alert">
          <AlertTriangle size={18} aria-hidden /> {t("results.notDurable")}
        </p>
      )}
      <section className={page.section}>
        <div className={styles.heading}>
          <h2>{t("results.athletes", { count: athletes.length })}</h2>
          <button className={`${styles.button} ${styles.primary}`} onClick={() => setAdding(true)}>
            <UserPlus size={18} aria-hidden /> {t("results.addAthlete")}
          </button>
        </div>
        {athletes.length === 0 ? (
          <div className={page.empty}>
            <Trophy size={40} aria-hidden className={page.emptyIcon} />
            <p>{t("results.empty")}</p>
          </div>
        ) : (
          <ul className={styles.list}>
            {athletes.map((a) => (
              <AthleteRow key={a.id} athlete={a} />
            ))}
          </ul>
        )}
      </section>

      {unassigned.length > 0 && (
        <section className={page.section}>
          <ul className={styles.list}>
            <li>
              <Link to={athleteUrl(null)} className={styles.entry}>
                <span className={styles.avatar} aria-hidden>
                  <UserRound size={20} />
                </span>
                <span className={styles.text}>
                  <span className={styles.name}>{t("results.unassigned")}</span>
                  <span className={styles.meta}>
                    <span>{t("results.sessionCount", { count: unassigned.length })}</span>
                    <span>{formatDateTime(unassigned.at(-1)!.startedAt, i18n.language)}</span>
                  </span>
                </span>
                <ChevronRight size={20} aria-hidden className={styles.chevron} />
              </Link>
            </li>
          </ul>
          <p className={styles.muted}>{t("results.unassignedHint")}</p>
        </section>
      )}

      {waiting > 0 && (
        <section className={page.section}>
          <p className={styles.muted}>
            <CloudUpload size={16} aria-hidden /> {t("results.waitingUpload", { count: waiting })}{" "}
            <Link to="/settings#platform">{t("results.platformSettings")}</Link>
          </p>
        </section>
      )}

      <AthleteModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function AthleteRow({ athlete }: { athlete: Athlete }) {
  const { t, i18n } = useTranslation();
  const sessions = useResults((s) => s.sessions);
  const reports = useResults((s) => s.reports);
  const own = sessions.filter((s) => s.athleteId === athlete.id);
  const last = own.at(-1);
  const counted = reports.filter((r) => !r.discarded && own.some((s) => s.id === r.sessionId)).length;
  return (
    <li>
      <Link to={athleteUrl(athlete.id)} className={styles.entry}>
        <span className={styles.avatar} aria-hidden>
          {athlete.name.slice(0, 1).toUpperCase()}
        </span>
        <span className={styles.text}>
          <span className={styles.name}>{athlete.name}</span>
          <span className={styles.meta}>
            <span>{t("results.sessionCount", { count: own.length })}</span>
            <span>{t("results.reportCount", { count: counted })}</span>
            {last && <span>{formatDateTime(last.startedAt, i18n.language)}</span>}
          </span>
        </span>
        <ChevronRight size={20} aria-hidden className={styles.chevron} />
      </Link>
    </li>
  );
}

/** Add an athlete (no `athlete`) or rename one. Calls `onSaved` with the athlete. */
export function AthleteModal({ open, onClose, athlete, onSaved }: { open: boolean; onClose: () => void; athlete?: Athlete; onSaved?: (a: Athlete) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState<string | null>(null);
  const value = name ?? athlete?.name ?? "";
  const valid = value.trim().length > 0 && value.trim().length <= 80;
  const close = () => {
    setName(null);
    onClose();
  };
  const save = async () => {
    if (!valid) return;
    const results = useResults.getState();
    let saved: Athlete;
    if (athlete) {
      await results.updateAthlete(athlete.id, { name: value });
      saved = { ...athlete, name: value.trim() };
    } else {
      saved = await results.addAthlete(value);
    }
    onSaved?.(saved);
    close();
  };
  return (
    <Modal
      open={open}
      title={athlete ? t("results.renameAthlete") : t("results.addAthlete")}
      onClose={close}
      actions={
        <>
          <button className={modalStyles.button} onClick={close}>
            {t("common.cancel")}
          </button>
          <button className={`${modalStyles.button} ${modalStyles.primary}`} disabled={!valid} onClick={() => void save()}>
            {t("pod.save")}
          </button>
        </>
      }
    >
      <label htmlFor="athlete-name">{t("results.athleteName")}</label>
      <input
        id="athlete-name"
        className={modalStyles.input}
        value={value}
        maxLength={80}
        autoFocus
        autoComplete="off"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void save()}
      />
      <p className={styles.muted}>{t("results.athleteNameHint")}</p>
    </Modal>
  );
}
