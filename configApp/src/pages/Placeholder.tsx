import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Construction, type LucideIcon } from "lucide-react";
import styles from "./Page.module.css";

type Props = {
  icon: LucideIcon;
  intro: string;
  phase: string;
  children?: ReactNode;
};

/** Page frame for screens that are built in a later phase. */
export function Placeholder({ icon: Icon, intro, phase, children }: Props) {
  const { t } = useTranslation();
  return (
    <div className={styles.page}>
      <div className={styles.empty}>
        <Icon size={40} aria-hidden className={styles.emptyIcon} />
        <p>{intro}</p>
        {children}
        <p className={styles.phase}>
          <Construction size={16} aria-hidden />
          {t("placeholder.comingIn", { phase })}
        </p>
      </div>
    </div>
  );
}
