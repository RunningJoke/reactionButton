/**
 * "Add a step" by intent (docs/app/editor-ux.md §4 E): recipes on top, then one tile per thing a
 * step does. In expert mode (§4 H) the tiles name their block type and library parts come last.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Plus, WandSparkles } from "lucide-react";
import { blockType } from "@reactpod/program-model";
import { Sheet } from "../components/Sheet";
import { blockIcon } from "./blockStyle";
import { useExpertMode } from "./expertMode";
import { insertTemplate, ownBlocks, type ProgramJson } from "./ops";
import { LibraryParts } from "./Palette";
import { connectNewStep } from "./exits";
import { INTENT_GROUPS, INTENTS, RECIPES, applyRecipe, createStep, defaultInsertAfter, intentUnavailable, recipeUnavailable, type Intent, type Recipe } from "./stepRecipes";
import { stepList } from "./structure";
import styles from "./AddStepSheet.module.css";

export type AddStepSheetProps = {
  doc: ProgramJson;
  /** add after this step's block (else: end of the round / program) */
  after?: string;
  supportedTypes?: readonly string[];
  /** the connected pod's program format: tiles it cannot run are marked and off */
  programFormat?: number;
  /** new program + the block to select */
  onAdd: (doc: ProgramJson, focus: string) => void;
  onClose: () => void;
  /** block names taken besides the program's own (blocks of included files) */
  taken?: ReadonlySet<string>;
  /** library parts offered in expert mode, as copies */
  library?: { paths: readonly string[]; read: (path: string) => string | undefined };
  /** the new step goes on this exit of a step (the exit picker's "a new step here…") instead of into the flow */
  connect?: { from: string; port: string };
};

export function AddStepSheet({ doc, after, supportedTypes, programFormat, onAdd, onClose, taken, library, connect }: AddStepSheetProps) {
  const { t } = useTranslation();
  const [expert] = useExpertMode();

  const where = useMemo(() => {
    if (ownBlocks(doc).length === 0) return t("editor.add.first");
    const steps = stepList(doc);
    const picked = after ? steps.find((s) => s.block === after && !s.loop) : undefined;
    if (picked?.number) return t("editor.add.afterStep", { n: picked.number });
    const at = after ?? defaultInsertAfter(doc);
    return steps.find((s) => s.block === at)?.inLoop ? t("editor.add.endOfRound") : t("editor.add.end");
  }, [doc, after, t]);

  const names = useMemo(() => new Set([...ownBlocks(doc).map((b) => b.name), ...(taken ?? [])]), [doc, taken]);
  const intents = INTENTS.map((intent) => ({ ...intent, reason: intentUnavailable(intent.id, doc, { after, supportedTypes, programFormat }) }));
  const recipes = RECIPES.map((id) => ({ id, reason: recipeUnavailable(id, doc, { after }) }));

  const addIntent = (id: Intent) => {
    const added = createStep(id, doc, after, { taken: names });
    onAdd(connect ? connectNewStep(doc, added.doc, connect.from, connect.port, added.focus) : added.doc, added.focus);
  };
  const addRecipe = (id: Recipe) => {
    const added = applyRecipe(id, doc, after, { taken: names });
    onAdd(added.doc, added.focus);
  };
  const addPart = (path: string) => {
    const text = library?.read(path);
    if (!text) return;
    const { doc: next, names: added } = insertTemplate(doc, JSON.parse(text) as ProgramJson, names);
    if (added[0]) onAdd(next, added[0]);
  };

  return (
    <Sheet title={t("editor.add.title")} icon={<Plus size={18} aria-hidden />} sub={where} onClose={onClose}>
      {!connect && (
      <section className={styles.group} aria-labelledby="add-recipes">
        <h4 id="add-recipes">{t("editor.add.recipes")}</h4>
        {recipes.map(({ id, reason }) => (
          <button key={id} type="button" className={styles.recipe} disabled={!!reason} onClick={() => addRecipe(id)}>
            <WandSparkles size={20} aria-hidden />
            <span className={styles.text}>
              <strong>{t(`editor.add.recipe.${id}.name`)}</strong>
              <span className={reason ? styles.reason : undefined}>{reason ? t(`editor.add.reason.${reason}`) : t(`editor.add.recipe.${id}.hint`)}</span>
            </span>
          </button>
        ))}
      </section>
      )}

      <section className={styles.group} aria-labelledby="add-steps">
        <h4 id="add-steps">{t("editor.add.steps")}</h4>
        {INTENT_GROUPS.map(([group, ids]) => (
          <div key={group} role="group" aria-label={t(`editor.add.group.${group}`)}>
            <h5 className={styles.subgroup}>{t(`editor.add.group.${group}`)}</h5>
            <div className={styles.tiles}>
              {intents
                .filter((i) => (ids as readonly string[]).includes(i.id))
                .map(({ id, type, reason }) => {
                  const Icon = blockIcon(type);
                  return (
                    <button key={id} type="button" className={styles.tile} data-category={blockType(type)?.category} disabled={!!reason} onClick={() => addIntent(id)}>
                      <Icon size={20} aria-hidden />
                      <strong>{t(`editor.add.intent.${id}.name`)}</strong>
                      {expert && <code>{type}</code>}
                      {reason ? (
                        <span className={styles.reason}>{t(`editor.add.reason.${reason}`)}</span>
                      ) : (
                        !expert && <span>{t(`editor.add.intent.${id}.hint`)}</span>
                      )}
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </section>

      {expert && library && <LibraryParts paths={library.paths} title={t("editor.add.library")} help={t("editor.add.libraryHint")} onPick={addPart} />}
    </Sheet>
  );
}
