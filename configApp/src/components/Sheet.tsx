import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import styles from "./Sheet.module.css";

type Props = {
  title: ReactNode;
  /** small line below the title */
  sub?: ReactNode;
  icon?: ReactNode;
  /** colour category of a block (sets the accent line) */
  category?: string;
  onClose: () => void;
  children: ReactNode;
};

/** Bottom sheet on phones, side panel on wide screens (≥ 900 px). Lives inside a positioned parent. */
export function Sheet({ title, sub, icon, category, onClose, children }: Props) {
  const { t } = useTranslation();
  return (
    <aside className={styles.sheet} data-category={category} aria-label={typeof title === "string" ? title : undefined}>
      <div className={styles.header}>
        {icon}
        <div className={styles.title}>
          <h3>{title}</h3>
          {sub && <span className={styles.sub}>{sub}</span>}
        </div>
        <button className={styles.close} onClick={onClose} aria-label={t("view.close")}>
          <X size={20} aria-hidden />
        </button>
      </div>
      {children}
    </aside>
  );
}
