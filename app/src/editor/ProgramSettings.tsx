import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Layers, Minus, Plus, Settings2, Trash2 } from "lucide-react";
import { Sheet } from "../components/Sheet";
import { isLibraryPath, MAX_PERIPHERALS } from "@reactpod/program-model";
import { BUILTIN_VARIABLES, isObject } from "@reactpod/program-model";
import { MenuPatternField, NumberInput } from "./fields";
import { isValidVariableName, renameVariable, setProgramField, uniqueName, type ProgramJson } from "./ops";
import styles from "./Inspector.module.css";

type Props = {
  json: ProgramJson;
  path: string;
  /** block names for the start select */
  names: readonly string[];
  /** library files that can be included as presets */
  library: readonly string[];
  apply: (json: ProgramJson, options?: { mergeKey?: string }) => void;
  onFlatten: () => void;
  onClose: () => void;
};

/** Program header: name, description, pods, start, variables, menu pattern, presets. */
export function ProgramSettings({ json, path, names, library, apply, onFlatten, onClose }: Props) {
  const { t } = useTranslation();
  const set = (field: string, value: unknown, mergeKey?: string) => apply(setProgramField(json, field, value), mergeKey ? { mergeKey } : undefined);
  const peripherals = typeof json.peripherals === "number" ? json.peripherals : 0;
  const variables = isObject(json.variables) ? (json.variables as Record<string, unknown>) : {};
  const includes = Array.isArray(json.include) ? json.include.filter((p): p is string => typeof p === "string") : [];
  const addable = library.filter((p) => isLibraryPath(p) && !includes.includes(p));

  return (
    <Sheet title={t("editor.settings")} icon={<Settings2 size={18} aria-hidden />} sub={<code>{path}</code>} onClose={onClose}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="program-name">
          {t("editor.programName")}
        </label>
        <input
          id="program-name"
          className={styles.input}
          value={typeof json.name === "string" ? json.name : ""}
          onChange={(e) => set("name", e.target.value, "name")}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="program-description">
          {t("editor.description")}
        </label>
        <textarea
          id="program-description"
          className={styles.input}
          rows={3}
          value={typeof json.description === "string" ? json.description : ""}
          onChange={(e) => set("description", e.target.value === "" ? undefined : e.target.value, "description")}
        />
      </div>
      <div className={styles.field}>
        <span className={styles.label} id="peripherals-label">
          {t("editor.peripherals")}
        </span>
        <div className={styles.stepper} role="group" aria-labelledby="peripherals-label">
          <button type="button" aria-label={t("editor.fewerPods")} disabled={peripherals <= 0} onClick={() => set("peripherals", peripherals - 1)}>
            <Minus size={18} aria-hidden />
          </button>
          <output aria-live="polite">{peripherals}</output>
          <button type="button" aria-label={t("editor.morePods")} disabled={peripherals >= MAX_PERIPHERALS} onClick={() => set("peripherals", peripherals + 1)}>
            <Plus size={18} aria-hidden />
          </button>
          <span className={styles.muted}>{t("programs.pods", { count: peripherals + 1 })}</span>
        </div>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="program-start">
          {t("view.start")}
        </label>
        <select id="program-start" className={styles.input} value={typeof json.start === "string" ? json.start : ""} onChange={(e) => set("start", e.target.value || undefined)}>
          <option value="">{t("editor.startFirst")}</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <section className={styles.group}>
        <h4>{t("view.variables")}</h4>
        <p className={styles.fieldHelp}>{t("editor.variablesHelp", { builtins: BUILTIN_VARIABLES.join(", ") })}</p>
        {Object.entries(variables).map(([name, value]) => (
          <VariableRow
            key={name}
            name={name}
            value={typeof value === "number" ? value : 0}
            taken={Object.keys(variables)}
            onRename={(to) => apply(renameVariable(json, name, to))}
            onValue={(v) => set("variables", { ...variables, [name]: v ?? 0 }, `var.${name}`)}
            onDelete={() => {
              const next = { ...variables };
              delete next[name];
              set("variables", Object.keys(next).length ? next : undefined);
            }}
          />
        ))}
        <button
          type="button"
          className={styles.chip}
          onClick={() => set("variables", { ...variables, [uniqueName("VALUE", new Set(Object.keys(variables)))]: 0 })}
        >
          <Plus size={16} aria-hidden /> {t("editor.addVariable")}
        </button>
      </section>

      <section className={styles.group}>
        <h4>{t("programs.menuPattern")}</h4>
        <p className={styles.fieldHelp}>{t("editor.menuPatternHelp")}</p>
        <MenuPatternField value={json.menu} onChange={(groups) => set("menu", groups)} />
      </section>

      <section className={styles.group}>
        <h4>{t("editor.presets")}</h4>
        <p className={styles.fieldHelp}>{t("editor.presetsHelp")}</p>
        {includes.map((p) => (
          <div key={p} className={styles.portRow}>
            <Layers size={16} aria-hidden />
            <code className={styles.grow}>{p}</code>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t("editor.removePreset", { path: p })}
              onClick={() => {
                const next = includes.filter((x) => x !== p);
                set("include", next.length ? next : undefined);
              }}
            >
              <Trash2 size={16} aria-hidden />
            </button>
          </div>
        ))}
        {addable.length > 0 && (
          <select className={styles.input} value="" aria-label={t("editor.addPreset")} onChange={(e) => e.target.value && set("include", [...includes, e.target.value])}>
            <option value="">{t("editor.addPreset")}</option>
            {addable.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
        {includes.length > 0 && (
          <button type="button" className={styles.action} onClick={onFlatten}>
            {t("editor.flatten")}
          </button>
        )}
      </section>
    </Sheet>
  );
}

function VariableRow({
  name,
  value,
  taken,
  onRename,
  onValue,
  onDelete,
}: {
  name: string;
  value: number;
  taken: readonly string[];
  onRename: (to: string) => void;
  onValue: (value: number | undefined) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name]);
  const invalid = text !== name && (!isValidVariableName(text) || taken.includes(text) || (BUILTIN_VARIABLES as readonly string[]).includes(text));
  return (
    <div className={styles.varRow}>
      <input
        className={styles.input}
        value={text}
        aria-label={t("editor.variableName")}
        aria-invalid={invalid}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setText(e.target.value.replace(/\s/g, ""))}
        onBlur={() => (text !== name && !invalid ? onRename(text) : setText(name))}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <NumberInput value={value} onChange={onValue} label={t("editor.variableValue", { name })} />
      <button type="button" className={styles.iconButton} aria-label={t("editor.deleteVariable", { name })} onClick={onDelete}>
        <Trash2 size={16} aria-hidden />
      </button>
    </div>
  );
}
