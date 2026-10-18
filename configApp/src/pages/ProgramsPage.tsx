import { useMemo } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, BookLock, ChevronRight, CircleAlert, CircleCheck, Loader, Package, Radio, Users } from "lucide-react";
import { LedRing } from "../components/LedRing";
import { buildCatalog, type CatalogEntry } from "../programs/catalog";
import { useProgramSource, viewUrl, type ProgramSource, type SourceId } from "../programs/sources";
import { usePodSession } from "../pod/session";
import page from "./Page.module.css";
import styles from "./ProgramsPage.module.css";

export function ProgramsPage() {
  const { t } = useTranslation();
  const pod = useProgramSource("pod");
  const shipped = useProgramSource("shipped");
  const loading = usePodSession((s) => s.loading);
  const podCatalog = useCatalog(pod);
  const shippedCatalog = useCatalog(shipped);
  // the library is the same on every pod of a set; prefer the pod's copy when connected
  const library = pod.available && podCatalog.library.length > 0 ? { entries: podCatalog.library, source: "pod" as const } : { entries: shippedCatalog.library, source: "shipped" as const };

  return (
    <div className={page.page}>
      {pod.available ? (
        <section className={page.section}>
          <h2 className={styles.heading}>
            <Radio size={16} aria-hidden /> {t("programs.onPod")}
          </h2>
          {loading && (
            <p className={styles.loading}>
              <Loader size={16} aria-hidden className={styles.spin} /> {t("programs.reading", loading)}
            </p>
          )}
          {podCatalog.missing.map((path) => (
            <p key={path} className={styles.missing}>
              <AlertTriangle size={16} aria-hidden /> {t("programs.missingInMenu", { path })}
            </p>
          ))}
          <EntryList entries={podCatalog.programs} source="pod" shipped={shipped.files} files={pod.files} />
        </section>
      ) : (
        <p className={styles.connectHint}>
          <Radio size={16} aria-hidden /> <Link to="/pod">{t("programs.connectHint")}</Link>
        </p>
      )}

      <section className={page.section}>
        <h2 className={styles.heading}>
          <Package size={16} aria-hidden /> {t("programs.shipped")}
        </h2>
        <EntryList entries={shippedCatalog.programs} source="shipped" />
      </section>

      <section className={page.section}>
        <h2 className={styles.heading}>
          <BookLock size={16} aria-hidden /> {t("programs.library")}
        </h2>
        <p className={page.muted}>{t("programs.libraryHint")}</p>
        <EntryList entries={library.entries} source={library.source} />
      </section>
    </div>
  );
}

function useCatalog(source: ProgramSource) {
  return useMemo(
    () => buildCatalog(Object.keys(source.files), (p) => source.files[p], { supportedTypes: source.supportedTypes }),
    [source.files, source.supportedTypes],
  );
}

type ListProps = {
  entries: CatalogEntry[];
  source: SourceId;
  /** for pod entries: shipped files, to mark unchanged defaults */
  shipped?: Readonly<Record<string, string>>;
  files?: Readonly<Record<string, string>>;
};

function EntryList({ entries, source, shipped, files }: ListProps) {
  const { t } = useTranslation();
  if (entries.length === 0) return <p className={page.muted}>{t("programs.none")}</p>;
  return (
    <ul className={styles.list}>
      {entries.map((entry) => (
        <li key={entry.path}>
          <Link to={viewUrl(source, entry.path)} className={styles.entry}>
            {entry.kind === "program" ? (
              <LedRing groups={entry.menu} size={40} label={t("programs.menuPattern")} />
            ) : (
              <span className={styles.fragmentIcon}>
                <BookLock size={20} aria-hidden />
              </span>
            )}
            <span className={styles.text}>
              <span className={styles.name}>
                {entry.name}
                {source === "pod" && shipped && files && shipped[entry.path] === files[entry.path] && (
                  <span className={styles.tag}>{t("programs.unchanged")}</span>
                )}
                {source === "pod" && !entry.inMenu && entry.kind === "program" && <span className={styles.tag}>{t("programs.notInMenu")}</span>}
              </span>
              <span className={styles.meta}>
                {entry.kind === "program" && (
                  <span title={t("programs.podsTitle")}>
                    <Users size={13} aria-hidden /> {t("programs.pods", { count: entry.peripherals + 1 })}
                  </span>
                )}
                <span>{t("programs.blocks", { count: entry.blocks })}</span>
                <span className={styles.path}>{entry.path}</span>
              </span>
              {entry.description && <span className={styles.description}>{entry.description}</span>}
            </span>
            <Status entry={entry} />
            <ChevronRight size={18} aria-hidden className={styles.chevron} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Status({ entry }: { entry: CatalogEntry }) {
  const { t } = useTranslation();
  const errors = entry.issues.filter((i) => i.severity === "error").length;
  const warnings = entry.issues.length - errors;
  if (errors > 0)
    return (
      <span className={styles.status} data-level="error" title={t("programs.errors", { count: errors })}>
        <CircleAlert size={18} aria-label={t("programs.errors", { count: errors })} />
      </span>
    );
  if (warnings > 0)
    return (
      <span className={styles.status} data-level="warn" title={t("programs.warnings", { count: warnings })}>
        <AlertTriangle size={18} aria-label={t("programs.warnings", { count: warnings })} />
      </span>
    );
  return (
    <span className={styles.status} data-level="ok" title={t("programs.valid")}>
      <CircleCheck size={18} aria-label={t("programs.valid")} />
    </span>
  );
}
