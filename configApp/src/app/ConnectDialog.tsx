import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Bluetooth, Info, Loader, Lock, MonitorSmartphone, Unplug, Usb, X, type LucideIcon } from "lucide-react";
import { firmwareSupported, isReadOnly, usePodSession } from "../pod/session";
import { isWebBluetoothAvailable } from "../pod/transport/BleTransport";
import type { TransportKind } from "../pod/transport/Transport";
import { isWebSerialAvailable } from "../pod/transport/WebSerialTransport";
import { useConnectDialog } from "./connectDialogStore";
import styles from "./ConnectDialog.module.css";

export const TRANSPORT_ICONS: Record<TransportKind, LucideIcon> = { ble: Bluetooth, serial: Usb, simulated: MonitorSmartphone };

/** Modal for connecting to a pod and disconnecting again. Closes by itself once connected. */
export function ConnectDialog() {
  const { t } = useTranslation();
  const open = useConnectDialog((s) => s.open);
  const hide = useConnectDialog((s) => s.hide);
  const state = usePodSession((s) => s.state);
  const ref = useRef<HTMLDialogElement>(null);
  const previous = useRef(state);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || typeof dialog.showModal !== "function") return; // jsdom
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (previous.current === "connecting" && state === "connected") hide();
    previous.current = state;
  }, [state, hide]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="connect-title"
      onClose={hide}
      // a click on the backdrop lands on the dialog element itself
      onClick={(e) => e.target === e.currentTarget && hide()}
    >
      {open && (
        <div className={styles.content}>
          <div className={styles.header}>
            <h2 id="connect-title">{t("pod.dialog.title")}</h2>
            <button className={styles.iconButton} onClick={hide} aria-label={t("pod.dialog.close")}>
              <X size={20} aria-hidden />
            </button>
          </div>
          <ErrorBanner />
          {state === "connected" ? <ConnectedPod /> : <ConnectOptions busy={state === "connecting"} />}
        </div>
      )}
    </dialog>
  );
}

export function ErrorBanner() {
  const { t } = useTranslation();
  const error = usePodSession((s) => s.error);
  if (!error) return null;
  const known = ["timeout", "disconnected", "openFailed", "notAllowed", "busy", "overflow"];
  return (
    <div className={styles.banner} role="alert">
      <AlertTriangle size={20} aria-hidden />
      <div>
        <strong>{t(`pod.errors.${known.includes(error.code) ? error.code : "unknown"}`)}</strong>
        <p className={styles.detail}>{error.message}</p>
      </div>
    </div>
  );
}

function ConnectOptions({ busy }: { busy: boolean }) {
  const { t } = useTranslation();
  const connect = usePodSession((s) => s.connect);
  const kind = usePodSession((s) => s.kind);

  const options: { kind: TransportKind; available: boolean; unavailable?: string }[] = [
    { kind: "ble", available: isWebBluetoothAvailable(), unavailable: t("pod.bleUnsupported") },
    { kind: "serial", available: isWebSerialAvailable(), unavailable: t("pod.serialUnsupported") },
    { kind: "simulated", available: true },
  ];

  return (
    <>
      <p className={styles.intro}>{t("pod.intro")}</p>
      <div className={styles.options}>
        {options.map((option) => {
          const Icon = busy && kind === option.kind ? Loader : TRANSPORT_ICONS[option.kind];
          return (
            <button
              key={option.kind}
              className={styles.option}
              disabled={busy || !option.available}
              onClick={() => void connect(option.kind)}
            >
              <Icon size={28} aria-hidden className={busy && kind === option.kind ? styles.spin : undefined} />
              <span className={styles.optionTitle}>{t(`pod.connect.${option.kind}`)}</span>
              <span className={styles.optionText}>
                {option.available ? t(`pod.connect.${option.kind}Hint`) : option.unavailable}
              </span>
            </button>
          );
        })}
      </div>
      {busy && <p className={styles.hint}>{t("pod.chooseDevice")}</p>}
      <p className={styles.hint}>
        <Info size={16} aria-hidden /> {t("pod.menuHint")}
      </p>
    </>
  );
}

function ConnectedPod() {
  const { t } = useTranslation();
  const session = usePodSession();
  const { info, role, kind } = session;
  const Icon = kind ? TRANSPORT_ICONS[kind] : Bluetooth;

  return (
    <>
      <div className={styles.pod}>
        <Icon size={28} aria-hidden className={styles.podIcon} />
        <div className={styles.podText}>
          <strong>{session.deviceName ?? t(`pod.kind.${kind ?? "ble"}`)}</strong>
          <span className={styles.podFacts}>
            <span className={styles.badge} data-role={role}>
              {isReadOnly(session) && <Lock size={12} aria-hidden />}
              {t(`pod.role.${role ?? "booting"}`)}
            </span>
            {info && (
              <>
                <span data-warn={!firmwareSupported(info) || undefined}>
                  {t("pod.firmware")} {info.firmware}
                </span>
                <span>
                  {t("pod.setId")} <code>{info.setId}</code>
                </span>
              </>
            )}
          </span>
        </div>
      </div>
      <div className={styles.footer}>
        <button className={styles.danger} onClick={() => void session.disconnect()}>
          <Unplug size={18} aria-hidden /> {t("pod.disconnect")}
        </button>
      </div>
    </>
  );
}
