import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, BookLock, ChevronRight, CircleAlert, CircleCheck, FileUp, FolderHeart, Loader, Package, Plus, Radio, SlidersHorizontal, Users } from "lucide-react";
import { LedRing } from "../components/LedRing";
import { buildCatalog, type CatalogEntry } from "../programs/catalog";
import { AdjustSheet, type AdjustTarget } from "../programs/AdjustSheet";
import { NewProgramModal, useTakenPaths } from "../programs/actions";
import { SetArchiveButtons } from "../programs/SetArchiveButtons";
import { editorUrl, useProgramSource, viewUrl, type ProgramSource, type SourceId } from "../programs/sources";
import { parseProgramText, useWorkspace } from "../store/workspace";
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
  const local = useProgramSource("local");
  const localCatalog = useCatalog(local);
  const docs = useWorkspace((s) => s.programs);
  const idByPath = useMemo(() => new Map(docs.map((d) => [d.path, d])), [docs]);
  const [creating, setCreating] = useState(false);
  const [adjusting, setAdjusting] = useState<AdjustTarget | null>(null);
  const library = pod.available && podCatalog.library.length > 0 ? { entries: podCatalog.library, source: "pod" as const } : { entries: shippedCatalog.library, source: "shipped" as const };

  return (
    <div className={`${page.page} ${styles.withFab}`}>
      <section className={page.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.heading}>
            <FolderHeart size={16} aria-hidden /> {t("programs.mine")}
          </h2>
          <div className={styles.headerActions}>
            <ImportButton />
            <SetArchiveButtons className={styles.textButton} errorClassName={styles.importError} />
          </div>
        </div>
        {localCatalog.programs.length === 0 ? (
          <p className={page.muted}>{t("programs.mineEmpty")}</p>
        ) : (
          <EntryList
            entries={localCatalog.programs}
            source="local"
            href={(e) => editorUrl(idByPath.get(e.path)!.id)}
            onAdjust={(e) => setAdjusting({ source: "local", path: e.path })}
            tag={(e) => {
              const origin = idByPath.get(e.path)?.origin;
              return origin === "pod" ? t("programs.fromPod") : origin === "default" ? t("programs.fromShipped") : null;
            }}
          />
        )}
      </section>

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
          <EntryList entries={podCatalog.programs} source="pod" shipped={shipped.files} files={pod.files} onAdjust={(e) => setAdjusting({ source: "pod", path: e.path })} />
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
        <EntryList entries={shippedCatalog.programs} source="shipped" onAdjust={(e) => setAdjusting({ source: "shipped", path: e.path })} />
      </section>

      <section className={page.section}>
        <h2 className={styles.heading}>
          <BookLock size={16} aria-hidden /> {t("programs.library")}
        </h2>
        <p className={page.muted}>{t("programs.libraryHint")}</p>
        <EntryList entries={library.entries} source={library.source} />
      </section>

      <button className={styles.fab} onClick={() => setCreating(true)} aria-label={t("programs.new")} title={t("programs.new")}>
        <Plus size={26} aria-hidden />
      </button>
      <NewProgramModal open={creating} onClose={() => setCreating(false)} />
      {adjusting && <AdjustSheet key={`${adjusting.source}:${adjusting.path}`} target={adjusting} onClose={() => setAdjusting(null)} />}
    </div>
  );
}

/** Imports a program file (.json) as a new local program. */
function ImportButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const add = useWorkspace((s) => s.add);
  const taken = useTakenPaths();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button className={styles.textButton} onClick={() => input.current?.click()}>
        <FileUp size={16} aria-hidden /> {t("programs.import")}
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            const json = parseProgramText(await file.text());
            const doc = await add(json, "local", { taken });
            setError(null);
            navigate(editorUrl(doc.id));
          } catch {
            setError(t("programs.importFailed", { file: file.name }));
          }
        }}
      />
      {error && (
        <p className={styles.importError} role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function useCatalog(source: ProgramSource) {
  return useMemo(
    () => buildCatalog(Object.keys(source.files), source.read, { supportedTypes: source.supportedTypes }),
    [source.files, source.read, source.supportedTypes],
  );
}

type ListProps = {
  entries: CatalogEntry[];
  source: SourceId;
  /** for pod entries: shipped files, to mark unchanged defaults */
  shipped?: Readonly<Record<string, string>>;
  files?: Readonly<Record<string, string>>;
  /** link target (default: the read-only view) */
  href?: (entry: CatalogEntry) => string;
  tag?: (entry: CatalogEntry) => string | null;
  /** "Adjust" on program rows (editor-ux.md §4 G) */
  onAdjust?: (entry: CatalogEntry) => void;
};

function EntryList({ entries, source, shipped, files, href, tag, onAdjust }: ListProps) {
  const { t } = useTranslation();
  if (entries.length === 0) return <p className={page.muted}>{t("programs.none")}</p>;
  return (
    <ul className={styles.list}>
      {entries.map((entry) => (
        <li key={entry.path} className={styles.row}>
          <Link to={href ? href(entry) : viewUrl(source, entry.path)} className={styles.entry}>
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
                {tag?.(entry) && <span className={styles.tag}>{tag(entry)}</span>}
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
            {!(onAdjust && entry.kind === "program") && <ChevronRight size={18} aria-hidden className={styles.chevron} />}
          </Link>
          {onAdjust && entry.kind === "program" && (
            <button type="button" className={styles.adjust} onClick={() => onAdjust(entry)} aria-label={t("adjust.actionFor", { name: entry.name })} title={t("adjust.action")}>
              <SlidersHorizontal size={18} aria-hidden />
              <span>{t("adjust.action")}</span>
            </button>
          )}
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
