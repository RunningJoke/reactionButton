/**
 * Fields of the communicate block (programs.md §2, §7.16): `metrics` and `vars` as chip lists with
 * add and remove, `editable` as rows of name, min and max. Every action is a tap; the variables
 * are chosen from the program's own variables.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { MAX_LIST_ITEMS, MAX_NAME_CHARS } from "@reactpod/program-model";
import { NumberInput } from "./fields";
import styles from "./Inspector.module.css";

/** `metrics` / `vars`: the names in `items`, each with a remove button. Empty = the field is unset. */
export function NameListField({
  items,
  choices,
  label,
  placeholder,
  onChange,
}: {
  items: readonly string[];
  /** the names offered (program variables); with none, a free name is typed (metrics) */
  choices: readonly string[];
  label: string;
  placeholder: string;
  onChange: (items: string[] | undefined) => void;
}) {
  const { t } = useTranslation();
  const set = (next: string[]) => onChange(next.length ? next : undefined);
  const free = choices.length === 0;
  const open = choices.filter((c) => !items.includes(c));
  return (
    <div className={styles.chipList} role="group" aria-label={label}>
      {items.map((name) => (
        <span key={name} className={styles.chipItem}>
          <code>{name}</code>
          <button type="button" className={styles.chipRemove} aria-label={t("list.remove", { name })} onClick={() => set(items.filter((n) => n !== name))}>
            <X size={16} aria-hidden />
          </button>
        </span>
      ))}
      {items.length < MAX_LIST_ITEMS &&
        (free ? (
          <FreeName placeholder={placeholder} addLabel={t("list.add")} taken={items} onAdd={(name) => set([...items, name])} />
        ) : (
          open.length > 0 && (
            <select
              className={styles.input}
              value=""
              aria-label={t("list.addTo", { label })}
              onChange={(e) => e.target.value && set([...items, e.target.value])}
            >
              <option value="">{t("list.addOption")}</option>
              {open.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )
        ))}
    </div>
  );
}

function FreeName({ placeholder, addLabel, taken, onAdd }: { placeholder: string; addLabel: string; taken: readonly string[]; onAdd: (name: string) => void }) {
  const [text, setText] = useState("");
  const name = text.trim();
  const valid = name.length > 0 && name.length <= MAX_NAME_CHARS && !taken.includes(name);
  const add = () => {
    if (!valid) return;
    onAdd(name);
    setText("");
  };
  return (
    <span className={styles.chipAdd}>
      <input
        className={styles.input}
        value={text}
        placeholder={placeholder}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={MAX_NAME_CHARS}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
      />
      <button type="button" className={styles.chipAddButton} disabled={!valid} onClick={add} aria-label={addLabel}>
        <Plus size={18} aria-hidden />
      </button>
    </span>
  );
}

/** `editable`: one row per variable with its min and max (integers, min ≤ max). */
export function EditableField({
  value,
  choices,
  label,
  onChange,
}: {
  value: Record<string, { min: number; max: number }>;
  choices: readonly string[];
  label: string;
  onChange: (value: Record<string, { min: number; max: number }> | undefined) => void;
}) {
  const { t } = useTranslation();
  const entries = Object.entries(value);
  const set = (next: Record<string, { min: number; max: number }>) => onChange(Object.keys(next).length ? next : undefined);
  const open = choices.filter((c) => !(c in value));
  return (
    <div className={styles.editableList} role="group" aria-label={label}>
      {entries.map(([name, range]) => (
        <div key={name} className={styles.editableRow}>
          <code className={styles.editableName}>{name}</code>
          <label className={styles.editableBound}>
            <span>{t("list.min")}</span>
            <NumberInput value={range.min} label={t("list.minOf", { name })} onChange={(n) => n !== undefined && set({ ...value, [name]: { ...range, min: n } })} />
          </label>
          <label className={styles.editableBound}>
            <span>{t("list.max")}</span>
            <NumberInput value={range.max} label={t("list.maxOf", { name })} onChange={(n) => n !== undefined && set({ ...value, [name]: { ...range, max: n } })} />
          </label>
          <button
            type="button"
            className={styles.chipRemove}
            aria-label={t("list.remove", { name })}
            onClick={() => {
              const { [name]: _removed, ...rest } = value;
              set(rest);
            }}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      ))}
      {entries.length < MAX_LIST_ITEMS && open.length > 0 && (
        <select
          className={styles.input}
          value=""
          aria-label={t("list.addTo", { label })}
          onChange={(e) => e.target.value && set({ ...value, [e.target.value]: { min: 0, max: 100 } })}
        >
          <option value="">{t("list.addOption")}</option>
          {open.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** The `editable` value of a block: variable name → { min, max }, only well-formed entries. */
export function editableValue(value: unknown): Record<string, { min: number; max: number }> {
  const out: Record<string, { min: number; max: number }> = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
  for (const [name, range] of Object.entries(value)) {
    const r = range as { min?: unknown; max?: unknown } | null;
    if (r && Number.isInteger(r.min) && Number.isInteger(r.max)) out[name] = { min: r.min as number, max: r.max as number };
  }
  return out;
}

/** A list of names from a block field (`metrics`, `vars`): strings only. */
export function nameItems(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((n): n is string => typeof n === "string") : [];
}
