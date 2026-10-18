import { useTranslation } from "react-i18next";
import { Bluetooth, Radio, Usb } from "lucide-react";
import { Placeholder } from "./Placeholder";
import styles from "./Page.module.css";

const hasBluetooth = typeof navigator !== "undefined" && "bluetooth" in navigator;
const hasSerial = typeof navigator !== "undefined" && "serial" in navigator;

export function PodPage() {
  const { t } = useTranslation();
  return (
    <Placeholder icon={Radio} intro={t("pod.intro")} phase="P2">
      <div className={styles.actions}>
        <button className={styles.bigButton} disabled title={hasBluetooth ? undefined : t("pod.bleUnsupported")}>
          <Bluetooth size={20} aria-hidden />
          {t("pod.bluetooth")}
        </button>
        <button className={styles.bigButton} disabled title={hasSerial ? undefined : t("pod.serialUnsupported")}>
          <Usb size={20} aria-hidden />
          {t("pod.usb")}
        </button>
      </div>
      {!hasBluetooth && <p className={styles.hint}>{t("pod.bleUnsupported")}</p>}
      <p className={styles.hint}>{t("pod.menuHint")}</p>
    </Placeholder>
  );
}
