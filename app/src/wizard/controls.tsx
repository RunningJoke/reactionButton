/** Large touch controls of the wizard: switch, stepper, colour swatches, set drawing. */
import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Plus } from "lucide-react";
import { colorToRgb } from "@reactpod/program-model";
import styles from "./Wizard.module.css";

/** A switch row: label, a line that says what it does, and its options when on. */
export function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
  children,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div className={styles.switchCard} data-disabled={disabled || undefined}>
      <label className={styles.switchRow} htmlFor={id}>
        <span className={styles.switchText}>
          <strong>{label}</strong>
          {hint && <span className={styles.muted}>{hint}</span>}
        </span>
        <input id={id} type="checkbox" role="switch" className={styles.switch} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      </label>
      {checked && children && <div className={styles.switchBody}>{children}</div>}
    </div>
  );
}

/** − value + with 44 px buttons; `format` shows the value (e.g. seconds). */
export function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  format = String,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className={styles.stepper} role="group" aria-labelledby={id}>
      <span id={id} className={styles.stepperLabel}>
        {label}
      </span>
      <div className={styles.stepperControls}>
        <button type="button" className={styles.stepButton} disabled={value <= min} aria-label={t("wizard.less", { label })} onClick={() => onChange(Math.max(min, value - step))}>
          <Minus size={20} aria-hidden />
        </button>
        <output className={styles.stepValue} aria-live="polite">
          {format(value)}
        </output>
        <button type="button" className={styles.stepButton} disabled={value >= max} aria-label={t("wizard.more", { label })} onClick={() => onChange(Math.min(max, value + step))}>
          <Plus size={20} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** Radio options as full-width rows (≥ 44 px). */
export function OptionList<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const name = useId();
  return (
    <fieldset className={styles.options}>
      <legend className={styles.fieldLabel}>{label}</legend>
      {options.map((o) => (
        <label key={o.value} className={styles.option}>
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Two-way choice as a segmented control. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const name = useId();
  return (
    <fieldset className={styles.options}>
      <legend className={styles.fieldLabel}>{label}</legend>
      <div className={styles.segmented}>
        {options.map((o) => (
          <label key={o.value}>
            <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Swatches({ label, value, colors, disabled = [], onChange }: { label: string; value: string; colors: readonly string[]; disabled?: readonly string[]; onChange: (c: string) => void }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className={styles.field}>
      <span id={id} className={styles.fieldLabel}>
        {label}
      </span>
      <div className={styles.swatches} role="radiogroup" aria-labelledby={id}>
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value === c}
            aria-label={t(`colors.${c}`)}
            title={t(`colors.${c}`)}
            disabled={disabled.includes(c)}
            className={styles.swatchButton}
            onClick={() => onChange(c)}
          >
            <span className={styles.swatch} style={{ background: rgb(c) }} />
          </button>
        ))}
      </div>
    </div>
  );
}

export const rgb = (color: string) => `rgb(${colorToRgb(color).join(",")})`;

/** A tick every `ms` for the small LED animations (stays at 0 with reduced motion). */
export function useTick(ms = 900): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return tick;
}

/**
 * Drawing of a set: the central (big, with its ring) and `pods` small pods. `lit` maps a pod
 * index (or "c" for the central) to a colour.
 */
export function SetDrawing({ pods, lit = {}, label, width = 120 }: { pods: number; lit?: Record<string, string | undefined>; label?: string; width?: number }) {
  const shown = Math.min(pods, 7);
  const positions = Array.from({ length: shown }, (_, i) => {
    const a = shown === 1 ? 0 : -Math.PI / 2.4 + (i / (shown - 1)) * (Math.PI / 1.2);
    return { x: 30 + Math.cos(a) * 58, y: 34 + Math.sin(a) * 26 };
  });
  const fill = (key: string) => (lit[key] && lit[key] !== "off" ? rgb(lit[key]!) : "var(--led-off)");
  return (
    <svg viewBox="0 0 100 68" width={width} height={(width * 68) / 100} role="img" aria-label={label} aria-hidden={label ? undefined : true} className={styles.setDrawing}>
      {positions.map((p, i) => (
        <line key={`l${i}`} x1="30" y1="34" x2={p.x} y2={p.y} stroke="var(--border)" strokeWidth="1" strokeDasharray="2 2" />
      ))}
      <circle cx="30" cy="34" r="17" fill="var(--surface-2)" stroke="var(--border)" />
      <circle cx="30" cy="34" r="12.5" fill="none" stroke={fill("c")} strokeWidth="4" />
      <circle cx="30" cy="34" r="5" fill="var(--surface)" stroke="var(--border)" />
      {positions.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="8" fill="var(--surface-2)" stroke="var(--border)" />
          <circle cx={p.x} cy={p.y} r="5" fill={fill(String(i))} />
        </g>
      ))}
    </svg>
  );
}
