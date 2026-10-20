import { useState } from "react";
import { useTranslation } from "react-i18next";
import { HoldButton } from "../components/HoldButton";
import { Modal, modalStyles } from "../components/Modal";
import { setLanguage, storedLanguage, type Language } from "../i18n";
import { INDEX_PATH, isLibraryPath } from "@reactpod/program-model";
import { PodError } from "../pod/protocol";
import { isReadOnly, needsPin, usePodSession } from "../pod/session";
import { deleteFiles } from "../pod/syncActions";
import styles from "./Page.module.css";

type Choice = Language | "system";

export function SettingsPage() {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<Choice>(() => storedLanguage() ?? "system");

  const choose = (next: Choice) => {
    setChoice(next);
    setLanguage(next === "system" ? null : next);
  };

  const options: { value: Choice; label: string }[] = [
    { value: "system", label: t("settings.languageSystem") },
    { value: "en", label: "English" },
    { value: "de", label: "Deutsch" },
  ];

  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <h2 id="language-label">{t("settings.language")}</h2>
        <div className={styles.segmented} role="radiogroup" aria-labelledby="language-label">
          {options.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="language"
                value={option.value}
                checked={choice === option.value}
                onChange={() => choose(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </section>

      <DebugConsole />

      <section className={styles.section}>
        <h2>{t("settings.about")}</h2>
        <p className={styles.muted}>
          {t("app.title")} · {t("settings.version", { version: __APP_VERSION__ })}
        </p>
      </section>
    </div>
  );
}

function DebugConsole() {
  const { t } = useTranslation();
  const log = usePodSession((s) => s.log);
  const clearLog = usePodSession((s) => s.clearLog);
  return (
    <section className={styles.section}>
      <h2>{t("settings.advanced")}</h2>
      <details className={styles.details}>
        <summary>{t("settings.console")}</summary>
        <p className={styles.muted}>{t("settings.consoleHint")}</p>
        <pre className={styles.console} aria-live="polite">
          {log.length === 0
            ? t("settings.consoleEmpty")
            : log.map((entry, i) => (
                <span key={i} data-kind={entry.kind}>
                  {`${entry.text}\n`}
                </span>
              ))}
        </pre>
        <button className={styles.textButton} onClick={clearLog} disabled={log.length === 0}>
          {t("settings.clear")}
        </button>
      </details>
      <DeleteFiles />
    </section>
  );
}

/**
 * Deleting files on the pod (docs/app/spec.md §9.4): select files, then a dialog that names them and needs
 * a held button. Library parts and the menu are not offered; programs in the pod's menu cannot be
 * selected (remove them from the menu first, or the pod's menu would point to a missing file).
 */
function DeleteFiles() {
  const { t } = useTranslation();
  const session = usePodSession();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usable = session.state === "connected" && !isReadOnly(session) && session.list;
  const inMenu = new Set(session.list?.menu ?? []);
  const files = (session.list?.files ?? []).filter((f) => f.path !== INDEX_PATH && !isLibraryPath(f.path));
  const askPin = needsPin(session);

  const toggle = (path: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(path);
    else next.delete(path);
    setSelected(next);
  };
  const close = () => {
    if (busy) return;
    setConfirming(false);
    setPin("");
    setError(null);
  };
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (askPin) await session.authenticate(pin);
      await deleteFiles([...selected], (path) => toggle(path, false));
      setSelected(new Set());
      setConfirming(false);
      setPin("");
    } catch (e) {
      const code = e instanceof PodError ? e.code : "";
      setError(["auth_failed", "auth_required", "busy"].includes(code) ? t(`pod.errors.${code}`) : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className={styles.details}>
      <summary>{t("settings.deleteFiles")}</summary>
      {!usable ? (
        <p className={styles.muted}>{t("settings.deleteNotConnected")}</p>
      ) : (
        <>
          <p className={styles.muted}>{t("settings.deleteHint")}</p>
          <ul className={styles.checkList}>
            {files.map((f) => (
              <li key={f.path}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(f.path)}
                    disabled={inMenu.has(f.path)}
                    onChange={(e) => toggle(f.path, e.target.checked)}
                  />
                  <span className={styles.mono}>{f.path}</span>
                  {inMenu.has(f.path) && <span className={styles.muted}>{t("settings.inMenu")}</span>}
                </label>
              </li>
            ))}
          </ul>
          <button className={styles.textButton} disabled={selected.size === 0} onClick={() => setConfirming(true)}>
            {t("settings.deleteSelected", { count: selected.size })}
          </button>
        </>
      )}
      <Modal
        open={confirming}
        title={t("settings.deleteTitle")}
        onClose={close}
        actions={
          <>
            <button className={modalStyles.button} onClick={close} disabled={busy}>
              {t("common.cancel")}
            </button>
            <HoldButton onConfirm={() => void run()} disabled={busy || (askPin && !pin)}>
              {t("settings.holdToDelete")}
            </HoldButton>
          </>
        }
      >
        <p>{t("settings.deleteText")}</p>
        <ul>
          {[...selected].map((path) => (
            <li key={path} className={styles.mono}>
              {path}
            </li>
          ))}
        </ul>
        {askPin && (
          <>
            <label htmlFor="delete-pin">{t("pod.pin")}</label>
            <input
              id="delete-pin"
              className={modalStyles.input}
              value={pin}
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
          </>
        )}
        {error && <p className={modalStyles.error}>{error}</p>}
      </Modal>
    </details>
  );
}
