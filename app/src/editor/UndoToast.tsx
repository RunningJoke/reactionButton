import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Undo2 } from "lucide-react";
import styles from "./UndoToast.module.css";

const SHOW_MS = 6000;

/** "Step deleted · Undo" above the floating +; hides itself after a few seconds. */
export function UndoToast({ text, onUndo, onClose }: { text: string; onUndo: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const timer = setTimeout(onClose, SHOW_MS);
    return () => clearTimeout(timer);
  }, [onClose, text]);
  return (
    <div className={styles.toast} role="status">
      <span>{text}</span>
      <button
        type="button"
        onClick={() => {
          onUndo();
          onClose();
        }}
      >
        <Undo2 size={18} aria-hidden /> {t("editor.step.undo")}
      </button>
    </div>
  );
}
