import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useRegisterSW } from "virtual:pwa-register/react";
import styles from "./UpdatePrompt.module.css";

const OFFLINE_SEEN_KEY = "reactpod.offlineReadySeen";

/** True once the "ready offline" notice has been shown in this browser. Storage may be blocked: then it shows again. */
function offlineNoticeSeen(): boolean {
  try {
    if (localStorage.getItem(OFFLINE_SEEN_KEY)) return true;
    localStorage.setItem(OFFLINE_SEEN_KEY, "1");
  } catch {
    // no storage (private window): the notice may repeat, which is harmless
  }
  return false;
}

/** Asks before activating a new app version, so an edit in progress is never reloaded away. */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();
  const offlineChecked = useRef(false);

  // "ready offline" is only news once, and it hides itself; an available update waits for the user
  useEffect(() => {
    if (!offlineReady || needRefresh) return;
    if (!offlineChecked.current) {
      offlineChecked.current = true;
      if (offlineNoticeSeen()) {
        setOfflineReady(false);
        return;
      }
    }
    const timer = setTimeout(() => setOfflineReady(false), 5000);
    return () => clearTimeout(timer);
  }, [offlineReady, needRefresh, setOfflineReady]);

  if (!needRefresh && !offlineReady) return null;

  const close = () => {
    setNeedRefresh(false);
    setOfflineReady(false);
  };

  return (
    <div className={needRefresh ? styles.toast : `${styles.toast} ${styles.offline}`} role="status">
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
