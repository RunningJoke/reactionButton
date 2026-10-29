import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Download, Link2, Pencil, Trash2, Unlink } from "lucide-react";
import { HoldButton } from "../components/HoldButton";
import { Modal, modalStyles } from "../components/Modal";
import { PlatformError, type PlatformAthlete } from "../platform/api";
import { canUpload, platformClient, usePlatformSettings } from "../platform/settings";
import { deleteAthleteEverywhere } from "../results/athleteDeletion";
import { csvFilename, csvSeparator, downloadText, resultsCsv } from "../results/csv";
import type { Athlete } from "../results/report";
import { sessionUploadStatus, useResults } from "../results/results";
import { summarizeReports } from "../results/stats";
import { AthleteModal, sessionUrl } from "./ResultsPage";
import { formatDateTime, StatsTable, UploadBadge, useProgramName } from "./resultsUi";
import page from "./Page.module.css";
import styles from "./Results.module.css";

/** History of one athlete (or of the sessions without athlete): statistics, sessions, CSV export. */
export function AthletePage() {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const id = params.get("id");
  const { athletes, sessions, reports, loaded, load } = useResults();
  const programName = useProgramName();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const claimedIds = usePlatformSettings((s) => s.claimedAthleteIds) ?? [];
  useEffect(() => void load(), [load]);

  const none = id === "none";
  const athlete = athletes.find((a) => a.id === id);
  if (!loaded) return null;
  if (!none && !athlete) {
    return (
      <div className={page.page}>
        <p className={page.muted}>
          {t("results.athleteMissing")} <Link to="/results">{t("results.back")}</Link>
        </p>
      </div>
    );
  }
  const own = sessions.filter((s) => (none ? s.athleteId === null : s.athleteId === id)).filter((s) => reports.some((r) => r.sessionId === s.id));
  const ownReports = reports.filter((r) => own.some((s) => s.id === r.sessionId));
  const stats = summarizeReports(ownReports);
  const name = athlete?.name ?? t("results.unassigned");

  const exportCsv = () => {
    const csv = resultsCsv(own, ownReports, athletes, { separator: csvSeparator(i18n.language) });
    downloadText(csv, csvFilename(name, Date.now()));
  };

  return (
    <div className={page.page}>
      <Link to="/results" className={styles.back}>
        <ChevronLeft size={20} aria-hidden /> {t("results.back")}
      </Link>
      <section className={page.section}>
        <div className={styles.title}>
          <h2>{name}</h2>
          {athlete && (
            <>
              <button className={styles.iconButton} onClick={() => setRenaming(true)} aria-label={t("results.renameAthlete")} title={t("results.renameAthlete")}>
                <Pencil size={20} aria-hidden />
              </button>
              <button className={styles.iconButton} onClick={() => setDeleting(true)} aria-label={t("results.deleteAthlete")} title={t("results.deleteAthlete")}>
                <Trash2 size={20} aria-hidden />
              </button>
            </>
          )}
        </div>
        <p className={styles.muted}>
          {t("results.sessionCount", { count: own.length })} · {t("results.reportCount", { count: ownReports.filter((r) => !r.discarded).length })}
        </p>
        <StatsTable stats={stats} caption={t("results.statsCaption")} />
        <div className={styles.row}>
          <button className={styles.button} onClick={exportCsv} disabled={ownReports.length === 0}>
            <Download size={18} aria-hidden /> {t("results.exportCsv")}
          </button>
        </div>
      </section>

      <section className={page.section}>
        <h2>{t("results.sessions")}</h2>
        {own.length === 0 ? (
          <p className={styles.muted}>{t("results.noSessions")}</p>
        ) : (
          <ul className={styles.list}>
            {[...own].reverse().map((s) => {
              const list = reports.filter((r) => r.sessionId === s.id);
              const discarded = list.filter((r) => r.discarded).length;
              return (
                <li key={s.id}>
                  <Link to={sessionUrl(s.id)} className={styles.entry}>
                    <span className={styles.text}>
                      <span className={styles.name}>{programName(s.programPath)}</span>
                      <span className={styles.meta}>
                        <span>{formatDateTime(s.startedAt, i18n.language)}</span>
                        <span>{t("results.reportCount", { count: list.length - discarded })}</span>
                        {discarded > 0 && <span>{t("results.discardedCount", { count: discarded })}</span>}
                        <UploadBadge status={sessionUploadStatus(s, athletes, reports)} />
                      </span>
                    </span>
                    <ChevronRight size={20} aria-hidden className={styles.chevron} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {athlete && <PlatformLink athlete={athlete} />}

      {athlete && (
        <>
          <AthleteModal open={renaming} onClose={() => setRenaming(false)} athlete={athlete} />
          <Modal
            open={deleting}
            title={t("results.deleteAthlete")}
            onClose={() => setDeleting(false)}
            actions={
              <>
                <button className={modalStyles.button} onClick={() => setDeleting(false)}>
                  {t("common.cancel")}
                </button>
                <HoldButton onConfirm={() => void deleteAthleteEverywhere(athlete.id).then(() => navigate("/results"))}>{t("settings.holdToDelete")}</HoldButton>
              </>
            }
          >
            <p>{t("results.deleteAthleteText", { name: athlete.name, count: own.length })}</p>
            {athlete.platformId && (
              <p className={styles.muted}>{t(claimedIds.includes(athlete.platformId) ? "results.deleteAthleteRemoteOwn" : "results.deleteAthleteRemote")}</p>
            )}
            <p className={styles.muted}>{t("results.deleteAthleteReports")}</p>
          </Modal>
        </>
      )}
    </div>
  );
}

/** Link to a platform athlete profile (issue #48): pick an existing profile or create one with consent. */
function PlatformLink({ athlete }: { athlete: Athlete }) {
  const { t } = useTranslation();
  const settings = usePlatformSettings();
  const [open, setOpen] = useState(false);
  const ready = canUpload(settings);

  return (
    <section className={page.section}>
      <h2>{t("platform.profile")}</h2>
      {athlete.platformId ? (
        <>
          <p className={styles.muted}>
            {t("platform.linked", { org: athlete.platformOrgId === settings.orgId && settings.orgName ? settings.orgName : t("platform.club") })}
          </p>
          <div className={styles.row}>
            <button
              className={styles.button}
              onClick={() => void useResults.getState().updateAthlete(athlete.id, { platformId: undefined, platformOrgId: undefined })}
            >
              <Unlink size={18} aria-hidden /> {t("platform.unlink")}
            </button>
          </div>
        </>
      ) : ready ? (
        <>
          <p className={styles.muted}>{t("platform.notLinked")}</p>
          <div className={styles.row}>
            <button className={styles.button} onClick={() => setOpen(true)}>
              <Link2 size={18} aria-hidden /> {t("platform.link")}
            </button>
          </div>
        </>
      ) : (
        <p className={styles.muted}>
          {t("platform.signInFirst")} <Link to="/settings#platform">{t("results.platformSettings")}</Link>
        </p>
      )}
      {open && <LinkModal athlete={athlete} onClose={() => setOpen(false)} />}
    </section>
  );
}

function LinkModal({ athlete, onClose }: { athlete: Athlete; onClose: () => void }) {
  const { t } = useTranslation();
  const settings = usePlatformSettings();
  const [profiles, setProfiles] = useState<PlatformAthlete[] | null>(null);
  const [choice, setChoice] = useState<string>("new");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    platformClient(settings)
      .listAthletes(settings.orgId!)
      .then((r) => live && setProfiles(r.athletes))
      .catch(() => live && setProfiles([])); // athletes (not coaches) cannot list: create or ask the coach
    return () => {
      live = false;
    };
  }, [settings]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      let platformId = choice;
      if (choice === "new") {
        const created = await platformClient(settings).createAthlete(settings.orgId!, { name: athlete.name, consent: true });
        platformId = created.id;
      }
      await useResults.getState().updateAthlete(athlete.id, { platformId, platformOrgId: settings.orgId });
      onClose();
    } catch (e) {
      setError(e instanceof PlatformError ? t("platform.error", { code: e.code, detail: e.message }) : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={t("platform.link")}
      onClose={onClose}
      actions={
        <>
          <button className={modalStyles.button} onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button className={`${modalStyles.button} ${modalStyles.primary}`} disabled={busy || (choice === "new" && !consent)} onClick={() => void save()}>
            {t("platform.linkConfirm")}
          </button>
        </>
      }
    >
      {profiles === null ? (
        <p className={styles.muted}>{t("platform.loading")}</p>
      ) : (
        <fieldset className={styles.fieldset}>
          <legend className={styles.muted}>{t("platform.chooseProfile", { org: settings.orgName ?? "" })}</legend>
          {profiles.map((p) => (
            <label key={p.id} className={styles.check}>
              <input type="radio" name="profile" value={p.id} checked={choice === p.id} onChange={() => setChoice(p.id)} />
              <span>{p.name}</span>
            </label>
          ))}
          <label className={styles.check}>
            <input type="radio" name="profile" value="new" checked={choice === "new"} onChange={() => setChoice("new")} />
            <span>{t("platform.createProfile", { name: athlete.name })}</span>
          </label>
        </fieldset>
      )}
      {choice === "new" && (
        <label className={styles.check}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{t("platform.consent")}</span>
        </label>
      )}
      {error && <p className={modalStyles.error}>{error}</p>}
    </Modal>
  );
}
