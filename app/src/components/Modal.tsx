import { useEffect, useRef, type ReactNode } from "react";
import styles from "./Modal.module.css";

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** buttons, right aligned */
  actions?: ReactNode;
};

/** Small modal dialog (confirmations, a name to enter). Bottom sheet on phones. */
export function Modal({ open, title, onClose, children, actions }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || typeof dialog.showModal !== "function") return; // jsdom
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className={styles.dialog} onClose={onClose} onClick={(e) => e.target === e.currentTarget && onClose()}>
      {open && (
        <div className={styles.content}>
          <h2>{title}</h2>
          {children}
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      )}
    </dialog>
  );
}

export { styles as modalStyles };
