/**
 * Quick game (docs/app/editor-ux.md §4 B): the whole wizard on one screen – game, pods, rounds, colour,
 * name. Everything else starts from the game's defaults and is changed afterwards in the game
 * settings (the same panel every game has). The guided wizard (WizardPage) stays for the other questions.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, SlidersHorizontal, X } from "lucide-react";
import { usePodSession } from "../pod/session";
import { useTakenPaths } from "../programs/actions";
import { gameUrl } from "../programs/sources";
import { useWorkspace } from "../store/workspace";
import { GAMES, LIMITS, TARGET_COLORS, answerProblems, gameNeeds, withGame, type GameId } from "./answers";
import { generateProgram, loopFormFor } from "./generate";
import { Stepper, Swatches } from "./controls";
import { useWizard } from "./wizardStore";
import styles from "./Wizard.module.css";

export function QuickWizard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { answers: a, update } = useWizard();
  const programFormat = usePodSession((s) => (s.state === "connected" ? s.info?.programFormat : undefined));
  const form = loopFormFor(programFormat);
  const add = useWorkspace((s) => s.add);
  const taken = useTakenPaths();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const gameName = t(`wizard.games.${a.game}.name`);
  const min = gameNeeds(a.game).minPods;
  const usesPods = a.game !== "solo" && a.game !== "duo";
  const problems = answerProblems(a);
  const json = useMemo(() => ({ ...generateProgram({ ...a, name: name.trim() || gameName }, form), description: t(`wizard.games.${a.game}.line`) }), [a, name, gameName, form, t]);

  const create = async (adjust: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const doc = await add(json, "local", { taken });
      useWizard.getState().start();
      navigate(`${gameUrl({ id: doc.id }, adjust ? "edit" : "about")}${adjust ? "&panel=settings" : ""}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <button type="button" className={styles.iconButton} aria-label={t("wizard.cancel")} title={t("wizard.cancel")} onClick={() => navigate("/games")}>
          <X size={22} aria-hidden />
        </button>
        <div className={styles.topText}>
          <h2 className={styles.title}>{t("quick.title")}</h2>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="quick-game">
            {t("quick.game")}
          </label>
          <select
            id="quick-game"
            className={styles.input}
            value={a.game}
            onChange={(e) =>
              update((x) => {
                const next = withGame(x, e.target.value as GameId);
                return { ...next, pods: Math.max(next.pods, gameNeeds(next.game).minPods) };
              })
            }
          >
            {GAMES.map((g) => (
              <option key={g} value={g}>
                {t(`wizard.games.${g}.name`)}
              </option>
            ))}
          </select>
          <p className={styles.muted}>{t(`wizard.games.${a.game}.line`)}</p>
        </div>

        {usesPods && <Stepper label={t("wizard.pods.label")} value={Math.max(a.pods, min)} min={min} max={7} onChange={(pods) => update((x) => ({ ...x, pods }))} />}
        <Stepper label={t("wizard.timing.rounds")} value={a.rounds} min={LIMITS.rounds.min} max={LIMITS.rounds.max} onChange={(rounds) => update((x) => ({ ...x, rounds }))} />
        <Swatches label={t("wizard.colors.target")} value={a.color} colors={TARGET_COLORS} disabled={a.game === "multi" && a.redPods > 0 ? ["red"] : []} onChange={(color) => update((x) => ({ ...x, color }))} />

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="quick-name">
            {t("wizard.ready.name")}
          </label>
          <input id="quick-name" className={styles.input} value={name} placeholder={gameName} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </div>

        {problems.map((p) => (
          <p key={p} className={styles.problem} role="alert">
            <AlertTriangle size={18} aria-hidden /> {t(`wizard.problems.${p}`, { game: gameName, count: min })}
          </p>
        ))}
        <p className={styles.muted}>{t("quick.hint")}</p>
      </div>

      <div className={styles.bar}>
        <button type="button" className={styles.button} disabled={busy || problems.length > 0} onClick={() => void create(true)}>
          <SlidersHorizontal size={18} aria-hidden /> {t("quick.createAdjust")}
        </button>
        <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy || problems.length > 0} onClick={() => void create(false)}>
          {t("quick.create")}
        </button>
      </div>
    </div>
  );
}
