import { useTranslation } from "react-i18next";
import { Bluetooth, Usb, Unplug, Loader, MonitorSmartphone } from "lucide-react";
import { usePodSession } from "../pod/session";
import styles from "./ConnectionChip.module.css";

export function ConnectionChip() {
  const { t } = useTranslation();
  const state = usePodSession((s) => s.state);
  const transport = usePodSession((s) => s.kind);
  const Icon =
    state === "connecting"
      ? Loader
      : state === "disconnected"
        ? Unplug
        : transport === "serial"
          ? Usb
          : transport === "simulated"
            ? MonitorSmartphone
            : Bluetooth;
  return (
    <span className={styles.chip} data-state={state} role="status">
      <Icon size={16} aria-hidden className={state === "connecting" ? styles.spin : undefined} />
      <span>{t(`connection.${state}`)}</span>
    </span>
  );
}
