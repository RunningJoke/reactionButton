import { useTranslation } from "react-i18next";
import { useRegisterSW } from "virtual:pwa-register/react";
import styles from "./UpdatePrompt.module.css";

/** Asks before activating a new app version, so an edit in progress is never reloaded away. */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh && !offlineReady) return null;

  const close = () => {
    setNeedRefresh(false);
    setOfflineReady(false);
  };

  return (
    <div className={styles.toast} role="status">
      <span>{needRefresh ? t("update.available") : t("update.offlineReady")}</span>
      {needRefresh && (
        <button className={styles.primary} onClick={() => void updateServiceWorker(true)}>
          {t("update.reload")}
        </button>
      )}
      <button className={styles.secondary} onClick={close}>
        {t("update.dismiss")}
      </button>
    </div>
  );
}
