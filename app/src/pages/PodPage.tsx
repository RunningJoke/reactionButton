import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, BookLock, FileJson, Info, KeyRound, ListOrdered, Loader, Lock, Pencil, Plug, RefreshCw, Unplug } from "lucide-react";
import { ErrorBanner } from "../app/ConnectDialog";
import { useConnectDialog } from "../app/connectDialogStore";
import { Modal, modalStyles } from "../components/Modal";
import { INDEX_PATH, isLibraryPath, MAX_SET_NAME, PROGRAM_FORMAT } from "../model/limits";
import { PodError, type FileEntry, type ListResponse } from "../pod/protocol";
import { firmwareSupported, isReadOnly, needsPin, programFormatNewer, setLabel, usePodSession } from "../pod/session";
import type { SyncStatus } from "../pod/sync";
import { useSyncStates } from "../pod/syncActions";
import { byteLength } from "../pod/utf8";
import { SyncBadge, SyncSection } from "./PodSync";
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
  const [renaming, setRenaming] = useState(false);
  const states = useSyncStates();
  if (!info || !list) return null;
  const readOnly = isReadOnly(session);
  const status = new Map(states?.map((s) => [s.path, s.status]));

  return (
    <>
      <section className={page.section}>
        <div className={styles.podHeader}>
          <div className={styles.podTitle}>
            <h2 className={styles.podName}>{setLabel(session) ?? t(`pod.kind.${kind}`)}</h2>
            <span className={styles.badge} data-role={role}>
              {readOnly && <Lock size={14} aria-hidden />}
              {t(`pod.role.${role ?? "booting"}`)}
            </span>
          </div>
          <div className={styles.actions}>
            {!readOnly && (
              <button className={styles.iconButton} onClick={() => setRenaming(true)} aria-label={t("pod.rename")} title={t("pod.rename")}>
                <Pencil size={20} aria-hidden />
              </button>
            )}
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
        {programFormatNewer(info) && (
          <p className={styles.warn}>{t("pod.programFormatNewer", { pod: info.programFormat, app: PROGRAM_FORMAT })}</p>
        )}
        {readOnly && <p className={styles.note}>{t("pod.readOnly")}</p>}
        {!readOnly && info.pinRequired && (
          <p className={styles.note}>
            <KeyRound size={14} aria-hidden /> {t("pod.pinHint")}
          </p>
        )}
      </section>

      <SyncSection states={states} readOnly={readOnly} />
      <FileGroups list={list} status={status} />
      <RenameSetModal open={renaming} onClose={() => setRenaming(false)} />
    </>
  );
}

/** Set name (firmware ≥ 2.2), with the PIN first if the pod needs one (firmware ≥ 2.6). */
function RenameSetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const session = usePodSession();
  const [name, setName] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const askPin = needsPin(session);
  const value = name ?? session.info?.setName ?? "";
  const tooLong = byteLength(value.trim()) > MAX_SET_NAME;

  const close = () => {
    setName(null);
    setPin("");
    setError(null);
    onClose();
  };

  const save = async () => {
    if (tooLong || busy || (askPin && !pin)) return;
    setBusy(true);
    setError(null);
    try {
      if (askPin) await session.authenticate(pin);
      await session.renameSet(value.trim());
      close();
    } catch (e) {
      const code = e instanceof PodError ? e.code : "unknown";
      setError(code === "auth_failed" || code === "auth_required" ? t(`pod.errors.${code}`) : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t("pod.rename")}
      onClose={close}
      actions={
        <>
          <button className={modalStyles.button} onClick={close}>
            {t("common.cancel")}
          </button>
          <button
            className={`${modalStyles.button} ${modalStyles.primary}`}
            disabled={tooLong || busy || (askPin && !pin)}
            onClick={() => void save()}
          >
            {t("pod.save")}
          </button>
        </>
      }
    >
      <label htmlFor="set-name">{t("pod.setName")}</label>
      <input
        id="set-name"
        className={modalStyles.input}
        value={value}
        placeholder={session.info ? `ReactPod ${session.info.setId.slice(-4)}` : undefined}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void save()}
      />
      {tooLong && <p className={modalStyles.error}>{t("pod.nameTooLong", { max: MAX_SET_NAME })}</p>}
      <p className={styles.note}>{t("pod.renameHint")}</p>
      {askPin && (
        <>
          <label htmlFor="set-pin">{t("pod.pin")}</label>
          <input
            id="set-pin"
            className={modalStyles.input}
            value={pin}
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && void save()}
          />
        </>
      )}
      {error && <p className={modalStyles.error}>{error}</p>}
      <p className={styles.note}>{t("pod.renameLater")}</p>
    </Modal>
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

function FileGroups({ list, status }: { list: ListResponse; status: ReadonlyMap<string, SyncStatus> }) {
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
              <FileRow key={path} path={path} file={file} status={status.get(path)} />
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
              <FileRow key={file.path} path={file.path} file={file} status={status.get(file.path)} />
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

function FileRow({ path, file, status }: { path: string; file?: FileEntry; status?: SyncStatus }) {
  const { i18n, t } = useTranslation();
  return (
    <li className={styles.file}>
      <span className={styles.path}>
        {file?.name !== undefined && <span className={styles.programName}>{file.name}</span>}
        {path}
      </span>
      {status && <SyncBadge status={status} />}
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
