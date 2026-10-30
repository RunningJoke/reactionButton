/** Small controls shared by the step sheet and its Sprinkle rows (editor-ux.md §4 D). */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { isObject, type Block } from "@reactpod/program-model";
import { Segmented, Stepper } from "../wizard/controls";
import { setProgramField, type ProgramJson } from "./ops";
import { settingLabel } from "./settingLabels";
import styles from "./StepSheet.module.css";

export type Apply = (doc: ProgramJson, mergeKey?: string) => void;

export type FieldProps = {
  block: Block;
  doc: ProgramJson;
  set: (field: string, value: unknown, merge?: boolean) => void;
  apply: Apply;
};

/** Seconds as text: 1500 → "1.5 s" (en) / "1,5 s" (de). */
export function secondsText(ms: number, t: TFunction): string {
  const s = Math.round(ms / 10) / 100;
  return t("sentence.seconds", { value: String(s).replace(".", t("sentence.decimal")) });
}

/** Words for a field: the step sheet's label, else the field's own. */
export function fieldWords(field: string, t: TFunction): string {
  return t(`editor.step.label.${field}`, { defaultValue: t(`fields.${field}.label`, { defaultValue: field }) });
}

export const LIMIT = { min: 0, max: 600_000, step: 500 };

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.field} role="group" aria-label={label}>
      <span className={styles.label}>{label}</span>
      {children}
    </div>
  );
}

type Bounds = { minMs?: number; maxMs?: number; stepMs?: number };

/** A time in seconds: a number edits the step, a setting edits the setting (for the whole program). */
export function TimeValue({ label, value, doc, onField, apply, min = LIMIT.min, max = LIMIT.max, step = LIMIT.step }: { label: string; value: unknown; doc: ProgramJson; onField: (ms: number) => void; apply: Apply; min?: number; max?: number; step?: number }) {
  const { t } = useTranslation();
  const vars = isObject(doc.variables) ? (doc.variables as Record<string, number>) : {};
  const fmt = (v: number) => secondsText(v, t);
  if (typeof value === "string") {
    const v = vars[value];
    if (typeof v !== "number") return <p className={styles.hint}>{t("editor.step.fromSetting", { name: settingLabel(value, t).label })}</p>;
    return (
      <div className={styles.valueBox}>
        <Stepper label={label} value={v} {...LIMIT} min={min} max={max} step={step} format={fmt} onChange={(n) => apply(setProgramField(doc, "variables", { ...vars, [value]: n }), `var.${value}`)} />
        <p className={styles.hint}>{t("editor.step.settingHint", { name: settingLabel(value, t).label })}</p>
      </div>
    );
  }
  return <Stepper label={label} value={typeof value === "number" ? value : min} {...LIMIT} min={min} max={max} step={step} format={fmt} onChange={onField} />;
}

/** A count (rounds, red pods): number or setting, like TimeValue. */
export function CountValue({ label, value, doc, min = 0, max = 999, onField, apply }: { label: string; value: unknown; doc: ProgramJson; min?: number; max?: number; onField: (n: number) => void; apply: Apply }) {
  const { t } = useTranslation();
  const vars = isObject(doc.variables) ? (doc.variables as Record<string, number>) : {};
  if (typeof value === "string") {
    const v = vars[value];
    if (typeof v !== "number") return <p className={styles.hint}>{t("editor.step.fromSetting", { name: settingLabel(value, t).label })}</p>;
    return (
      <div className={styles.valueBox}>
        <Stepper label={label} value={v} min={min} max={max} onChange={(n) => apply(setProgramField(doc, "variables", { ...vars, [value]: n }), `var.${value}`)} />
        <p className={styles.hint}>{t("editor.step.settingHint", { name: settingLabel(value, t).label })}</p>
      </div>
    );
  }
  return <Stepper label={label} value={typeof value === "number" ? value : min} min={min} max={max} onChange={onField} />;
}

type TimePart = { value: unknown; onChange: (ms: number) => void };

/**
 * One time that is either fixed or random between a shortest and a longest value (pause, signal delay,
 * game length, random time limit). Without `onRandom` the choice is not offered and the current form shows.
 */
export function FixedOrRandomTime({
  label,
  random,
  onRandom,
  fixed,
  min,
  max,
  doc,
  apply,
  fixedLabel,
  minMs,
  maxMs,
  stepMs,
}: {
  label: string;
  random: boolean;
  onRandom?: (random: boolean) => void;
  fixed: TimePart;
  min: TimePart;
  max: TimePart;
  doc: ProgramJson;
  apply: Apply;
  fixedLabel?: string;
} & Bounds) {
  const { t } = useTranslation();
  return (
    <>
      {onRandom && (
        <Segmented
          label={label}
          value={random ? "random" : "fixed"}
          options={[
            { value: "fixed", label: t("editor.step.fixed") },
            { value: "random", label: t("editor.step.random") },
          ]}
          onChange={(v) => onRandom(v === "random")}
        />
      )}
      {random ? (
        <div className={styles.pair}>
          <TimeValue label={t("editor.step.shortest")} value={min.value} doc={doc} apply={apply} onField={min.onChange} min={minMs} max={maxMs} step={stepMs} />
          <TimeValue label={t("editor.step.longest")} value={max.value} doc={doc} apply={apply} onField={max.onChange} min={minMs} max={maxMs} step={stepMs} />
        </div>
      ) : (
        <TimeValue label={fixedLabel ?? t("editor.step.seconds")} value={fixed.value} doc={doc} apply={apply} onField={fixed.onChange} min={minMs} max={maxMs} step={stepMs} />
      )}
    </>
  );
}
