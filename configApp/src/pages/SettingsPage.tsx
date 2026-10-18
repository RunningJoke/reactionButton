import { useState } from "react";
import { useTranslation } from "react-i18next";
import { setLanguage, storedLanguage, type Language } from "../i18n";
import { usePodSession } from "../pod/session";
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
    </section>
  );
}
