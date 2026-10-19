import { useTranslation } from "react-i18next";
import { AlertTriangle, BookLock, FileJson, Info, ListOrdered, Loader, Lock, Plug, RefreshCw, Unplug } from "lucide-react";
import { ErrorBanner } from "../app/ConnectDialog";
import { useConnectDialog } from "../app/connectDialogStore";
import { INDEX_PATH, isLibraryPath } from "../model/limits";
import type { FileEntry, ListResponse } from "../pod/protocol";
import { firmwareSupported, isReadOnly, usePodSession } from "../pod/session";
import page from "./Page.module.css";
import styles from "./PodPage.module.css";

export function PodPage() {
  const state = usePodSession((s) => s.state);
  return (
    <div className={page.page}>
      <ErrorBanner />
      {state === "connected" ? <Connected /> : <NotConnected busy={state === "connecting"} />}
    </div>
  );
}

function NotConnected({ busy }: { busy: boolean }) {
  const { t } = useTranslation();
  const show = useConnectDialog((s) => s.show);
  return (
    <div className={page.empty}>
      <Unplug size={40} aria-hidden className={page.emptyIcon} />
      <p>
        <strong>{t("pod.notConnected")}</strong>
        <br />
        {t("pod.intro")}
      </p>
      <button className={`${page.bigButton} ${page.primary}`} onClick={show} disabled={busy}>
        {busy ? <Loader size={20} aria-hidden className={styles.spin} /> : <Plug size={20} aria-hidden />}
        {busy ? t("connection.connecting") : t("pod.connectButton")}
      </button>
      <p className={styles.hint}>
        <Info size={16} aria-hidden /> {t("pod.menuHint")}
      </p>
    </div>
  );
}

function Connected() {
  const { t, i18n } = useTranslation();
  const session = usePodSession();
  const { info, list, role, kind } = session;
  if (!info || !list) return null;
  const readOnly = isReadOnly(session);

  return (
    <>
      <section className={page.section}>
        <div className={styles.podHeader}>
          <div className={styles.podTitle}>
            <h2 className={styles.podName}>{session.deviceName ?? t(`pod.kind.${kind}`)}</h2>
            <span className={styles.badge} data-role={role}>
              {readOnly && <Lock size={14} aria-hidden />}
              {t(`pod.role.${role ?? "booting"}`)}
            </span>
          </div>
          <div className={styles.actions}>
            <button className={styles.iconButton} onClick={() => void session.refresh()} aria-label={t("pod.refresh")} title={t("pod.refresh")}>
              <RefreshCw size={20} aria-hidden />
            </button>
          </div>
        </div>
        <dl className={styles.facts}>
          <Fact label={t("pod.firmware")} value={info.firmware} warn={!firmwareSupported(info)} />
          <Fact label={t("pod.setId")} value={info.setId} mono />
          <Fact label={t("pod.generation")} value={String(list.generation)} />
          <Fact label={t("pod.free")} value={formatBytes(info.freeBytes, i18n.language)} />
        </dl>
        {!firmwareSupported(info) && <p className={styles.warn}>{t("pod.firmwareUnsupported", { version: info.firmware })}</p>}
        {readOnly && <p className={styles.note}>{t("pod.readOnly")}</p>}
      </section>

      <FileGroups list={list} />
    </>
  );
}

function Fact({ label, value, mono, warn }: { label: string; value: string; mono?: boolean; warn?: boolean }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd className={mono ? styles.mono : undefined} data-warn={warn || undefined}>
        {value}
      </dd>
    </div>
  );
}

function FileGroups({ list }: { list: ListResponse }) {
  const { t } = useTranslation();
  const byPath = new Map(list.files.map((f) => [f.path, f]));
  const inMenu = new Set(list.menu);
  const menu = list.menu.map((path) => ({ path, file: byPath.get(path) }));
  const others = list.files.filter((f) => f.path !== INDEX_PATH && !isLibraryPath(f.path) && !inMenu.has(f.path));
  const library = list.files.filter((f) => isLibraryPath(f.path));

  return (
    <>
      <section className={page.section}>
        <h2>
          <ListOrdered size={16} aria-hidden /> {t("pod.groups.menu", { count: menu.length })}
        </h2>
        {menu.length === 0 ? (
          <p className={page.muted}>{t("pod.emptyMenu")}</p>
        ) : (
          <ol className={styles.files}>
            {menu.map(({ path, file }) => (
              <FileRow key={path} path={path} file={file} />
            ))}
          </ol>
        )}
      </section>
      {others.length > 0 && (
        <section className={page.section}>
          <h2>
            <FileJson size={16} aria-hidden /> {t("pod.groups.other", { count: others.length })}
          </h2>
          <ul className={styles.files}>
            {others.map((file) => (
              <FileRow key={file.path} path={file.path} file={file} />
            ))}
          </ul>
        </section>
      )}
      <section className={page.section}>
        <h2>
          <BookLock size={16} aria-hidden /> {t("pod.groups.library", { count: library.length })}
        </h2>
        <ul className={styles.files}>
          {library.map((file) => (
            <FileRow key={file.path} path={file.path} file={file} />
          ))}
        </ul>
      </section>
    </>
  );
}

function FileRow({ path, file }: { path: string; file?: FileEntry }) {
  const { i18n, t } = useTranslation();
  return (
    <li className={styles.file}>
      <span className={styles.path}>{path}</span>
      {file ? (
        <span className={styles.size}>{formatBytes(file.size, i18n.language)}</span>
      ) : (
        <span className={styles.missing}>
          <AlertTriangle size={14} aria-hidden /> {t("pod.missingFile")}
        </span>
      )}
    </li>
  );
}

/** 958 B, 1.4 kB, 1,758 kB */
export function formatBytes(bytes: number, locale: string): string {
  if (bytes < 1000) return `${bytes} B`;
  const kb = bytes / 1024;
  return new Intl.NumberFormat(locale, { style: "unit", unit: "kilobyte", maximumFractionDigits: kb < 10 ? 1 : 0 }).format(kb);
}
