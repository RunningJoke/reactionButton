import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ChevronRight, CloudUpload, Trophy, UserPlus, UserRound } from "lucide-react";
import { Modal, modalStyles } from "../components/Modal";
import { Split, useDesktop } from "../components/Split";
import { athleteLinkUrl } from "../app/navigation";
import { isSignedIn, usePlatformSettings } from "../platform/settings";
import { sessionUploadStatus, useResults } from "../results/results";
import type { Athlete } from "../results/report";
import { athleteProgress, formatMs, relativeDay, type Progress } from "../results/stats";
import { Named } from "../components/Named";
import { AthleteView } from "./AthletePage";
import page from "./Page.module.css";
import styles from "./Results.module.css";

export const sessionUrl = (id: string) => `/results/session?id=${id}`;

/**
 * Results tab: the athletes on this phone, by last training, with the latest figure of their main metric (issue #47).
 * From 900 px the selected athlete (`?athlete=`) sits on the right (issue #107).
 */
export function ResultsPage() {
  const { t, i18n } = useTranslation();
  const { athletes, sessions, reports, durable, load } = useResults();
  const [adding, setAdding] = useState(false);
  const [order, setOrder] = useState<"recent" | "name">("recent");
  const [query, setQuery] = useState("");
  const [params] = useSearchParams();
  const desktop = useDesktop();
  const platformOn = usePlatformSettings(isSignedIn);
  useEffect(() => void load(), [load]);

  const unassigned = sessions.filter((s) => s.athleteId === null && reports.some((r) => r.sessionId === s.id));
  const waiting = sessions.filter((s) => {
    const status = sessionUploadStatus(s, athletes, reports);
    return status === "pending" || status === "failed";
  }).length;
  const rows = useMemo(
    () => sortAthletes(athletes.map((athlete) => ({ athlete, progress: athleteProgress(sessions.filter((s) => s.athleteId === athlete.id), reports) })), order),
    [athletes, sessions, reports, order],
  );
  const search = athletes.length > SEARCH_FROM;
  const shown = search && query.trim() ? rows.filter((r) => r.athlete.name.toLowerCase().includes(query.trim().toLowerCase())) : rows;
  const selected = pickSelected(params.get("athlete"), rows.map((r) => r.athlete.id), unassigned.length > 0);

  return (
    <div className={`${page.page} ${page.wide}`}>
      <Split side={desktop && selected !== null ? <AthleteView key={selected} id={selected} /> : null} sideOnPhone={false}>
        {!durable && (
          <p className={styles.warn} role="alert">
            <AlertTriangle size={18} aria-hidden /> {t("results.notDurable")}
          </p>
        )}
        <section className={page.section}>
          <div className={styles.heading}>
            <h2>{t("results.athletes", { count: athletes.length })}</h2>
            {athletes.length > 0 && (
              <button className={`${styles.button} ${styles.primary}`} onClick={() => setAdding(true)}>
                <UserPlus size={18} aria-hidden /> {t("results.addAthlete")}
              </button>
            )}
          </div>
          {athletes.length === 0 ? (
            <div className={page.empty}>
              <Trophy size={40} aria-hidden className={page.emptyIcon} />
              <p>{t("results.empty")}</p>
              <button className={`${styles.button} ${styles.primary}`} onClick={() => setAdding(true)}>
                <UserPlus size={18} aria-hidden /> {t("results.addAthlete")}
              </button>
              <p className={styles.steps}>{t("results.steps")}</p>
            </div>
          ) : (
            <>
              {athletes.length > 1 && (
                <div className={styles.tools}>
                  <div className={page.segmented} role="group" aria-label={t("results.sortBy")}>
                    {(["recent", "name"] as const).map((o) => (
                      <label key={o}>
                        <input type="radio" name="athlete-order" checked={order === o} onChange={() => setOrder(o)} />
                        {t(`results.sort.${o}`)}
                      </label>
                    ))}
                  </div>
                  {search && (
                    <input
                      className={styles.input}
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t("results.search")}
                      aria-label={t("results.search")}
                    />
                  )}
                </div>
              )}
              <ul className={styles.list}>
                {shown.map(({ athlete, progress }) => (
                  <AthleteRow key={athlete.id} athlete={athlete} progress={progress} selected={desktop && athlete.id === selected} />
                ))}
              </ul>
              {shown.length === 0 && <p className={styles.muted}>{t("results.noMatch")}</p>}
            </>
          )}
        </section>

        {unassigned.length > 0 && (
          <section className={styles.unassigned}>
            <Link to={athleteLinkUrl(null)} className={styles.entry} aria-current={desktop && selected === "none" ? "true" : undefined}>
              <span className={styles.avatar} aria-hidden>
                <UserRound size={20} />
              </span>
              <span className={styles.text}>
                <span className={styles.name}>{t("results.unassigned")}</span>
                <span className={styles.meta}>
                  <span>{t("results.trainingCount", { count: unassigned.length })}</span>
                  <span>{relativeDay(unassigned.at(-1)!.startedAt, i18n.language)}</span>
                </span>
              </span>
              <ChevronRight size={20} aria-hidden className={styles.chevron} />
            </Link>
            <p className={styles.muted}>{t("results.unassignedHint")}</p>
          </section>
        )}

        {waiting > 0 && platformOn && (
          <section className={page.section}>
            <p className={styles.muted}>
              <CloudUpload size={16} aria-hidden /> {t("results.waitingUpload", { count: waiting })}{" "}
              <Link to="/settings#platform">{t("results.platformSettings")}</Link>
            </p>
          </section>
        )}
      </Split>

      <AthleteModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

const SEARCH_FROM = 8;

/** The athlete on the desktop side: the one in the query while they exist, else the first in the list. */
export function pickSelected(asked: string | null, ids: string[], hasUnassigned: boolean): string | null {
  if (asked !== null && (ids.includes(asked) || (asked === "none" && hasUnassigned))) return asked;
  return ids[0] ?? (hasUnassigned ? "none" : null);
}

/** Latest training first (athletes without training last, by name), or A–Z. */
export function sortAthletes<T extends { athlete: Athlete; progress: Progress }>(rows: T[], order: "recent" | "name"): T[] {
  const byName = (a: T, b: T) => a.athlete.name.localeCompare(b.athlete.name);
  return [...rows].sort(order === "name" ? byName : (a, b) => (b.progress.lastAt ?? -1) - (a.progress.lastAt ?? -1) || byName(a, b));
}

function AthleteRow({ athlete, progress, selected }: { athlete: Athlete; progress: Progress; selected: boolean }) {
  const { t, i18n } = useTranslation();
  const latest = progress.points.at(-1);
  return (
    <li>
      <Link to={athleteLinkUrl(athlete.id)} className={styles.entry} aria-current={selected ? "true" : undefined}>
        <span className={styles.avatar} aria-hidden>
          {athlete.name.slice(0, 1).toUpperCase()}
        </span>
        <span className={styles.text}>
          <span className={styles.name}>{athlete.name}</span>
          <span className={styles.meta}>
            <span>{progress.lastAt === undefined ? t("results.neverTrained") : t("results.lastTrained", { when: relativeDay(progress.lastAt, i18n.language) })}</span>
          </span>
        </span>
        {latest && progress.metric && (
          <span className={styles.figure}>
            <span className={styles.figureValue}>{formatMs(latest.average, i18n.language)}</span>
            <span className={styles.figureLabel}>
              <Named name={progress.metric} />
            </span>
          </span>
        )}
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
