import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Layers, Plus, Settings2, Trash2 } from "lucide-react";
import { Sheet } from "../components/Sheet";
import { DEFAULT_FILES } from "../defaults";
import { BUILTIN_VARIABLES, formatProgram, isLibraryPath, isObject, MAX_PERIPHERALS, resolveProgram } from "@reactpod/program-model";
import { SetDrawing, Stepper } from "../wizard/controls";
import { MenuPatternField, NumberInput } from "./fields";
import { isValidVariableName, renameVariable, setProgramField, uniqueName, type ProgramJson } from "./ops";
import { settingLabel, settingRange, stepSetting, tweakableSettings } from "./settingLabels";
import { useExpertMode } from "./expertMode";
import styles from "./Inspector.module.css";
import own from "./ProgramSettings.module.css";

type Apply = (json: ProgramJson, options?: { mergeKey?: string }) => void;

type Props = {
  json: ProgramJson;
  path: string;
  /** block names for the start select */
  names: readonly string[];
  /** library files that can be included as presets */
  library: readonly string[];
  apply: Apply;
  onFlatten: () => void;
  onClose: () => void;
  /** reads included files (default: the shipped files), to find the settings that come from library parts */
  read?: (path: string) => string | undefined;
};

/**
 * Program sheet (editor-ux.md §4 F): basics (name, description, pods, menu pattern), the settings
 * a coach changes, and – in expert mode – start block, library parts and the raw variables.
 */
export function ProgramSettings({ json, path, names, library, apply, onFlatten, onClose, read }: Props) {
  const { t } = useTranslation();
  const [expert] = useExpertMode();
  const set = (field: string, value: unknown, mergeKey?: string) => apply(setProgramField(json, field, value), mergeKey ? { mergeKey } : undefined);
  const peripherals = typeof json.peripherals === "number" ? json.peripherals : 0;

  return (
    <Sheet title={t("editor.programSheet.title")} icon={<Settings2 size={18} aria-hidden />} sub={t("editor.programSheet.sub")} onClose={onClose}>
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
          rows={2}
          value={typeof json.description === "string" ? json.description : ""}
          onChange={(e) => set("description", e.target.value === "" ? undefined : e.target.value, "description")}
        />
      </div>
      <PodsField peripherals={peripherals} onChange={(n) => set("peripherals", n, "peripherals")} />

      <section className={styles.group}>
        <h4>{t("editor.programSheet.menu")}</h4>
        <p className={styles.fieldHelp}>{t("editor.menuPatternHelp")}</p>
        <MenuPatternField value={json.menu} onChange={(groups) => set("menu", groups)} />
      </section>

      <section className={styles.group}>
        <h4>{t("editor.programSheet.tweak")}</h4>
        <TweakSettings json={json} path={path} read={read} apply={apply} />
      </section>

      {expert && <ExpertSection json={json} names={names} library={library} path={path} apply={apply} onFlatten={onFlatten} />}
    </Sheet>
  );
}

/** "Pods besides the central": a drawing of the set and a stepper. */
export function PodsField({ peripherals, onChange }: { peripherals: number; onChange: (n: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className={own.pods}>
      <SetDrawing pods={peripherals} width={110} label={t("programs.pods", { count: peripherals + 1 })} />
      <div className={own.podsStepper}>
        <Stepper label={t("editor.programSheet.pods")} value={peripherals} min={0} max={MAX_PERIPHERALS} onChange={onChange} />
        <span className={styles.muted}>{t("editor.programSheet.podsTotal", { count: peripherals + 1 })}</span>
      </div>
    </div>
  );
}

/**
 * The program's variables as labelled steppers (settingLabels.ts): start values no block changes,
 * times in seconds. A value from a library part is overridden in the program's own variables.
 */
export function TweakSettings({ json, path, read, apply }: { json: ProgramJson; path: string; read?: (path: string) => string | undefined; apply: Apply }) {
  const { t } = useTranslation();
  const locale = t("wizard.numberLocale");
  const { variables, names } = useMemo(() => {
    const text = formatProgram(json);
    const resolved = resolveProgram(path, (p) => (p === path ? text : (read ?? readShipped)(p)));
    const blocks = resolved.blocks.map((b) => b.block);
    return { variables: resolved.variables, names: tweakableSettings(resolved.variables, blocks) };
  }, [json, path, read]);
  const peripherals = typeof json.peripherals === "number" ? json.peripherals : 0;
  if (names.length === 0) return <p className={styles.muted}>{t("editor.programSheet.tweakNone")}</p>;
  const ownVars = isObject(json.variables) ? (json.variables as Record<string, unknown>) : {};
  return (
    <div className={own.tweak}>
      {names.map((name) => {
        const label = settingLabel(name, t);
        const range = settingRange(name, peripherals);
        const value = variables[name] ?? 0;
        const format = (v: number) => {
          const shown = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(label.toDisplay(v));
          return label.unit === "s" ? `${shown} s` : shown;
        };
        return (
          <Stepper
            key={name}
            label={label.label}
            value={value}
            min={range.min}
            max={range.max}
            step={range.step}
            format={format}
            onChange={(v) => apply(setProgramField(json, "variables", { ...ownVars, [name]: stepSetting(value, range, v > value ? 1 : -1) }), { mergeKey: `var.${name}` })}
          />
        );
      })}
    </div>
  );
}

const readShipped = (p: string) => DEFAULT_FILES[p];

/** Start block, library parts ("convert to editable copy") and the raw variables table. */
function ExpertSection({ json, names, library, path, apply, onFlatten }: { json: ProgramJson; names: readonly string[]; library: readonly string[]; path: string; apply: Apply; onFlatten: () => void }) {
  const { t } = useTranslation();
  const set = (field: string, value: unknown, mergeKey?: string) => apply(setProgramField(json, field, value), mergeKey ? { mergeKey } : undefined);
  const variables = isObject(json.variables) ? (json.variables as Record<string, unknown>) : {};
  const includes = Array.isArray(json.include) ? json.include.filter((p): p is string => typeof p === "string") : [];
  const addable = library.filter((p) => isLibraryPath(p) && !includes.includes(p));

  return (
    <section className={own.expert} aria-label={t("editor.programSheet.expert")}>
      <h4>{t("editor.programSheet.expert")}</h4>
      <p className={styles.fieldHelp}>
        <code>{path}</code>
      </p>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="program-start">
          {t("editor.programSheet.start")}
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

      <div className={own.expertGroup}>
        <span className={styles.label}>{t("editor.presets")}</span>
        <p className={styles.fieldHelp}>{t("editor.presetsHelp")}</p>
        {includes.length === 0 && <p className={styles.muted}>{t("editor.programSheet.noPresets")}</p>}
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
      </div>

      <div className={own.expertGroup}>
        <span className={styles.label}>{t("view.variables")}</span>
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
      </div>
    </section>
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
