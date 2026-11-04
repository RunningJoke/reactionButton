import { useSyncExternalStore, type ReactNode } from "react";
import styles from "./Split.module.css";

const DESKTOP = "(min-width: 900px)";
const subscribe = (onChange: () => void) => {
  const query = window.matchMedia?.(DESKTOP);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
};

/** True from 900 px (the rail layout), for content that only exists on desktop (e.g. a second live view). */
export function useDesktop(): boolean {
  return useSyncExternalStore(subscribe, isDesktop, () => false);
}

/** The current viewport, read once (for links and back targets outside render). */
export function isDesktop(): boolean {
  return window.matchMedia?.(DESKTOP).matches ?? false;
}

/**
 * Desktop two-column page (#107): `children` left, `side` right and sticky. Below 900 px one column,
 * `side` after the main content (or left out with `sideOnPhone={false}`, when the phone shows it elsewhere).
 */
export function Split({ children, side, sideOnPhone = true, className }: { children: ReactNode; side: ReactNode; sideOnPhone?: boolean; className?: string }) {
  return (
    <div className={`${styles.split} ${className ?? ""}`}>
      <div className={styles.main}>{children}</div>
      <aside className={`${styles.side} ${sideOnPhone ? "" : styles.desktopOnly}`}>{side}</aside>
    </div>
  );
}
