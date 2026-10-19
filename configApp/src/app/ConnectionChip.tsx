import { useTranslation } from "react-i18next";
import { Loader, Unplug } from "lucide-react";
import { usePodSession } from "../pod/session";
import { TRANSPORT_ICONS } from "./ConnectDialog";
import { useConnectDialog } from "./connectDialogStore";
import styles from "./ConnectionChip.module.css";

/** Connection state in the header; opens the connection dialog. */
export function ConnectionChip() {
  const { t } = useTranslation();
  const state = usePodSession((s) => s.state);
  const transport = usePodSession((s) => s.kind);
  const show = useConnectDialog((s) => s.show);
  const Icon = state === "connecting" ? Loader : state === "disconnected" || !transport ? Unplug : TRANSPORT_ICONS[transport];
  return (
    <button className={styles.chip} data-state={state} onClick={show} aria-haspopup="dialog">
      <Icon size={16} aria-hidden className={state === "connecting" ? styles.spin : undefined} />
      <span aria-live="polite">{t(`connection.${state}`)}</span>
    </button>
  );
}
