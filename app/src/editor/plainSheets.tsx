/**
 * Plain-language sheets of the steps that otherwise show raw fields in simple mode (design review R5):
 * pick a pod at random, report to the app, show results, the "Advanced step" fallback and the sheet footer.
 * Every change goes through the same ops as the expert fields, so the block JSON is the same.
 */
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Copy, Ellipsis, Trash2, Wrench } from "lucide-react";
import { SwitchRow } from "../wizard/controls";
import { exitValueText, type ExitEnv } from "./ExitPicker";
import { behaviour } from "./behaviours";
import { POD_PICKS, podPickOf, setPodPick } from "./podPick";
import { Field, TimeValue, type FieldProps } from "./sheetParts";
import { ReportResults } from "./Sprinkles";
import type { InspectorContext } from "./BlockInspector";
import inspector from "./Inspector.module.css";
import styles from "./StepSheet.module.css";

/** "Pick a pod at random": any pod / never the same twice in a row / not the main pod. */
export function PodPickFields({ block, doc, apply }: FieldProps) {
  const { t } = useTranslation();
  const current = podPickOf(block);
  return (
    <>
      <Field label={t("editor.step.pick.label")}>
        <div className={styles.chips}>
          {POD_PICKS.map((k) => (
            <button key={k} type="button" className={inspector.chip} aria-pressed={current === k} onClick={() => apply(setPodPick(doc, block.name, k))}>
              {t(`editor.step.pick.${k}`)}
            </button>
          ))}
        </div>
      </Field>
      <p className={styles.hint}>{t(`editor.step.pick.${current}Hint`)}</p>
    </>
  );
}

/** A step without a plain version: marked, its raw fields behind "Show details". */
export function AdvancedStep({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <section className={styles.advanced}>
      <p className={styles.advancedBadge}>
        <Wrench size={14} aria-hidden /> {t("editor.step.advanced.badge")}
      </p>
      <p className={styles.hint}>{t("editor.step.advanced.hint")}</p>
      <button type="button" className={styles.linkButton} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? t("editor.step.advanced.hide") : t("editor.step.advanced.show")}
      </button>
      {open && <div className={styles.advancedBody}>{children}</div>}
    </section>
  );
}

/** "Send the round result to the app and wait": what happens on the app's answer, a press and a time-out, in sentences. */
export function ReportFields({ block, doc, set, apply, metrics, env }: FieldProps & { metrics: readonly string[]; env: ExitEnv }) {
  const { t } = useTranslation();
  const line = (port: string, key: string) => (typeof block[port] === "string" || port === "next" ? <li key={port}>{t(`editor.step.report.${key}`, { target: exitValueText(env, block, port, t).toLowerCase() })}</li> : null);
  return (
    <>
      <p className={styles.hint}>{t("editor.step.report.hint")}</p>
      <ReportResults block={block} doc={doc} set={set} apply={apply} metrics={metrics} />
      <ul className={styles.plainList} aria-label={t("editor.step.report.happens")}>
        {line("next", "onContinue")}
        {line("pressed", "onPress")}
        {typeof block.timeoutMs === "number" && block.timeoutMs > 0 ? line("timeout", "onTimeout") : null}
      </ul>
    </>
  );
}

/** "Show results": which result, show it on the pod (average bar), the target time. */
export function SummaryFields({ block, doc, set, apply, labelOf, metrics, format }: FieldProps & { labelOf: (v: string) => string; metrics: readonly string[]; format?: number }) {
  const { t } = useTranslation();
  const metric = typeof block.metric === "string" ? block.metric : "reaction";
  const choices = [...new Set([metric, ...metrics])];
  const bar = behaviour("showBar");
  const show = block.show === true;
  return (
    <>
      <Field label={t("editor.step.summary.which")}>
        <select className={inspector.input} value={metric} aria-label={t("editor.step.summary.which")} onChange={(e) => set("metric", e.target.value, false)}>
          {choices.map((m) => (
            <option key={m} value={m}>
              {labelOf(m)}
            </option>
          ))}
        </select>
      </Field>
      {bar.appliesTo(block, undefined, format) && (
        <>
          <SwitchRow label={t("editor.step.summary.show")} hint={t("editor.step.summary.showHint")} checked={show} onChange={(on) => apply(on ? bar.turnOn(doc, block.name) : bar.turnOff(doc, block.name))} />
          {show && <TimeValue label={t("editor.step.summary.target")} value={block.targetMs} doc={doc} apply={apply} min={1} max={60_000} step={50} onField={(ms) => set("targetMs", ms)} />}
        </>
      )}
    </>
  );
}

/** Sticky footer of the step sheet: Done, and "···" with move, duplicate and delete. */
export function SheetFooter({ ctx, name, locked }: { ctx: InspectorContext; name: string; locked?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const item = (key: string, label: string, icon: ReactNode, onClick: () => void, o?: { disabled?: boolean; danger?: boolean }) => (
    <button key={key} type="button" role="menuitem" className={styles.menuItem} data-danger={o?.danger || undefined} disabled={o?.disabled} onClick={() => (setOpen(false), onClick())}>
      {icon} {label}
    </button>
  );
  return (
    <footer className={styles.footer}>
      {open && (
        <div className={styles.menu} role="menu" aria-label={t("editor.step.moreActions")}>
          {ctx.step && item("moveUp", t("editor.step.moveUp"), <ArrowUp size={18} aria-hidden />, () => ctx.step!.move("up"), { disabled: !ctx.step.canUp })}
          {ctx.step && item("moveDown", t("editor.step.moveDown"), <ArrowDown size={18} aria-hidden />, () => ctx.step!.move("down"), { disabled: !ctx.step.canDown })}
          {ctx.duplicate && item("duplicate", t("editor.duplicate"), <Copy size={18} aria-hidden />, () => ctx.duplicate!(name))}
          {item("deleteStep", t("editor.step.deleteStep"), <Trash2 size={18} aria-hidden />, () => ctx.remove?.(name), { disabled: !!locked, danger: true })}
        </div>
      )}
      <button type="button" className={styles.done} onClick={() => ctx.select(null)}>
        {t("editor.step.done")}
      </button>
      <button type="button" className={styles.moreButton} aria-haspopup="menu" aria-expanded={open} aria-label={t("editor.step.moreActions")} onClick={() => setOpen(!open)}>
        <Ellipsis size={20} aria-hidden />
      </button>
    </footer>
  );
}
