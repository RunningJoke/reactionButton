import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Loader, Unplug } from "lucide-react";
import { usePodSession } from "../pod/session";
import { unsentChanges } from "../pod/sync";
import { useSyncStates } from "../pod/syncActions";
import { TRANSPORT_ICONS } from "./ConnectDialog";
import { useConnectDialog } from "./connectDialogStore";
import styles from "./ConnectionChip.module.css";

/**
 * Connection state in the header; opens "This set" when connected, else the connection dialog.
 * `compact` (sub-pages): the label collapses to the icon on phones so the title keeps its room.
 */
export function ConnectionChip({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const state = usePodSession((s) => s.state);
  const transport = usePodSession((s) => s.kind);
  const show = useConnectDialog((s) => s.show);
  const navigate = useNavigate();
  const unsent = unsentChanges(useSyncStates()).length > 0;
  const busy = state === "connecting" || state === "reconnecting";
  const Icon = busy ? Loader : state === "disconnected" || !transport ? Unplug : TRANSPORT_ICONS[transport];
  const label = t(`connection.${state}`) + (unsent ? ` · ${t("connection.unsent")}` : "");
  return (
    <button
      className={`${styles.chip} ${compact ? styles.compact : ""}`}
      data-state={state}
      onClick={state === "connected" ? () => navigate("/set") : show}
      aria-haspopup={state === "connected" ? undefined : "dialog"}
      aria-label={label}
      title={label}
    >
      <Icon size={16} aria-hidden className={busy ? styles.spin : undefined} />
      <span aria-live="polite" className={styles.label}>
        {t(`connection.${state}`)}
      </span>
      {unsent && <span className={styles.dot} aria-hidden />}
    </button>
  );
}
