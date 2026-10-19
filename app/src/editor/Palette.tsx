import { useTranslation } from "react-i18next";
import { BookLock, Plus } from "lucide-react";
import { Sheet } from "../components/Sheet";
import { BLOCK_TYPES, type BlockCategory } from "@reactpod/program-model";
import { blockIcon } from "./blockStyle";
import styles from "./Inspector.module.css";

const CATEGORIES: BlockCategory[] = ["light", "wait", "input", "logic", "remote", "stats"];

type Props = {
  /** where the block goes: after this block, or connected to this port */
  context: string | null;
  /** library fragments that can be copied in (templates) */
  templates: readonly string[];
  /** types the connected pod can run (others are marked) */
  supportedTypes?: readonly string[];
  onPick: (type: string) => void;
  onTemplate: (path: string) => void;
  onClose: () => void;
};

/** Block palette, grouped like docs/app/spec.md §7.3. */
export function Palette({ context, templates, supportedTypes, onPick, onTemplate, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <Sheet title={t("editor.addBlock")} icon={<Plus size={18} aria-hidden />} sub={context ?? t("editor.addAtEnd")} onClose={onClose}>
      {CATEGORIES.map((category) => (
        <section key={category} className={styles.paletteGroup} data-category={category}>
          <h4>{t(`categories.${category}`)}</h4>
          <div className={styles.paletteGrid}>
            {BLOCK_TYPES.filter((d) => d.category === category).map((def) => {
              const Icon = blockIcon(def.type);
              const unsupported = supportedTypes && !supportedTypes.includes(def.type);
              return (
                <button key={def.type} type="button" className={styles.paletteItem} onClick={() => onPick(def.type)}>
                  <Icon size={20} aria-hidden />
                  <span>
                    <strong>{t(`blocks.${def.type}.name`)}</strong>
                    {unsupported && <span className={styles.warnText}> · {t("editor.unsupported")}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {templates.length > 0 && (
        <section className={styles.paletteGroup}>
          <h4>{t("editor.templates")}</h4>
          <p className={styles.fieldHelp}>{t("editor.templatesHelp")}</p>
          <div className={styles.paletteGrid}>
            {templates.map((path) => (
              <button key={path} type="button" className={styles.paletteItem} onClick={() => onTemplate(path)}>
                <BookLock size={20} aria-hidden />
                <span>
                  <strong>{path.split("/").pop()!.replace(/\.json$/, "")}</strong>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </Sheet>
  );
}
