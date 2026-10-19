import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./HoldButton.module.css";

type Props = {
  /** how long to hold, ms */
  holdMs?: number;
  onConfirm: () => void;
  disabled?: boolean;
  children: ReactNode;
};

/** A destructive button that only fires after being held (pointer, or Space / Enter held). */
export function HoldButton({ holdMs = 1500, onConfirm, disabled, children }: Props) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const start = () => {
    if (disabled || timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onConfirm();
    }, holdMs);
  };
  useEffect(() => stop, []);

  return (
    <button
      type="button"
      className={styles.button}
      data-holding={holding || undefined}
      style={{ "--hold-ms": `${holdMs}ms` } as React.CSSProperties}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={stop}
      onBlur={stop}
    >
      <span className={styles.fill} aria-hidden />
      <span className={styles.label}>{children}</span>
    </button>
  );
}
