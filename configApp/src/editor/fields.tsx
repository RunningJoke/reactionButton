/** Inputs for block parameters (README §7.4). Every input works by tapping, no drag and drop. */
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Hash, Variable } from "lucide-react";
import { LedRingPicker } from "../components/LedRingPicker";
import { colorToRgb, isColor, NAMED_COLORS, namedColor, type Color } from "../model/colors";
import { LED_COUNT } from "../model/limits";
import { isObject, type MenuGroup } from "../model/program";
import styles from "./Inspector.module.css";

/** Number field that commits whole numbers; empty = unset. Keeps the typed text while focused. */
export function NumberInput({
  value,
  onChange,
  placeholder,
  min,
  max,
  label,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  label?: string;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => setText(value === undefined ? "" : String(value)), [value]);
  return (
    <input
      className={styles.input}
      type="number"
      inputMode="numeric"
      step={1}
      min={min}
      max={max}
      value={text}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value === "") return onChange(undefined);
        const n = Number(e.target.value);
        if (Number.isInteger(n)) onChange(min !== undefined || max !== undefined ? Math.min(max ?? n, Math.max(min ?? n, n)) : n);
      }}
    />
  );
}

/** A number, or a variable read when the block runs. */
export function ValueField({
  value,
  onChange,
  variables,
  placeholder,
  label,
}: {
  value: unknown;
  onChange: (value: number | string | undefined) => void;
  variables: readonly string[];
  placeholder?: string;
  label: string;
}) {
  const { t } = useTranslation();
  const isVar = typeof value === "string";
  return (
    <div className={styles.valueField}>
      <div className={styles.toggle} role="radiogroup" aria-label={label}>
        <button type="button" role="radio" aria-checked={!isVar} aria-label={t("fields.number")} title={t("fields.number")} onClick={() => isVar && onChange(undefined)}>
          <Hash size={16} aria-hidden />
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={isVar}
          aria-label={t("fields.variable")}
          title={t("fields.variable")}
          onClick={() => !isVar && onChange(variables[0] ?? "VALUE")}
        >
          <Variable size={16} aria-hidden />
        </button>
      </div>
      {isVar ? (
        <select className={styles.input} value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
          {!variables.includes(value) && <option value={value}>{value}</option>}
          {variables.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : (
        <NumberInput value={typeof value === "number" ? value : undefined} onChange={onChange} placeholder={placeholder} label={label} />
      )}
    </div>
  );
}

/** Colour swatches; `custom` adds a free colour picker (central LEDs only). `optional` adds "default". */
export function ColorField({
  value,
  onChange,
  custom,
  optional,
  defaultValue,
  label,
}: {
  value: unknown;
  onChange: (value: Color | undefined) => void;
  custom?: boolean;
  optional?: boolean;
  defaultValue?: unknown;
  label: string;
}) {
  const { t } = useTranslation();
  const named = namedColor(value);
  const isCustom = value !== undefined && !named && isColor(value);
  const rgb = colorToRgb(value);
  const hex = `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  return (
    <div className={styles.swatches} role="radiogroup" aria-label={label}>
      {optional && (
        <button type="button" role="radio" aria-checked={value === undefined} className={styles.defaultChip} onClick={() => onChange(undefined)}>
          {t("fields.default")}
          {defaultValue !== undefined && <span className={styles.swatch} style={{ background: `rgb(${colorToRgb(defaultValue).join(",")})` }} />}
        </button>
      )}
      {NAMED_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={named === c}
          aria-label={t(`colors.${c}`)}
          title={t(`colors.${c}`)}
          className={styles.swatchButton}
          onClick={() => onChange(c)}
        >
          <span className={styles.swatch} data-off={c === "off" || undefined} style={{ background: `rgb(${colorToRgb(c).join(",")})` }} />
        </button>
      ))}
      {custom && (
        <label className={styles.swatchButton} aria-checked={isCustom} role="radio" title={t("fields.customColor")}>
          <span className={styles.swatch} data-custom style={isCustom ? { background: hex } : undefined} />
          <input type="color" className={styles.colorInput} value={isCustom ? hex : "#ff8800"} aria-label={t("fields.customColor")} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        </label>
      )}
    </div>
  );
}

/** LED selection of an `led` block: missing = all LEDs. */
export function LedsField({ value, color, onChange, label }: { value: unknown; color: unknown; onChange: (leds: number[] | undefined) => void; label: string }) {
  const { t } = useTranslation();
  const all = !Array.isArray(value);
  const selected = new Set(all ? Array.from({ length: LED_COUNT }, (_, i) => i) : (value as unknown[]).filter((n): n is number => Number.isInteger(n)));
  const shown = isColor(color) ? color : "white";
  const toggle = (i: number) => {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    onChange(next.size === LED_COUNT ? undefined : [...next].sort((a, b) => a - b));
  };
  return (
    <div className={styles.picker}>
      <LedRingPicker colors={Array.from({ length: LED_COUNT }, (_, i) => (selected.has(i) ? shown : undefined))} onToggle={toggle} size={220} label={label} />
      <div className={styles.pickerActions}>
        <button type="button" className={styles.chip} aria-pressed={all} onClick={() => onChange(undefined)}>
          {t("picker.all")}
        </button>
        <button type="button" className={styles.chip} onClick={() => onChange([])}>
          {t("picker.none")}
        </button>
        <span className={styles.muted}>{all ? t("summary.allLeds") : t("summary.leds", { count: selected.size })}</span>
      </div>
    </div>
  );
}

/** Menu pattern of a program: LEDs in colour groups. Pick a colour, then tap LEDs. */
export function MenuPatternField({ value, onChange }: { value: unknown; onChange: (groups: MenuGroup[]) => void }) {
  const { t } = useTranslation();
  const [paint, setPaint] = useState<string>("blue");
  const id = useId();
  const perLed: (Color | undefined)[] = new Array(LED_COUNT).fill(undefined);
  for (const group of Array.isArray(value) ? value : []) {
    if (!isObject(group) || !Array.isArray(group.leds)) continue;
    for (const led of group.leds) if (Number.isInteger(led) && led >= 0 && led < LED_COUNT) perLed[led] = group.color as Color;
  }
  const toggle = (i: number) => {
    const next = [...perLed];
    next[i] = next[i] !== undefined && namedColor(next[i]) === paint ? undefined : paint;
    onChange(toGroups(next));
  };
  return (
    <div className={styles.picker}>
      <span id={id} className={styles.muted}>
        {t("picker.paintWith")}
      </span>
      <div className={styles.swatches} role="radiogroup" aria-labelledby={id}>
        {NAMED_COLORS.filter((c) => c !== "off").map((c) => (
          <button key={c} type="button" role="radio" aria-checked={paint === c} aria-label={t(`colors.${c}`)} title={t(`colors.${c}`)} className={styles.swatchButton} onClick={() => setPaint(c)}>
            <span className={styles.swatch} style={{ background: `rgb(${colorToRgb(c).join(",")})` }} />
          </button>
        ))}
      </div>
      <LedRingPicker colors={perLed} onToggle={toggle} size={220} label={t("programs.menuPattern")} />
      <div className={styles.pickerActions}>
        <button type="button" className={styles.chip} onClick={() => onChange([])}>
          {t("picker.clear")}
        </button>
      </div>
    </div>
  );
}

/** Per-LED colours → menu groups, one group per colour in order of the first LED. */
export function toGroups(perLed: readonly (Color | undefined)[]): MenuGroup[] {
  const groups = new Map<string, MenuGroup>();
  perLed.forEach((color, led) => {
    if (color === undefined) return;
    const key = JSON.stringify(color);
    const group = groups.get(key) ?? { leds: [], color };
    group.leds.push(led);
    groups.set(key, group);
  });
  return [...groups.values()];
}

/** Text with suggestions (variable and metric names). */
export function SuggestField({
  value,
  onChange,
  suggestions,
  placeholder,
  label,
}: {
  value: unknown;
  onChange: (value: string | undefined) => void;
  suggestions: readonly string[];
  placeholder?: string;
  label: string;
}) {
  const id = useId();
  return (
    <>
      <input
        className={styles.input}
        list={id}
        value={typeof value === "string" ? value : ""}
        placeholder={placeholder}
        aria-label={label}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value.trim())}
      />
      <datalist id={id}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}
