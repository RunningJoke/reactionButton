/**
 * Keeps the screen on while `enabled`, used by the training view (#46). Guarded: a browser without
 * the Wake Lock API, or a refused request (battery saver, hidden tab), changes nothing.
 *
 * Known PWA limit: the screen can still lock (the browser releases the lock on hidden tabs and some
 * phones ignore it), and BLE drops then. The sessions reconnect while the page lives (session.ts).
 */
import { useEffect } from "react";

export function useScreenWakeLock(enabled: boolean) {
  useEffect(() => {
    const wakeLock = typeof navigator !== "undefined" ? navigator.wakeLock : undefined;
    if (!enabled || !wakeLock) return;
    let sentinel: WakeLockSentinel | null = null;
    let active = true;

    const request = async () => {
      try {
        const lock = await wakeLock.request("screen");
        if (!active) {
          void lock.release().catch(() => undefined);
          return;
        }
        sentinel = lock;
        // the browser releases the lock when the tab is hidden: take it again when shown
        lock.addEventListener("release", () => {
          if (sentinel === lock) sentinel = null;
        });
      } catch {
        // refused: the screen may lock as usual
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && !sentinel) void request();
    };

    void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
  }, [enabled]);
}
