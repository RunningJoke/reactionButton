import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Activity, AlertTriangle, BatteryWarning, BookLock, ChevronDown, ChevronRight, CircleCheck, FileJson, Info, KeyRound, Lightbulb, ListOrdered, Loader, Lock, Pencil, Plug, RefreshCw, Unplug, WifiOff } from "lucide-react";
import { ErrorBanner } from "../app/ConnectDialog";
import { useConnectDialog } from "../app/connectDialogStore";
import { Modal, modalStyles } from "../components/Modal";
import { Split, useDesktop } from "../components/Split";
import { INDEX_PATH, isLibraryPath, MAX_SET_NAME, PROGRAM_FORMAT } from "@reactpod/program-model";
import { PodError, type FileEntry, type ListResponse } from "../pod/protocol";
import { firmwareSupported, isReadOnly, needsPin, programFormatNewer, setLabel, usePodSession } from "../pod/session";
import { canFind, podHealth, type PodHealth } from "../pod/setView";
import type { SyncStatus } from "../pod/sync";
import { useMenuOverBudget, useSyncStates } from "../pod/syncActions";
import { byteLength } from "../pod/utf8";
import { ResetMenuButton, SyncBadge, UnsentCard } from "./PodSync";
import page from "./Page.module.css";
import styles from "./PodPage.module.css";

export function PodPage() {
  const state = usePodSession((s) => s.state);
  return (
    <div className={state === "connected" ? `${page.page} ${page.wide}` : page.page}>
      <ErrorBanner />
      {state === "connected" ? <Connected /> : <NotConnected busy={state === "connecting"} />}
    </div>
  );
}

/** A running game: a one-line way back to the training surface (the controls live there). */
function TrainingLink() {
  const { t } = useTranslation();
  const state = usePodSession((s) => s.status?.state);
  if (state !== "RUN" && state !== "PAUSED") return null;
  return (
    <Link to="/train" className={styles.menuLink}>
      <Activity size={22} aria-hidden />
      <span>{t("pod.trainingRunning")}</span>
      <ChevronRight size={20} aria-hidden />
    </Link>
  );
}

/** The pod menu has no tab on phones; it belongs to the pod, so it is linked here. */
function MenuRow({ count }: { count?: number }) {
  const { t } = useTranslation();
  return (
    <Link to="/set/menu" className={styles.menuLink}>
      <ListOrdered size={22} aria-hidden />
      <span>
        {t("menu.title")}
        {count !== undefined && <small className={styles.rowSub}>{t("pod.menuRow", { count })}</small>}
      </span>
      <ChevronRight size={20} aria-hidden />
    </Link>
  );
}

function NotConnected({ busy }: { busy: boolean }) {
  const { t } = useTranslation();
  const show = useConnectDialog((s) => s.show);
  return (
    <>
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
      <MenuRow />
    </>
  );
}

/** The battery is shown from `status` (firmware >= 2.13); the status is read again this often. */
const BATTERY_REFRESH_MS = 5000;

function Connected() {
  const { t, i18n } = useTranslation();
  const session = usePodSession();
  const { info, list, role, kind } = session;
  const [renaming, setRenaming] = useState(false);
  const [details, setDetails] = useState(false);
  const states = useSyncStates();
  const overBudget = useMenuOverBudget();
  const refreshStatus = usePodSession((s) => s.refreshStatus);
  const disconnect = usePodSession((s) => s.disconnect);
  const desktop = useDesktop();
  useEffect(() => {
    const timer = window.setInterval(() => void refreshStatus(), BATTERY_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);
  if (!info || !list || !kind) return null;
  const readOnly = isReadOnly(session);
  const status = new Map(states?.map((s) => [s.path, s.status]));
  const podCount = 1 + (session.status?.pods?.length ?? 0);

  // set info and sync: first on phone, the sticky side column on desktop (#107)
  const setInfo = (
    <>
      <header className={styles.setHeader}>
        <div className={styles.podTitle}>
          <h2 className={styles.podName}>{setLabel(session) ?? t(`pod.kind.${kind}`)}</h2>
          <p className={styles.sub}>
            {readOnly ? (
              <>
                <Lock size={14} aria-hidden /> {t(`pod.role.${role ?? "booting"}`)}
              </>
            ) : (
              t("pod.summary", { via: t(`pod.via.${kind}`), count: podCount })
            )}
          </p>
        </div>
        {!readOnly && (
          <button className={styles.textButton} onClick={() => setRenaming(true)}>
            <Pencil size={18} aria-hidden /> {t("pod.renameButton")}
          </button>
        )}
      </header>
      {!firmwareSupported(info) && <p className={styles.warn}>{t("pod.firmwareUnsupported", { version: info.firmware })}</p>}
      {programFormatNewer(info) && <p className={styles.warn}>{t("pod.programFormatNewer", { pod: info.programFormat, app: PROGRAM_FORMAT })}</p>}
      {overBudget && <p className={styles.warn}>{t("pod.storeOverBudget")}</p>}
      {readOnly && <p className={styles.note}>{t("pod.readOnly")}</p>}
      {!readOnly && info.pinRequired && (
        <p className={styles.note}>
          <KeyRound size={14} aria-hidden /> {t("pod.pinHint")}
        </p>
      )}
    </>
  );
  const sync = <UnsentCard states={states} readOnly={readOnly} />;

  return (
    <Split side={desktop ? <>{setInfo}{sync}</> : null} sideOnPhone={false}>
      {!desktop && setInfo}
      <TrainingLink />
      {!desktop && sync}
      {role === "central" && <PodList />}
      <MenuRow count={list.menu.length} />
      <button className={styles.menuLink} aria-expanded={details} onClick={() => setDetails(!details)}>
        <Info size={22} aria-hidden />
        <span>{t("pod.details")}</span>
        {details ? <ChevronDown size={20} aria-hidden /> : <ChevronRight size={20} aria-hidden />}
      </button>
      {details && (
        <>
          <section className={page.section}>
            <dl className={styles.facts}>
              <Fact label={t("pod.firmware")} value={info.firmware} warn={!firmwareSupported(info)} />
              <Fact label={t("pod.setId")} value={info.setId} mono />
              <Fact label={t("pod.generation")} value={String(list.generation)} />
              <Fact label={t("pod.free")} value={formatBytes(info.freeBytes, i18n.language)} />
            </dl>
            <button className={styles.textButton} onClick={() => void session.refresh()}>
              <RefreshCw size={18} aria-hidden /> {t("pod.refresh")}
            </button>
          </section>
          <FileGroups list={list} status={status} />
        </>
      )}
      <div className={styles.bottom}>
        {!readOnly && <ResetMenuButton states={states} />}
        <button className={page.bigButton} onClick={() => void disconnect()}>
          <Unplug size={20} aria-hidden /> {t("pod.disconnect")}
        </button>
      </div>
      <RenameSetModal open={renaming} onClose={() => setRenaming(false)} />
    </Split>
  );
}

/**
 * The pods of the set: the main pod and every `status.pods` entry, each with its health in words,
 * the battery (unknown = nothing shown) and Find (the `blink` op, feature `identify`).
 */
function PodList() {
  const { t } = useTranslation();
  const session = usePodSession();
  const client = session.client;
  const pods = session.status?.pods ?? [];
  const canBlink = session.info?.features?.includes("identify") ?? false;
  const findable = canFind(session.status?.state);
  const [blinking, setBlinking] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!client) return null;

  const blink = async (pod: number) => {
    setBlinking(pod);
    setError(null);
    try {
      await client.blink(pod);
    } catch (e) {
      setError(e instanceof PodError && e.code === "busy" ? t("pod.podList.findBusy") : t("pod.podList.findFailed"));
    } finally {
      setBlinking(null);
    }
  };

  const rows = [
    { id: -1, name: t("pod.podList.central"), color: "var(--led-white)" as string | undefined, alive: true, battery: session.status?.battery },
    ...pods.map((p) => ({ id: p.id, name: t("pod.podList.number", { number: p.number ?? p.id + 1 }), color: p.color, alive: p.alive, battery: p.battery })),
  ];

  return (
    <section className={page.section}>
      <h2>{t("pod.podList.title", { count: rows.length })}</h2>
      <ul className={styles.podList}>
        {rows.map((row) => (
          <li key={row.id} className={styles.podRow}>
            {row.color && <span className={styles.colorDot} style={{ background: row.color }} aria-hidden />}
            <span className={styles.podText}>
              <span className={styles.podLabel}>{row.name}</span>
              <PodStatusText health={podHealth(row.alive, row.battery)} percent={row.battery?.percent} />
            </span>
            {canBlink && (
              <button
                className={styles.blinkButton}
                onClick={() => void blink(row.id)}
                disabled={blinking !== null || !findable || !row.alive}
                aria-label={t("pod.podList.findAria", { name: row.name })}
              >
                {blinking === row.id ? <Loader size={18} aria-hidden className={styles.spin} /> : <Lightbulb size={18} aria-hidden />}
                {t("pod.podList.find")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {canBlink && !findable && <p className={styles.note}>{t("pod.podList.notWhileRunning")}</p>}
      {error && <p className={styles.warn}>{error}</p>}
    </section>
  );
}

/** Health in words and an icon, not by colour alone; an unknown battery shows nothing. */
export function PodStatusText({ health, percent }: { health: PodHealth; percent?: number }) {
  const { t } = useTranslation();
  const Icon = health === "offline" ? WifiOff : health === "low" ? BatteryWarning : CircleCheck;
  const text =
    health === "offline"
      ? t("pod.health.offline")
      : health === "low"
        ? t("pod.health.low", { percent })
        : percent === undefined
          ? t("pod.health.online")
          : `${t("pod.health.online")} · ${t("pod.battery", { percent })}`;
  return (
    <span className={styles.podStatus} data-health={health}>
      <Icon size={14} aria-hidden /> {text}
    </span>
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
  const used = byteLength(value.trim());
  const tooLong = used > MAX_SET_NAME;

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
      <p className={tooLong ? modalStyles.error : styles.note} aria-live="polite">
        <span className={styles.counter}>{used}/{MAX_SET_NAME}</span> {t("pod.renameHint", { max: MAX_SET_NAME })}
      </p>
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
