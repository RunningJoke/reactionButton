import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CircleCheck, Download, Info } from "lucide-react";
import { useScreenWakeLock } from "../app/wakeLock";
import { Sheet } from "../components/Sheet";
import { OTA_CHUNK, OTA_STEPS, otaBlocker, type OtaBlocker } from "../pod/ota";
import { closeUpdate, otaTiming, reconnectUsb, startUpdate, useOtaFlow, type OtaFlow } from "../pod/otaFlow";
import { PodError } from "../pod/protocol";
import { needsPin, usePodSession } from "../pod/session";
import page from "./Page.module.css";
import styles from "./PodPage.module.css";

/** Seconds left from the rate since the upload (re)started; null until a few chunks are through (the rate is noise before). */
export function secondsLeft(flow: Pick<OtaFlow, "done" | "total" | "startDone" | "startedAt">, now: number): number | null {
  const sent = flow.done - flow.startDone;
  const elapsed = now - flow.startedAt;
  if (flow.startDone < 0 || sent < 5 * OTA_CHUNK || elapsed <= 0) return null;
  return Math.ceil(((flow.total - flow.done) * elapsed) / sent / 1000);
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** The update of the connected pod (#129). Rendered by the pod page; the flow itself lives in pod/otaFlow.ts. */
export function UpdateSheet() {
  const { t } = useTranslation();
  const flow = useOtaFlow();
  const session = usePodSession();
  const [pin, setPin] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  useScreenWakeLock(flow.phase === "running");
  // the checks read the pod's state as it is now, not as it was at the last refresh
  const confirming = flow.phase === "confirm";
  useEffect(() => {
    if (confirming) void usePodSession.getState().refreshStatus();
  }, [confirming]);
  if (!flow.phase) return null;

  const info = session.info;
  const blocker: OtaBlocker | null = info ? otaBlocker(info, session.status, needsPin(session)) : null;
  const running = flow.phase === "running";
  const activated = running && (flow.step === "restarting" || flow.step === "testing");
  const central = session.role === "central";
  const hasPods = (session.status?.pods?.length ?? 0) > 0;

  const start = async () => {
    setRefusal(null);
    try {
      if (blocker === "needsPin") await session.authenticate(pin);
      await session.refreshStatus();
      const s = usePodSession.getState();
      const again = s.info ? otaBlocker(s.info, s.status, needsPin(s)) : "unsupported";
      if (again) return setRefusal(`blocked.${again}`);
      void startUpdate();
    } catch (e) {
      setRefusal(`errors.${e instanceof PodError ? e.code : "unknown"}`);
    }
  };

  const left = running && flow.step === "sending" ? secondsLeft(flow, otaTiming.now()) : null;
  const percent = flow.total > 0 ? Math.floor((flow.done * 100) / flow.total) : 0;
  const from = flow.from;

  return (
    <Sheet
      title={t("firmware.flow.title")}
      sub={t("firmware.flow.sub", { from, to: flow.version })}
      icon={<Download size={18} aria-hidden />}
      onClose={() => (running ? setClosing(true) : closeUpdate())}
    >
      <div className={styles.updateBody} aria-live="polite">
        {closing && running && (
          <div className={page.section} role="alertdialog" aria-label={t("firmware.flow.stopAsk")}>
            <p className={styles.warn}>{t(activated ? "firmware.flow.stopWatching" : "firmware.flow.stopAsk")}</p>
            <div className={styles.firmwareActions}>
              <button className={styles.textButton} onClick={() => setClosing(false)}>
                {t("firmware.flow.keepGoing")}
              </button>
              <button className={`${styles.textButton} ${styles.primaryButton}`} onClick={closeUpdate}>
                {t(activated ? "firmware.flow.stopWatchingYes" : "firmware.flow.stopYes")}
              </button>
            </div>
          </div>
        )}
        {flow.phase === "confirm" && (
          <>
            {blocker && blocker !== "needsPin" ? (
              <p className={styles.warn}>
                <AlertTriangle size={14} aria-hidden /> {t(`firmware.flow.blocked.${blocker}`)}
              </p>
            ) : (
              <p className={styles.note}>
                <Info size={14} aria-hidden /> {t("firmware.flow.keepOn")}
              </p>
            )}
            {blocker === "needsPin" && (
              <>
                <label htmlFor="ota-pin">{t("pod.pin")}</label>
                <input
                  id="ota-pin"
                  className={styles.pinInput}
                  value={pin}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                />
              </>
            )}
            {refusal && (
              <p className={styles.warn} role="alert">
                {t([`firmware.flow.${refusal}`, "firmware.flow.errors.unknown"])}
              </p>
            )}
            <div className={styles.firmwareActions}>
              <button
                className={`${styles.textButton} ${styles.primaryButton}`}
                disabled={(!!blocker && blocker !== "needsPin") || (blocker === "needsPin" && !pin)}
                onClick={() => void start()}
              >
                {t("firmware.flow.start")}
              </button>
              <button className={styles.textButton} onClick={closeUpdate}>
                {t("firmware.flow.cancel")}
              </button>
            </div>
            {central && hasPods && <p className={styles.note}>{t("firmware.flow.peripherals")}</p>}
          </>
        )}

        {(running || flow.phase === "done" || flow.phase === "error") && (
          <ol className={styles.steps}>
            {OTA_STEPS.map((step, i) => {
              // a rollback or an unconfirmed result is a failure of the check, never a finished "Done"
              const failed = flow.phase === "error" || (flow.phase === "done" && flow.outcome !== "success");
              const at = flow.phase === "done" && failed ? OTA_STEPS.indexOf("testing") : flow.step ? OTA_STEPS.indexOf(flow.step) : -1;
              const state = flow.phase === "done" && !failed ? "done" : i < at ? "done" : i === at ? (failed ? "failed" : "current") : "todo";
              return (
                <li key={step} data-state={state} aria-current={state === "current" ? "step" : undefined}>
                  <span className={styles.stepMark} aria-hidden>
                    {state === "done" ? "✓" : state === "failed" ? "!" : state === "current" ? "›" : ""}
                  </span>
                  {t(`firmware.flow.steps.${step}`)}
                </li>
              );
            })}
          </ol>
        )}

        {running && flow.step === "sending" && (
          <div>
            <progress className={styles.progress} value={flow.done} max={flow.total || 1} aria-label={t("firmware.flow.steps.sending")} />
            <p className={styles.note}>
              <span className={styles.counter}>{percent} %</span>
              {left !== null && ` · ${t("firmware.flow.left", { time: clock(left) })}`}
            </p>
          </div>
        )}
        {running && flow.step === "testing" && <p className={styles.warn}>{t("firmware.flow.testNote")}</p>}
        {running && flow.step === "restarting" && (
          <>
            <p className={styles.note}>{t(flow.needsReconnect ? "firmware.flow.reconnectUsb" : "firmware.flow.restartNote")}</p>
            {flow.needsReconnect && (
              <button className={`${styles.textButton} ${styles.primaryButton}`} onClick={reconnectUsb}>
                {t("firmware.flow.reconnect")}
              </button>
            )}
          </>
        )}
        {running && flow.step === "preparing" && <p className={styles.note}>{t("firmware.flow.preparingNote")}</p>}

        {flow.phase === "done" && flow.outcome && (
          <p className={flow.outcome === "success" ? styles.ok : styles.warn} role="status">
            {flow.outcome === "success" ? <CircleCheck size={14} aria-hidden /> : <AlertTriangle size={14} aria-hidden />}{" "}
            {t(`firmware.flow.outcome.${flow.outcome}`, { version: flow.version, installed: from })}
          </p>
        )}
        {flow.phase === "error" && flow.error && (
          <p className={styles.warn} role="alert">
            <AlertTriangle size={14} aria-hidden />{" "}
            {t([`firmware.flow.errors.${flow.error}`, `firmware.errors.${flow.error}`, "firmware.flow.errors.unknown"])}
          </p>
        )}
        {(flow.phase === "done" || flow.phase === "error") && (
          <div className={styles.firmwareActions}>
            <button className={`${styles.textButton} ${styles.primaryButton}`} onClick={closeUpdate}>
              {t("firmware.flow.close")}
            </button>
          </div>
        )}

      </div>
    </Sheet>
  );
}
