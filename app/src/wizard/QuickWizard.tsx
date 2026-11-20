/**
 * New game (docs/app/editor-ux.md §4 B, #147 A2): one screen – game, pods, rounds, colour, name. Everything
 * else starts from the game's defaults and is changed afterwards in the game settings. "More options" goes on
 * with the same answers into the guided questions (rounds and timing, colours, measure) and its Ready screen.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { usePodSession } from "../pod/session";
import { useTakenPaths } from "../programs/actions";
import { gameUrl } from "../programs/sources";
import { useWorkspace } from "../store/workspace";
import { GAMES, LIMITS, TARGET_COLORS, answerProblems, gameNeeds, withGame, type GameId } from "./answers";
import { generateProgram, loopFormFor, storyField } from "./generate";
import { Stepper, Swatches } from "./controls";
import { WIZARD_PATH, useWizard } from "./wizardStore";
import styles from "./Wizard.module.css";

/** The guided question after game and pods: rounds and timing. */
const MORE_STEP = 2;

export function QuickWizard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { answers: a, update, setStep } = useWizard();
  const programFormat = usePodSession((s) => (s.state === "connected" ? s.info?.programFormat : undefined));
  // pods of the connected set besides the main pod (#147 A4)
  const setPods = usePodSession((s) => (s.state === "connected" && s.status?.pods ? s.status.pods.length : undefined));
  const form = loopFormFor(programFormat);
  const add = useWorkspace((s) => s.add);
  const taken = useTakenPaths();
  const [busy, setBusy] = useState(false);
  const gameName = t(`wizard.games.${a.game}.name`);
  const min = gameNeeds(a.game).minPods;
  const usesPods = a.game !== "solo" && a.game !== "duo";
  const problems = answerProblems(a);
  const name = a.name;
  const json = useMemo(
    () => ({
      ...generateProgram({ ...a, name: name.trim() || gameName }, form),
      description: t(`wizard.games.${a.game}.line`),
      story: storyField(a, (lang) => i18n.getFixedT(lang)),
    }),
    [a, name, gameName, form, t, i18n],
  );

  // a connected set knows its pods: start from them
  useEffect(() => {
    if (setPods !== undefined && setPods > 0) update((x) => ({ ...x, pods: Math.min(7, setPods) }));
  }, [setPods]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (game: GameId) =>
    update((x) => {
      const next = withGame(x, game);
      return { ...next, pods: Math.max(next.pods, gameNeeds(next.game).minPods) };
    });

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

  const more = () => {
    if (!name.trim()) update((x) => ({ ...x, name: gameName }));
    setStep(MORE_STEP);
    navigate(WIZARD_PATH);
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
          <span className={styles.fieldLabel} id="quick-game">
            {t("quick.game")}
          </span>
          {/* the same games as the guided path, as compact cards (#147 A3) */}
          <div className={styles.compactCards} role="radiogroup" aria-labelledby="quick-game">
            {GAMES.map((game) => {
              const need = gameNeeds(game).minPods;
              return (
                <button key={game} type="button" role="radio" aria-checked={a.game === game} className={styles.compactChoice} onClick={() => pick(game)}>
                  <span className={styles.choiceText}>
                    <strong>{t(`wizard.games.${game}.name`)}</strong>
                    <span>{t(`wizard.games.${game}.line`)}</span>
                    <span className={styles.tag}>{need === 0 ? t("wizard.game.centralOnly") : t("wizard.game.needs", { count: need })}</span>
                  </span>
                  {a.game === game && <Check size={20} aria-hidden className={styles.checkMark} />}
                </button>
              );
            })}
          </div>
        </div>

        {usesPods && (
          <div className={styles.field}>
            <Stepper label={t("wizard.pods.label")} value={Math.max(a.pods, min)} min={min} max={7} onChange={(pods) => update((x) => ({ ...x, pods }))} />
            {setPods !== undefined && setPods > 0 && <p className={styles.muted}>{t("quick.fromSet", { count: setPods })}</p>}
          </div>
        )}
        <Stepper label={t("wizard.timing.rounds")} value={a.rounds} min={LIMITS.rounds.min} max={LIMITS.rounds.max} onChange={(rounds) => update((x) => ({ ...x, rounds }))} />
        <Swatches label={t("wizard.colors.target")} value={a.color} colors={TARGET_COLORS} disabled={a.game === "multi" && a.redPods > 0 ? ["red"] : []} onChange={(color) => update((x) => ({ ...x, color }))} />

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="quick-name">
            {t("wizard.ready.name")}
          </label>
          <input id="quick-name" className={styles.input} value={name} placeholder={gameName} maxLength={40} onChange={(e) => update((x) => ({ ...x, name: e.target.value }))} />
        </div>

        {problems.map((p) => (
          <p key={p} className={styles.problem} role="alert">
            <AlertTriangle size={18} aria-hidden /> {t(`wizard.problems.${p}`, { game: gameName, count: min })}
          </p>
        ))}
        <button type="button" className={styles.moreOptions} disabled={problems.length > 0} onClick={more}>
          <span>
            <strong>{t("quick.more")}</strong>
            <span>{t("quick.moreLine")}</span>
          </span>
          <ChevronRight size={20} aria-hidden />
        </button>
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
